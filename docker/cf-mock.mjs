// Stand-in for the Cloudflare for SaaS custom hostnames API (same paths and envelope), so the
// api Worker's real client runs unchanged in Docker. In-memory; restart clears it.
// Control (tests only): POST /__mock/:hostname/activate | /fail | /pending | /delete, GET /__mock/calls
// Also stands in for OpenAI's Images API (/openai/v1/images/generations) for image_generate.
import http from "node:http";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

const sharp = createRequire(new URL("../packages/renderer/package.json", import.meta.url))("sharp");

const TOKEN = process.env.CF_API_TOKEN ?? "mock-token";
const hostnames = new Map();
let outage = false;
const calls = [];

const send = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};
const ok = (res, result, extra = {}) => send(res, 200, { success: true, errors: [], messages: [], result, ...extra });
const fail = (res, status, code, message) => send(res, status, { success: false, errors: [{ code, message }], result: null });

function view(h) {
  return {
    id: h.id,
    hostname: h.hostname,
    status: h.status,
    ssl: { method: h.sslMethod, type: "dv", status: h.sslStatus, validation_records: [] },
    ownership_verification: { type: "txt", name: `_cf-custom-hostname.${h.hostname}`, value: h.token },
    verification_errors: h.status === "pending" ? ["custom hostname does not CNAME to this zone."] : [],
    created_at: h.createdAt,
  };
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://cf-mock");
    let raw = "";
    for await (const chunk of req) raw += chunk;
    calls.push({ method: req.method, path: url.pathname + url.search });

    const control = url.pathname.match(/^\/__mock\/([^/]+)\/(activate|fail|pending|delete)$/);
    if (control && req.method === "POST") {
      const h = [...hostnames.values()].find((x) => x.hostname === control[1]);
      if (!h) return fail(res, 404, 1436, "not found");
      if (control[2] === "activate") Object.assign(h, { status: "active", sslStatus: "active" });
      if (control[2] === "fail") Object.assign(h, { status: "moved", sslStatus: "pending_validation" });
      if (control[2] === "pending") Object.assign(h, { status: "pending", sslStatus: "pending_validation" });
      if (control[2] === "delete") hostnames.delete(h.id);
      return ok(res, view(h));
    }
    if (url.pathname === "/__mock/calls") return ok(res, calls);
    if (url.pathname === "/__mock/outage" && req.method === "POST") {
      outage = url.searchParams.get("on") === "1";
      return ok(res, { outage });
    }
    if (url.pathname === "/health") return ok(res, { ok: true });

    // OpenAI Images API stand-in: POST /openai/v1/images/generations answers like gpt-image
    // (base64 PNG in data[0].b64_json). A prompt containing "__fail__" gets OpenAI's error shape.
    if (url.pathname === "/openai/v1/images/generations" && req.method === "POST") {
      if (req.headers.authorization !== `Bearer ${process.env.OPENAI_API_KEY ?? "mock-openai-key"}`) {
        return send(res, 401, { error: { message: "Incorrect API key provided", type: "invalid_request_error" } });
      }
      const body = JSON.parse(raw || "{}");
      if (String(body.prompt).includes("__fail__")) {
        return send(res, 400, { error: { message: "Your request was rejected by the safety system.", type: "image_generation_user_error" } });
      }
      const [width, height] = String(body.size ?? "1024x1024").split("x").map(Number);
      const hue = [...String(body.prompt)].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 360, 7);
      const png = await sharp({ create: { width, height, channels: 3, background: `hsl(${hue}, 45%, 60%)` } }).png().toBuffer();
      return send(res, 200, { created: Math.floor(Date.now() / 1000), data: [{ b64_json: png.toString("base64") }], usage: { total_tokens: 1000 } });
    }

    // Naver blog RSS fixtures: /fixtures/naver-rss/<id>.xml. "missing" answers 404.
    const rss = url.pathname.match(/^\/fixtures\/naver-rss\/([A-Za-z0-9_-]+)\.xml$/);
    if (rss) {
      if (rss[1] === "missing") return send(res, 404, { error: "not found" });
      const items = [1, 2, 3, 4]
        .map(
          (n) => `<item><title><![CDATA[${rss[1]} 글 ${n} & 소식]]></title><link><![CDATA[https://blog.naver.com/${rss[1]}/${100 + n}?fromRss=true]]></link>
<description><![CDATA[<img src="https://blogthumb.pstatic.net/fixture/${rss[1]}-${n}.jpg?type=s3"> ${rss[1]} 블로그의 ${n}번째 글 요약입니다.]]></description>
<pubDate>${new Date(Date.UTC(2026, 10, 20 - n, 1)).toUTCString()}</pubDate></item>`,
        )
        .join("");
      res.writeHead(200, { "content-type": "text/xml; charset=utf-8" });
      return res.end(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${rss[1]}</title>${items}</channel></rss>`);
    }

    const m = url.pathname.match(/^\/client\/v4\/zones\/([^/]+)\/custom_hostnames(?:\/([^/]+))?$/);
    if (!m) return fail(res, 404, 7000, "No route for that URI");
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return fail(res, 403, 10000, "Authentication error");
    if (outage) return fail(res, 503, 10001, "Service unavailable (mock outage)");
    const id = m[2];

    if (req.method === "POST" && !id) {
      const body = JSON.parse(raw || "{}");
      if ([...hostnames.values()].some((h) => h.hostname === body.hostname)) {
        return fail(res, 409, 1406, "Duplicate custom hostname found.");
      }
      const h = {
        id: randomUUID(),
        hostname: body.hostname,
        status: "pending",
        sslStatus: "initializing",
        sslMethod: body.ssl?.method ?? "http",
        token: randomUUID(),
        createdAt: new Date().toISOString(),
      };
      hostnames.set(h.id, h);
      return ok(res, view(h));
    }
    if (req.method === "GET" && !id) {
      // Same constraint as the real API: per_page 5–50.
      const perPage = Number(url.searchParams.get("per_page") ?? 20);
      if (!Number.isInteger(perPage) || perPage < 5 || perPage > 50) return fail(res, 400, 1004, "per_page must be between 5 and 50");
      const all = [...hostnames.values()];
      return ok(res, all.slice(0, perPage).map(view), { result_info: { total_count: all.length } });
    }
    const h = hostnames.get(id);
    if (!h) return fail(res, 404, 1436, "The custom hostname was not found.");
    if (req.method === "GET") {
      if (h.sslStatus === "initializing") h.sslStatus = "pending_validation";
      return ok(res, view(h));
    }
    if (req.method === "DELETE") {
      hostnames.delete(id);
      return ok(res, { id });
    }
    return fail(res, 405, 7001, "Method not allowed");
  })
  .listen(8790, () => console.log("cf-mock on :8790"));
