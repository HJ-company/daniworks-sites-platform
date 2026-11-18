import { describe, expect, it, vi } from "vitest";
import worker from "../worker/index.js";

const assets = { fetch: vi.fn(async () => new Response("spa")) };
const api = { fetch: vi.fn(async (req: Request) => Response.json({ path: new URL(req.url).pathname, auth: req.headers.get("authorization"), cookie: req.headers.get("cookie") })) };
const env = (extra: Record<string, string> = {}) => ({ ASSETS: assets, API: api, ADMIN_TOKEN: "secret", ...extra }) as never;

describe("console worker", () => {
  it("refuses everything without Access config or the local flag", async () => {
    const res = await worker.fetch(new Request("https://admin.example/"), env());
    expect(res.status).toBe(403);
  });

  it("refuses requests without an Access JWT when Access is configured", async () => {
    const res = await worker.fetch(new Request("https://admin.example/api/sites"), env({ ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com", ACCESS_AUD: "aud" }));
    expect(res.status).toBe(403);
  });

  it("refuses a forged Access JWT", async () => {
    const res = await worker.fetch(
      new Request("https://admin.example/", { headers: { "cf-access-jwt-assertion": "e30.e30.sig" } }),
      env({ ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com", ACCESS_AUD: "aud" }),
    );
    expect(res.status).toBe(403);
  });

  it("proxies /api with the server-side token, replacing browser credentials", async () => {
    const res = await worker.fetch(
      new Request("https://admin.example/api/sites?x=1", { headers: { authorization: "Bearer forged", cookie: "a=b" } }),
      env({ ALLOW_UNAUTHENTICATED: "true" }),
    );
    expect(await res.json()).toEqual({ path: "/sites", auth: "Bearer secret", cookie: null });
  });

  it("serves the SPA for other paths", async () => {
    const res = await worker.fetch(new Request("https://admin.example/sites/abc"), env({ ALLOW_UNAUTHENTICATED: "true" }));
    expect(await res.text()).toBe("spa");
  });
});
