import { createRemoteJWKSet, jwtVerify } from "jose";

interface Env {
  ASSETS: Fetcher;
  API: Fetcher;
  ADMIN_TOKEN: string;
  /** Cloudflare Access team domain (`daniworks.cloudflareaccess.com`) and application AUD. */
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  /** Local development only: skip the Access check. Never set in deployed environments. */
  ALLOW_UNAUTHENTICATED?: string;
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

/**
 * Operators reach the console through Cloudflare Access. This re-verifies Access's JWT so the
 * Worker is safe even if a route bypasses Access; without Access config it refuses to serve.
 */
async function authorized(request: Request, env: Env): Promise<boolean> {
  if (env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD) {
    const token = request.headers.get("cf-access-jwt-assertion");
    if (!token) return false;
    jwks ??= createRemoteJWKSet(new URL(`https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`));
    try {
      await jwtVerify(token, jwks, { issuer: `https://${env.ACCESS_TEAM_DOMAIN}`, audience: env.ACCESS_AUD });
      return true;
    } catch {
      return false;
    }
  }
  return env.ALLOW_UNAUTHENTICATED === "true";
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!(await authorized(request, env))) {
      return new Response("운영자 인증이 필요합니다", { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    const url = new URL(request.url);
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      // Forward to the api Worker with the admin token; drop anything credential-like from the browser.
      const target = new URL(url.pathname.slice(4) || "/", "https://api.internal");
      target.search = url.search;
      const headers = new Headers(request.headers);
      headers.delete("cookie");
      headers.delete("cf-access-jwt-assertion");
      headers.set("authorization", `Bearer ${env.ADMIN_TOKEN}`);
      return env.API.fetch(new Request(target, { method: request.method, headers, body: request.body, redirect: "manual" }));
    }
    return env.ASSETS.fetch(request);
  },
};
