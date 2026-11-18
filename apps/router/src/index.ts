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

interface Env {
  SITES: R2Bucket;
  ROUTES: KVNamespace;
  BASE_DOMAIN: string;
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
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("method not allowed", { status: 405 });
    }
    const url = new URL(request.url);
    const hostname = url.hostname.toLowerCase();

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
      const response = await serveObject(env, r2PageKey(host.siteId, pointer.versionId, path), "public, max-age=60");
      if (response) {
        response.headers.set("x-site-version", String(pointer.number));
        return response;
      }
      return page(404, "페이지 파일을 찾지 못했습니다.");
    }
    return page(404, "없는 주소입니다.");
  },
};
