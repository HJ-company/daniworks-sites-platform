import { blogCardsHtml, type BlogFeed } from "@sites/renderer/blog";
import {
  kvHostKey,
  kvSiteKey,
  MEDIA_PATH,
  r2MediaKey,
  r2PageKey,
  r2SharedKey,
  type HostRecord,
  type PublishedPointer,
} from "./keys.js";

/** RPC surface of the api Worker's `PublicApi` entrypoint (apps/api/src/public.ts). */
interface PublicApi {
  track(request: { siteId: string; userAgent: string | null; body: unknown }): Promise<"counted" | "ignored">;
  submitInquiry(request: { siteId: string; hostname: string; ip: string | null; body: unknown }): Promise<{
    status: number;
    body: unknown;
  }>;
}

interface Env {
  SITES: R2Bucket;
  ROUTES: KVNamespace;
  BASE_DOMAIN: string;
  API: PublicApi;
}

const MAX_FORM_BYTES = 16 * 1024;

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

/** Reads a small JSON body, refusing anything larger than the limit while streaming. */
async function readSmallJson(request: Request, limit: number): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new Error("too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

// KV values are cached at the edge for this long (KV minimum); publish/rollback propagate within it.
const KV_CACHE_TTL = 30;

function page(status: number, message: string, headers: Record<string, string> = {}) {
  return new Response(
    `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${message}</title><body style="font-family:system-ui;padding:48px"><p>${message}</p></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", ...headers } },
  );
}

async function serveObject(env: Env, key: string, cacheControl: string) {
  const object = await env.SITES.get(key);
  if (!object) return null;
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", cacheControl);
  return new Response(object.body, { headers });
}

/** One KV read for M2 records; M1 records (bare siteId) need a second read for the pointer. */
async function resolveHost(env: Env, hostname: string): Promise<HostRecord | null> {
  const raw = await env.ROUTES.get(kvHostKey(hostname), { cacheTtl: KV_CACHE_TTL });
  if (!raw) return null;
  if (raw.startsWith("{")) return JSON.parse(raw) as HostRecord;
  const pointer = await env.ROUTES.get<PublishedPointer>(kvSiteKey(raw), { type: "json", cacheTtl: KV_CACHE_TTL });
  return { siteId: raw, status: "active", pointer, redirectTo: null };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const hostname = url.hostname.toLowerCase();

    // Pageview and click beacons. Always 204: callers learn nothing, pages never wait on it.
    if (url.pathname === "/api/track") {
      if (request.method !== "POST") return new Response(null, { status: 405 });
      const host = await resolveHost(env, hostname);
      if (host && host.status === "active" && host.pointer) {
        let body: unknown = null;
        try {
          body = await readSmallJson(request, 1024);
        } catch {
          body = null;
        }
        if (body) {
          ctx.waitUntil(env.API.track({ siteId: host.siteId, userAgent: request.headers.get("user-agent"), body }));
        }
      }
      return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
    }

    // Visitor inquiry: the site is identified by Host here, then handed to the api by RPC.
    if (url.pathname === "/api/inquiry") {
      if (request.method !== "POST") return jsonResponse(405, { ok: false, error: "method not allowed" });
      const host = await resolveHost(env, hostname);
      if (!host || host.status !== "active" || !host.pointer) {
        return jsonResponse(404, { ok: false, error: "문의를 받을 수 없는 사이트입니다" });
      }
      if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) {
        return jsonResponse(415, { ok: false, error: "JSON으로 보내 주세요" });
      }
      let body: unknown;
      try {
        body = await readSmallJson(request, MAX_FORM_BYTES);
      } catch {
        return jsonResponse(400, { ok: false, error: "요청을 읽지 못했습니다" });
      }
      const result = await env.API.submitInquiry({
        siteId: host.siteId,
        hostname,
        ip: request.headers.get("cf-connecting-ip"),
        body,
      });
      return jsonResponse(result.status, result.body);
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("method not allowed", { status: 405 });
    }

    // Shared assets are content-addressed by version, so any host may serve them.
    if (url.pathname.startsWith("/_shared/")) {
      return (
        (await serveObject(env, r2SharedKey(url.pathname.slice("/_shared/".length)), "public, max-age=31536000, immutable")) ??
        new Response("not found", { status: 404 })
      );
    }
    // Uploaded photos are public and content-addressed.
    const media = MEDIA_PATH.exec(url.pathname);
    if (media) {
      return (
        (await serveObject(env, r2MediaKey(media[1]!, media[2]!), "public, max-age=31536000, immutable")) ??
        new Response("not found", { status: 404 })
      );
    }

    const host = await resolveHost(env, hostname);
    if (!host) return page(404, "연결된 사이트가 없습니다.");
    if (host.status === "cancelled") return page(410, "운영이 종료된 사이트입니다.");
    if (host.status === "suspended") return page(503, "잠시 운영을 멈춘 사이트입니다.", { "retry-after": "86400" });
    if (host.redirectTo) {
      return Response.redirect(`${url.protocol}//${host.redirectTo}${url.pathname}${url.search}`, 301);
    }
    const pointer = host.pointer;
    if (!pointer) return page(404, "아직 공개되지 않은 사이트입니다.");

    if (url.pathname === "/robots.txt") {
      return new Response(`User-agent: *\nAllow: /\nSitemap: https://${hostname}/sitemap.xml\n`, {
        headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" },
      });
    }
    const pages = pointer.pages ?? ["/"];
    if (url.pathname === "/sitemap.xml") {
      const lastmod = pointer.publishedAt.slice(0, 10);
      const urls = pages
        .map((route) => `<url><loc>https://${hostname}${route}</loc><lastmod>${lastmod}</lastmod></url>`)
        .join("");
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>\n`,
        { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } },
      );
    }
    const route = url.pathname === "/index.html" ? "/" : url.pathname.replace(/\/(index\.html)?$/, "") || "/";
    if (pages.includes(route)) {
      const path = route === "/" ? "index.html" : `${route.slice(1)}/index.html`;
      const response = await serveObject(env, r2PageKey(host.siteId, pointer.versionId, path, pointer.renderId), "public, max-age=60");
      if (response) {
        response.headers.set("x-site-version", String(pointer.number));
        if (route !== "/") return response;
        // Latest blog posts, filled at request time from the cron's KV cache. The body now
        // changes without the object changing, so the R2 ETag no longer describes it.
        response.headers.delete("etag");
        const siteId = host.siteId;
        return new HTMLRewriter()
          .on("[data-blog-feed]", {
            async element(element) {
              const feed = await env.ROUTES.get<BlogFeed>(`blog:${siteId}`, { type: "json", cacheTtl: 300 });
              // Edge caches can lag a blog change: only posts from the blog this page links to.
              const html = feed && feed.source === element.getAttribute("data-blog-feed") ? blogCardsHtml(feed.posts) : "";
              if (html) element.setInnerContent(html, { html: true });
            },
          })
          .transform(response);
      }
      return page(404, "페이지 파일을 찾지 못했습니다.");
    }
    return page(404, "없는 주소입니다.");
  },
};
