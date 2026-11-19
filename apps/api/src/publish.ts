import { ASSET_VERSION, RENDER_VERSION, renderSite, type SiteConfig } from "@sites/renderer";
import type { Env } from "./env.js";
import { HttpError } from "./http.js";
import { kvSiteKey, r2PageKey, r2SharedKey, type PublishedPointer } from "./keys.js";
import { refreshBilling, requirePublishable } from "./billing.js";
import { syncBlogFeed } from "./blog.js";
import { ensureNotPurged } from "./purge-guard.js";
import { routesOf, syncHostRecordsNow } from "./routes.js";
import {
  getSite,
  getVersion,
  latestVersion,
  markPublished,
  markRendered,
  primaryHostname,
  type SiteRow,
  type VersionRow,
} from "./store.js";

export const assetBase = () => `/_shared/${ASSET_VERSION}`;

/** Turnstile frame URL baked into published pages; null when Turnstile is not configured. */
export const turnstileFrameUrl = (env: Env) =>
  env.TURNSTILE_SITE_KEY && env.API_ORIGIN ? `${env.API_ORIGIN}/turnstile-frame` : null;

/** Public origin a site is served from: its active custom domain, else `<slug>.<BASE_DOMAIN>`. */
export async function siteOrigin(env: Env, site: SiteRow) {
  const host = await primaryHostname(env.DB, site, env.BASE_DOMAIN);
  return `${env.PUBLIC_SCHEME ?? "https"}://${host}`;
}

let cssCache: { version: string; text: string } | null = null;

/**
 * The shared stylesheet of the current asset version, inlined into public and draft pages so
 * the first paint does not wait for a CSS request. Only the finished text is cached (per isolate
 * and version): each read stays within its own request, so a cancelled one cannot stall others.
 */
export async function sharedCss(env: Env): Promise<string> {
  if (cssCache?.version === ASSET_VERSION) return cssCache.text;
  const object = await env.SITES.get(r2SharedKey(`${ASSET_VERSION}/_assets/site.css`));
  if (!object) throw new HttpError(409, `공용 에셋 ${ASSET_VERSION}이 R2에 없습니다. scripts/upload-shared.mjs를 먼저 실행하세요`);
  const text = await object.text();
  cssCache = { version: ASSET_VERSION, text };
  return text;
}

async function requireSharedAssets(env: Env) {
  const head = await env.SITES.head(r2SharedKey(`${ASSET_VERSION}/_assets/site.css`));
  if (!head) {
    throw new HttpError(409, `공용 에셋 ${ASSET_VERSION}이 R2에 없습니다. scripts/upload-shared.mjs를 먼저 실행하세요`);
  }
}

/** Everything outside the config that changes the HTML (stored in rendered_origin). */
export const renderKeyOf = (env: Env, origin: string) => JSON.stringify({ origin, turnstileFrame: turnstileFrameUrl(env) });

/**
 * Renders every page of a version with the current renderer and shared assets under a fresh,
 * immutable render_id. Nothing points at it yet: concurrent renders never mix pages.
 */
export async function renderToR2(env: Env, version: VersionRow, origin: string) {
  const config = JSON.parse(version.config) as SiteConfig;
  // HTML comes from the current renderer, so it must point at the current client bundle.
  await requireSharedAssets(env);
  const { pages } = await renderSite(config, { assetBase: assetBase(), origin, turnstileFrame: turnstileFrameUrl(env), inlineCss: await sharedCss(env) });
  const renderId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const written: string[] = [];
  for (const page of pages) {
    const key = r2PageKey(version.site_id, version.id, page.path, renderId);
    written.push(key);
    await env.SITES.put(key, page.html, { httpMetadata: { contentType: "text/html; charset=utf-8" } });
  }
  // Any render (publish, rollback, domain maintenance, republish) cleans up if a purge started.
  await ensureNotPurged(env, version.site_id, written);
  return { renderId, renderKey: renderKeyOf(env, origin), routes: pages.map((page) => page.route) };
}

/**
 * Renders a version unless it is already rendered against the current shared assets and
 * origin, then records the render (the pointer follows it on the next sync).
 */
async function ensureRendered(env: Env, version: VersionRow, origin: string, { keepAssets = false } = {}) {
  const config = JSON.parse(version.config) as SiteConfig;
  // Rollback keeps the version's own render; publish moves it to the current renderer and assets.
  // (site_versions.asset_version holds RENDER_VERSION: assets plus server renderer.)
  const assetsOk = keepAssets || version.asset_version === RENDER_VERSION;
  if (version.rendered_at && assetsOk && version.rendered_origin === renderKeyOf(env, origin)) {
    return routesOf(config);
  }
  const render = await renderToR2(env, version, origin);
  await markRendered(env.DB, version.id, RENDER_VERSION, render.renderKey, render.renderId);
  return render.routes;
}

async function pointTo(env: Env, site: SiteRow, version: VersionRow, pages: string[]) {
  const publishedAt = await markPublished(env.DB, site.id, version.id, RENDER_VERSION);
  const renderId = (await getVersion(env.DB, site.id, version.id)).render_id;
  const pointer: PublishedPointer = { versionId: version.id, number: version.number, publishedAt, pages, renderId };
  await env.ROUTES.put(kvSiteKey(site.id), JSON.stringify(pointer));
  await syncHostRecordsNow(env, site.id);
  await syncBlogFeed(env, site.id, JSON.parse(version.config) as { business?: { blogUrl?: string } });
  return pointer;
}

/** Publish = render (if needed) → R2 → move the KV pointer. Visible worldwide within about a minute. */
export async function publish(env: Env, site: SiteRow, versionId?: string) {
  if (site.cancelled_at) throw new HttpError(409, "해지된 사이트입니다. 먼저 해지를 취소하세요");
  await requirePublishable(env.DB, site.id);
  await requireSharedAssets(env);
  const version = versionId ? await getVersion(env.DB, site.id, versionId) : await latestVersion(env.DB, site.id);
  const pages = await ensureRendered(env, version, await siteOrigin(env, site));
  const pointer = await pointTo(env, site, version, pages);
  // Payments may have changed while rendering; serving follows billing as of now.
  await refreshBilling(env, site.id);
  return pointer;
}

/**
 * Rollback = move the pointer back to a version that was published before. No re-render, unless
 * the site's origin changed since that version was rendered (custom domain added or removed):
 * then only its HTML is re-rendered so canonical and OG URLs point at the current host.
 */
export async function rollback(env: Env, site: SiteRow, versionId: string) {
  if (site.cancelled_at) throw new HttpError(409, "해지된 사이트입니다. 먼저 해지를 취소하세요");
  await requirePublishable(env.DB, site.id);
  const version = await getVersion(env.DB, site.id, versionId);
  if (!version.first_published_at) throw new HttpError(409, "게시된 적 없는 버전으로는 롤백할 수 없습니다");
  const exists = await env.SITES.head(r2PageKey(site.id, version.id, "index.html", version.render_id));
  if (!exists) throw new HttpError(409, "렌더된 파일이 R2에 없습니다. publish로 다시 게시하세요");
  const pages = await ensureRendered(env, version, await siteOrigin(env, site), { keepAssets: true });
  const pointer = await pointTo(env, site, version, pages);
  await refreshBilling(env, site.id);
  return pointer;
}

/**
 * The site's origin changed (custom domain activated, failed or removed): re-render the live
 * version's HTML in place (same R2 keys). The KV pointer is not touched, so this can never undo
 * a concurrent publish; if the live version changes meanwhile, the new one is checked too.
 * Returns false when it could not settle (the caller keeps origin_pending for the cron).
 */
export async function rerenderLive(env: Env, siteId: string): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const site = await getSite(env.DB, siteId);
    if (!site.published_version_id) {
      await syncHostRecordsNow(env, siteId);
      return true;
    }
    const version = await getVersion(env.DB, siteId, site.published_version_id);
    await ensureRendered(env, version, await siteOrigin(env, site));
    // Settled only if the live version is unchanged and its HTML matches the origin as of now
    // (an overlapping domain change may have moved it while this render ran).
    const after = await getSite(env.DB, siteId);
    const rendered = await getVersion(env.DB, siteId, version.id);
    if (after.published_version_id === version.id && rendered.rendered_origin === renderKeyOf(env, await siteOrigin(env, after))) {
      await syncHostRecordsNow(env, siteId);
      return true;
    }
  }
  return false;
}
