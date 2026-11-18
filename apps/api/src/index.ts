import { parseSiteConfig, renderSite, SiteConfigError, type SiteConfig } from "@sites/renderer";
import { listAssets, uploadAsset } from "./assets.js";
import type { Env } from "./env.js";
import { HttpError, json, readJson, requireAdmin } from "./http.js";
import { MEDIA_PATH, r2MediaKey, r2SharedKey } from "./keys.js";
import { auditHostRecords, reconcileHostRecords, syncHostRecordsNow } from "./routes.js";

/** Must match wrangler.toml [triggers]: the hourly audit; the 5-minute cron only reconciles. */
const AUDIT_CRON = "17 * * * *";
import { assetBase, publish, rollback, siteOrigin } from "./publish.js";
import {
  addVersion,
  createSite,
  getSite,
  listVersions,
  setSiteStatus,
  versionByPreviewToken,
  type CreatedBy,
} from "./store.js";

const CREATORS: CreatedBy[] = ["ai", "operator", "customer"];

/** Parsed config with defaults filled; what gets stored. */
function validated(input: unknown): SiteConfig {
  const result = parseSiteConfig(input);
  if (!result.ok) throw new HttpError(422, "설정 검증 실패", result.errors);
  return result.config;
}

function creator(value: unknown): CreatedBy {
  return CREATORS.includes(value as CreatedBy) ? (value as CreatedBy) : "operator";
}

async function serveImmutable(env: Env, key: string) {
  const object = await env.SITES.get(key);
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
  if (method === "GET" && parts[0] === "_shared") return serveImmutable(env, r2SharedKey(parts.slice(1).join("/")));
  // Uploaded photos (public, content-addressed) so previews show them before publishing.
  const media = method === "GET" ? MEDIA_PATH.exec(url.pathname) : null;
  if (media) return serveImmutable(env, r2MediaKey(media[1]!, media[2]!));

  // Preview: anyone with the token can view a version. Never indexed. /preview/<token>[/privacy]
  if (method === "GET" && parts[0] === "preview" && (parts.length === 2 || parts.length === 3)) {
    const version = await versionByPreviewToken(env.DB, parts[1]!);
    const site = await getSite(env.DB, version.site_id);
    const { pages } = await renderSite(JSON.parse(version.config) as SiteConfig, {
      assetBase: assetBase(),
      origin: await siteOrigin(env, site),
      preview: true,
      // Site links are root-relative (`/#inquiry`, `/privacy`); keep them inside this preview.
      linkPrefix: `/preview/${parts[1]}`,
    });
    const route = parts[2] ? `/${parts[2]}` : "/";
    const page = pages.find((entry) => entry.route === route);
    if (!page) throw new HttpError(404, "없는 페이지입니다");
    return new Response(page.html, {
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
    const body = await readJson<{ config: unknown; createdBy?: CreatedBy }>(request);
    const config = validated(body.config);
    const hostname = `${config.slug}.${env.BASE_DOMAIN}`;
    const { siteId, versionId } = await createSite(env.DB, config, creator(body.createdBy), hostname);
    await syncHostRecordsNow(env, siteId);
    return json({ siteId, versionId, hostname }, 201);
  }

  const site = await getSite(env.DB, parts[1]!);

  if (method === "GET" && parts.length === 2) {
    return json({ site, versions: await listVersions(env.DB, site.id) });
  }

  // POST /sites/:id/versions {config, createdBy, note}: new draft version
  if (method === "POST" && parts[2] === "versions") {
    const body = await readJson<{ config: unknown; createdBy?: CreatedBy; note?: string }>(request);
    const result = await addVersion(env.DB, site, validated(body.config), creator(body.createdBy), body.note ?? null);
    return json(result, 201);
  }

  // POST /sites/:id/assets: raw image body, or JSON {url}. GET lists them.
  if (parts[2] === "assets" && parts.length === 3) {
    if (method === "POST") return json(await uploadAsset(env, site, request), 201);
    if (method === "GET") return json({ assets: await listAssets(env, site) });
  }

  // POST /sites/:id/publish {versionId?}: latest version when omitted
  if (method === "POST" && parts[2] === "publish") {
    const body = await readJson<{ versionId?: string }>(request).catch(() => ({}) as { versionId?: string });
    return json(await publish(env, site, body.versionId));
  }

  // POST /sites/:id/suspend | /resume: stop or restart public serving (non-payment, requests).
  if (method === "POST" && (parts[2] === "suspend" || parts[2] === "resume") && parts.length === 3) {
    if (site.cancelled_at) throw new HttpError(409, "해지된 사이트입니다");
    const status = parts[2] === "suspend" ? "suspended" : "active";
    await setSiteStatus(env.DB, site.id, status);
    await syncHostRecordsNow(env, site.id);
    return json({ siteId: site.id, status });
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
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      (async () => {
        if (controller.cron === AUDIT_CRON) console.log("[routes] audit", JSON.stringify(await auditHostRecords(env)));
        console.log("[routes] reconcile", JSON.stringify(await reconcileHostRecords(env)));
      })(),
    );
  },

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
