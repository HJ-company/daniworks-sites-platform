import { renderSite, SiteConfigError, validateSiteConfig, type SiteConfig } from "@sites/renderer";
import type { Env } from "./env.js";
import { HttpError, json, readJson, requireAdmin } from "./http.js";
import { kvHostKey, r2SharedKey } from "./keys.js";
import { assetBase, publish, rollback } from "./publish.js";
import {
  addVersion,
  createSite,
  getSite,
  listVersions,
  versionByPreviewToken,
  type CreatedBy,
} from "./store.js";

const CREATORS: CreatedBy[] = ["ai", "operator", "customer"];

function validated(config: SiteConfig) {
  const errors = validateSiteConfig(config);
  if (errors.length) throw new HttpError(422, "설정 검증 실패", errors);
  return config;
}

function creator(value: unknown): CreatedBy {
  return CREATORS.includes(value as CreatedBy) ? (value as CreatedBy) : "operator";
}

async function serveShared(env: Env, path: string) {
  const object = await env.SITES.get(r2SharedKey(path));
  if (!object) return new Response("not found", { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("cache-control", "public, max-age=31536000, immutable");
  return new Response(object.body, { headers });
}

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const method = request.method;

  if (method === "GET" && url.pathname === "/health") return json({ ok: true });

  // Shared assets are public and immutable; previews load them from here.
  if (method === "GET" && parts[0] === "_shared") return serveShared(env, parts.slice(1).join("/"));

  // Preview: anyone with the token can view a version. Never indexed.
  if (method === "GET" && parts[0] === "preview" && parts.length === 2) {
    const version = await versionByPreviewToken(env.DB, parts[1]!);
    const { html } = await renderSite(JSON.parse(version.config) as SiteConfig, { assetBase: assetBase() });
    return new Response(html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "x-robots-tag": "noindex, nofollow",
        "cache-control": "no-store",
      },
    });
  }

  requireAdmin(request, env.ADMIN_TOKEN);

  // PUT /admin/shared/<version>/<path>: upload one shared asset file.
  if (method === "PUT" && parts[0] === "admin" && parts[1] === "shared" && parts.length > 3) {
    const key = r2SharedKey(parts.slice(2).join("/"));
    await env.SITES.put(key, request.body, {
      httpMetadata: { contentType: request.headers.get("content-type") ?? "application/octet-stream" },
    });
    return json({ key }, 201);
  }

  if (parts[0] !== "sites") throw new HttpError(404, "없는 경로입니다");

  // POST /sites {config, createdBy}
  if (method === "POST" && parts.length === 1) {
    const body = await readJson<{ config: SiteConfig; createdBy?: CreatedBy }>(request);
    const config = validated(body.config);
    const hostname = `${config.slug}.${env.BASE_DOMAIN}`;
    const { siteId, versionId } = await createSite(env.DB, config, creator(body.createdBy), hostname);
    await env.ROUTES.put(kvHostKey(hostname), siteId);
    return json({ siteId, versionId, hostname }, 201);
  }

  const site = await getSite(env.DB, parts[1]!);

  if (method === "GET" && parts.length === 2) {
    return json({ site, versions: await listVersions(env.DB, site.id) });
  }

  // POST /sites/:id/versions {config, createdBy, note}: new draft version
  if (method === "POST" && parts[2] === "versions") {
    const body = await readJson<{ config: SiteConfig; createdBy?: CreatedBy; note?: string }>(request);
    const result = await addVersion(env.DB, site, validated(body.config), creator(body.createdBy), body.note ?? null);
    return json(result, 201);
  }

  // POST /sites/:id/publish {versionId?}: latest version when omitted
  if (method === "POST" && parts[2] === "publish") {
    const body = await readJson<{ versionId?: string }>(request).catch(() => ({}) as { versionId?: string });
    return json(await publish(env, site, body.versionId));
  }

  // POST /sites/:id/rollback {versionId}
  if (method === "POST" && parts[2] === "rollback") {
    const body = await readJson<{ versionId: string }>(request);
    if (!body.versionId) throw new HttpError(400, "versionId가 필요합니다");
    return json(await rollback(env, site, body.versionId));
  }

  throw new HttpError(404, "없는 경로입니다");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handle(request, env);
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message, details: error.details }, error.status);
      if (error instanceof SiteConfigError) return json({ error: "설정 검증 실패", details: error.errors }, 422);
      console.error(error);
      return json({ error: "서버 오류" }, 500);
    }
  },
};
