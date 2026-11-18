// M1 acceptance: create → preview → publish → edit → republish → rollback, validation and auth
// failures, then a browser check of the published site. Needs `pnpm dev:api` and `pnpm dev:router`.
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import http from "node:http";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const { businessBasicTemplate } = await import(
  "../packages/renderer/node_modules/@dani-builder/site-templates/dist/index.js"
);

const API = process.env.API_URL ?? "http://127.0.0.1:8788";
const ROUTER_PORT = process.env.ROUTER_PORT ?? "8787";
const TOKEN = process.env.ADMIN_TOKEN ?? "dev-admin-token";
const out = "evidence/m1";
mkdirSync(out, { recursive: true });

const results = [];
function check(name, pass, detail = {}) {
  results.push({ name, pass: Boolean(pass), ...detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${Object.keys(detail).length ? " " + JSON.stringify(detail) : ""}`);
}
async function api(method, path, body, { auth = true } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...(auth ? { authorization: `Bearer ${TOKEN}` } : {}), "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data, headers: res.headers };
}
const slug = `m1-${Date.now().toString(36)}`;
const siteUrl = `http://${slug}.localhost:${ROUTER_PORT}/`;
// Node cannot resolve *.localhost, so talk to 127.0.0.1 with the Host header set.
function get(host, path = "/") {
  return new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port: ROUTER_PORT, path, headers: { host: `${host}:${ROUTER_PORT}` } }, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
      })
      .on("error", reject);
  });
}
async function live() {
  const res = await get(`${slug}.localhost`);
  return { status: res.status, version: res.headers["x-site-version"] ?? null, title: res.body.match(/<title>([^<]*)/)?.[1] };
}
async function waitFor(predicate, timeoutMs = 70_000) {
  const started = Date.now();
  for (;;) {
    const state = await live();
    if (predicate(state)) return { state, ms: Date.now() - started };
    if (Date.now() - started > timeoutMs) return { state, ms: null };
    await new Promise((r) => setTimeout(r, 500));
  }
}
function seedWithIcon(icon) {
  const seed = structuredClone(businessBasicTemplate.compositions["forest-stay"].seed);
  return JSON.parse(JSON.stringify(seed).replace('"icon":null', JSON.stringify({ icon }).slice(1, -1)));
}
const config = (title, extra = {}) => ({
  slug,
  templateId: "business-basic",
  compositionId: "forest-stay",
  paletteId: "pine",
  meta: { title, description: "M1 게시 PoC" },
  ...extra,
});

// 0. shared assets
execFileSync("node", ["scripts/upload-shared.mjs"], { stdio: "inherit", env: { ...process.env, API_URL: API, ADMIN_TOKEN: TOKEN } });

// 1. auth
check("인증 없는 요청은 401", (await api("POST", "/sites", { config: config("x") }, { auth: false })).status === 401);

// 2. create
const created = await api("POST", "/sites", { config: config("M1 v1"), createdBy: "ai" });
check("사이트 생성 201", created.status === 201, { hostname: created.data.hostname });
const siteId = created.data.siteId;
const v1 = created.data.versionId;

// 3. preview before publish
const site1 = await api("GET", `/sites/${siteId}`);
const previewRes = await fetch(`${API}/preview/${site1.data.versions[0].preview_token}`);
const previewHtml = await previewRes.text();
check("프리뷰 200 + noindex", previewRes.status === 200 && previewRes.headers.get("x-robots-tag")?.includes("noindex") && previewHtml.includes("<title>M1 v1"));
check("게시 전 공개 주소는 404", (await live()).status === 404);

// 4. publish v1
let t = Date.now();
const pub1 = await api("POST", `/sites/${siteId}/publish`);
const publishMs1 = Date.now() - t;
const w1 = await waitFor((s) => s.version === "1");
check("v1 게시 후 공개", pub1.status === 200 && w1.state.title === "M1 v1", { publishMs: publishMs1, propagationMs: w1.ms });

// 5. edit → draft is not live → publish v2
const v2 = await api("POST", `/sites/${siteId}/versions`, {
  config: config("M1 v2", { paletteId: "clay", seed: seedWithIcon("FaPhone") }),
  createdBy: "customer",
  note: "콘솔 AI 수정 요청",
});
check("v2 초안 생성 201", v2.status === 201 && v2.data.number === 2);
check("초안은 공개 주소에 반영되지 않음", (await live()).version === "1");
t = Date.now();
const pub2 = await api("POST", `/sites/${siteId}/publish`);
const publishMs2 = Date.now() - t;
const w2 = await waitFor((s) => s.version === "2");
check("v2 게시 후 공개", pub2.status === 200 && w2.state.title === "M1 v2", { publishMs: publishMs2, propagationMs: w2.ms });

// 6. rollback
const rb = await api("POST", `/sites/${siteId}/rollback`, { versionId: v1 });
const w3 = await waitFor((s) => s.version === "1");
check("v1로 롤백", rb.status === 200 && w3.state.title === "M1 v1", { propagationMs: w3.ms });
const v3 = await api("POST", `/sites/${siteId}/versions`, { config: config("M1 v3") });
const rbDraft = await api("POST", `/sites/${siteId}/rollback`, { versionId: v3.data.versionId });
check("게시된 적 없는 버전으로 롤백은 409", rbDraft.status === 409);
await api("POST", `/sites/${siteId}/publish`, { versionId: v2.data.versionId });
await waitFor((s) => s.version === "2");

// 7. validation
const before = (await api("GET", `/sites/${siteId}`)).data.versions.length;
const badIcon = await api("POST", `/sites/${siteId}/versions`, { config: config("bad", { seed: seedWithIcon("FaRocket") }) });
check("허용 목록 밖 아이콘은 422", badIcon.status === 422 && JSON.stringify(badIcon.data.details).includes("FaRocket"));
const badSlug = await api("POST", `/sites/${siteId}/versions`, { config: { ...config("bad"), slug: `${slug}-x` } });
check("slug 변경은 422", badSlug.status === 422);
const after = (await api("GET", `/sites/${siteId}`)).data.versions.length;
check("검증 실패는 버전을 만들지 않음", before === after, { versions: after });
const dup = await api("POST", "/sites", { config: config("dup") });
check("중복 slug는 409", dup.status === 409);

// 8. router edges
const unknown = await get(`nobody-${Date.now()}.localhost`);
check("연결 안 된 호스트는 404", unknown.status === 404);
const robots = await get(`${slug}.localhost`, "/robots.txt");
const sitemap = await get(`${slug}.localhost`, "/sitemap.xml");
check("robots.txt·sitemap.xml 200", robots.status === 200 && sitemap.status === 200 && sitemap.body.includes(`${slug}.localhost`));

// 9. browser
const browser = await chromium.launch();
for (const [vp, viewport] of Object.entries({ mobile: { width: 390, height: 844 }, desktop: { width: 1280, height: 800 } })) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  const failed = [];
  const external = [];
  let jsBytes = 0;
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("requestfailed", (r) => failed.push(r.url()));
  page.on("request", (r) => !r.url().startsWith(siteUrl.slice(0, -1)) && external.push(r.url()));
  page.on("response", async (r) => {
    if (r.url().endsWith(".js")) jsBytes += Number(r.headers()["content-length"] ?? (await r.body().catch(() => Buffer.alloc(0))).length);
  });
  await page.goto(siteUrl, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 400) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 100));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForLoadState("networkidle");
  const state = await page.evaluate(() => {
    const root = document.getElementById("root");
    return {
      hydrated:
        !!root &&
        Object.keys(root).some((k) => k.startsWith("__reactContainer")) &&
        [...root.querySelectorAll("*")].some((el) => Object.keys(el).some((k) => k.startsWith("__reactFiber"))),
      unloadedImages: [...document.images].filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.src),
      svgIcons: document.querySelectorAll("#root svg").length,
    };
  });
  await page.screenshot({ path: `${out}/site-${vp}.png`, fullPage: true });
  check(`브라우저 ${vp}`, state.hydrated && !errors.length && !failed.length && !external.length && !state.unloadedImages.length, {
    jsKiB: Math.round(jsBytes / 1024),
    errors,
    failed,
    external,
    unloaded: state.unloadedImages.length,
  });
  await page.close();
}
await browser.close();

writeFileSync(`${out}/results.json`, JSON.stringify({ slug, siteId, results }, null, 2));
const failedCount = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failedCount}/${results.length} passed`);
process.exit(failedCount ? 1 : 0);
