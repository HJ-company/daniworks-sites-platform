import { afterEach, describe, expect, it, vi } from "vitest";
import worker, { safeReturn } from "../worker/index.js";

const ISSUER = "https://auth.example/application/o/dsites-console/";
const assets = { fetch: vi.fn(async () => new Response("spa")) };
const api = { fetch: vi.fn(async (req: Request) => Response.json({ auth: req.headers.get("authorization"), cookie: req.headers.get("cookie") })) };
const configured = {
  ASSETS: assets,
  API: api,
  OIDC_ISSUER: ISSUER,
  OIDC_CLIENT_ID: "dsites-console",
  OIDC_CLIENT_SECRET: "secret",
  SESSION_SECRET: "x".repeat(40),
} as never;

// Discovery only: these tests never reach the token endpoint.
vi.stubGlobal(
  "fetch",
  vi.fn(async () =>
    Response.json({
      authorization_endpoint: "https://auth.example/application/o/authorize/",
      token_endpoint: "https://auth.example/application/o/token/",
      jwks_uri: "https://auth.example/application/o/dsites-console/jwks/",
      end_session_endpoint: "https://auth.example/application/o/dsites-console/end-session/",
    }),
  ),
);
afterEach(() => api.fetch.mockClear());

describe("console worker", () => {
  it("refuses to run without login settings", async () => {
    const res = await worker.fetch(new Request("https://console.example/"), { ASSETS: assets, API: api } as never);
    expect(res.status).toBe(503);
  });

  it("refuses a short session secret", async () => {
    const res = await worker.fetch(new Request("https://console.example/"), { ...(configured as object), SESSION_SECRET: "short" } as never);
    expect(res.status).toBe(503);
  });

  it("sends pages without a session to the login", async () => {
    const res = await worker.fetch(new Request("https://console.example/sites/abc?tab=x"), configured);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://console.example/auth/login?return=%2Fsites%2Fabc%3Ftab%3Dx");
  });

  it("serves built assets without a session (no data in them)", async () => {
    const res = await worker.fetch(new Request("https://console.example/assets/index-abc.js"), configured);
    expect(await res.text()).toBe("spa");
  });

  it("answers /api without a session with 401 and never calls the api", async () => {
    const res = await worker.fetch(new Request("https://console.example/api/sites", { headers: { authorization: "Bearer forged" } }), configured);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ login: "/auth/login" });
    expect(api.fetch).not.toHaveBeenCalled();
  });

  it("ignores a forged session cookie", async () => {
    const res = await worker.fetch(new Request("https://console.example/api/sites", { headers: { cookie: "dsites_session=abc.def" } }), configured);
    expect(res.status).toBe(401);
  });

  it("starts the login with PKCE S256, state and nonce, keeping the return path same-site", async () => {
    const res = await worker.fetch(new Request("https://console.example/auth/login?return=//evil.example"), configured);
    expect(res.status).toBe(302);
    const target = new URL(res.headers.get("location")!);
    expect(target.origin + target.pathname).toBe("https://auth.example/application/o/authorize/");
    expect(target.searchParams.get("client_id")).toBe("dsites-console");
    expect(target.searchParams.get("code_challenge_method")).toBe("S256");
    expect(target.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(target.searchParams.get("state")).toBeTruthy();
    expect(target.searchParams.get("nonce")).toBeTruthy();
    expect(target.searchParams.get("redirect_uri")).toBe("https://console.example/auth/callback");
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toMatch(/^dsites_login=[^;]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=600; Secure$/);
    // The pending login is encrypted: no verifier or return path in clear text.
    expect(cookie).not.toContain("evil");
  });

  it("never carries a login back to another site, however the return path is spelled", () => {
    const origin = "https://console.example";
    for (const evil of ["/\t/evil.example", "//evil.example", "/\\evil.example", "https://evil.example/x", "javascript:alert(1)", "https://console.example//evil.example"]) {
      expect(safeReturn(evil, origin)).toBe("/");
    }
    expect(safeReturn("/payments?tab=history", origin)).toBe("/payments?tab=history");
    expect(safeReturn(null, origin)).toBe("/");
  });

  it("rejects a callback whose state does not match", async () => {
    const res = await worker.fetch(new Request("https://console.example/auth/callback?code=c&state=wrong"), configured);
    expect(res.status).toBe(400);
  });

  it("logs out by clearing the session and ending the Authentik session", async () => {
    const res = await worker.fetch(new Request("https://console.example/auth/logout"), configured);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      "https://auth.example/application/o/dsites-console/end-session/?post_logout_redirect_uri=https%3A%2F%2Fconsole.example%2F",
    );
    const cleared = res.headers.getSetCookie();
    expect(cleared).toContain("dsites_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure");
    expect(cleared).toContain("dsites_session.4=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure");
  });
});
