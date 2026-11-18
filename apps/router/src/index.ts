import { kvHostKey, kvSiteKey, r2PageKey, r2SharedKey, type PublishedPointer } from "./keys.js";

interface Env {
  SITES: R2Bucket;
  ROUTES: KVNamespace;
  BASE_DOMAIN: string;
}

// KV values are cached at the edge for this long; publish/rollback propagate within about a minute.
const KV_CACHE_TTL = 60;

function notFound(message: string) {
  return new Response(
    `<!doctype html><html lang="ko"><meta charset="utf-8"><title>페이지 없음</title><body style="font-family:system-ui;padding:48px"><p>${message}</p></body></html>`,
    { status: 404, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
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

    const siteId = await env.ROUTES.get(kvHostKey(hostname), { cacheTtl: KV_CACHE_TTL });
    if (!siteId) return notFound("연결된 사이트가 없습니다.");
    const pointer = await env.ROUTES.get<PublishedPointer>(kvSiteKey(siteId), { type: "json", cacheTtl: KV_CACHE_TTL });
    if (!pointer) return notFound("아직 공개되지 않은 사이트입니다.");

    if (url.pathname === "/robots.txt") {
      return new Response(`User-agent: *\nAllow: /\nSitemap: https://${hostname}/sitemap.xml\n`, {
        headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" },
      });
    }
    if (url.pathname === "/sitemap.xml") {
      const lastmod = pointer.publishedAt.slice(0, 10);
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://${hostname}/</loc><lastmod>${lastmod}</lastmod></url></urlset>\n`,
        { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } },
      );
    }
    if (url.pathname === "/" || url.pathname === "/index.html") {
      const page = await serveObject(env, r2PageKey(siteId, pointer.versionId), "public, max-age=60");
      if (page) {
        page.headers.set("x-site-version", String(pointer.number));
        return page;
      }
      return notFound("페이지 파일을 찾지 못했습니다.");
    }
    return notFound("없는 주소입니다.");
  },
};
