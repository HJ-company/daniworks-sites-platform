import { ASSET_VERSION, renderSite, type SiteConfig } from "@sites/renderer";
import type { Env } from "./env.js";
import { HttpError } from "./http.js";
import { kvSiteKey, r2PageKey, r2SharedKey, type PublishedPointer } from "./keys.js";
import { routesOf, syncHostRecordsNow } from "./routes.js";
import {
  getVersion,
  latestVersion,
  markPublished,
  markRendered,
  primaryHostname,
  type SiteRow,
  type VersionRow,
} from "./store.js";

export const assetBase = () => `/_shared/${ASSET_VERSION}`;

/** Public origin a site is served from: its active custom domain, else `<slug>.<BASE_DOMAIN>`. */
export async function siteOrigin(env: Env, site: SiteRow) {
  const host = await primaryHostname(env.DB, site, env.BASE_DOMAIN);
  return `${env.PUBLIC_SCHEME ?? "https"}://${host}`;
}

async function requireSharedAssets(env: Env) {
  const head = await env.SITES.head(r2SharedKey(`${ASSET_VERSION}/_assets/site.css`));
  if (!head) {
    throw new HttpError(409, `공용 에셋 ${ASSET_VERSION}이 R2에 없습니다. scripts/upload-shared.mjs를 먼저 실행하세요`);
  }
}

/**
 * Renders every page of a version to R2 unless it is already rendered against the current
 * shared assets and origin.
 */
async function ensureRendered(env: Env, version: VersionRow, origin: string) {
  const config = JSON.parse(version.config) as SiteConfig;
  if (version.rendered_at && version.asset_version === ASSET_VERSION && version.rendered_origin === origin) {
    return routesOf(config);
  }
  const { pages } = await renderSite(config, { assetBase: assetBase(), origin });
  for (const page of pages) {
    await env.SITES.put(r2PageKey(version.site_id, version.id, page.path), page.html, {
      httpMetadata: { contentType: "text/html; charset=utf-8" },
    });
  }
  await markRendered(env.DB, version.id, ASSET_VERSION, origin);
  return pages.map((page) => page.route);
}

async function pointTo(env: Env, site: SiteRow, version: VersionRow, pages: string[]) {
  const publishedAt = await markPublished(env.DB, site.id, version.id, ASSET_VERSION);
  const pointer: PublishedPointer = { versionId: version.id, number: version.number, publishedAt, pages };
  await env.ROUTES.put(kvSiteKey(site.id), JSON.stringify(pointer));
  await syncHostRecordsNow(env, site.id);
  return pointer;
}

/** Publish = render (if needed) → R2 → move the KV pointer. Visible worldwide within about a minute. */
export async function publish(env: Env, site: SiteRow, versionId?: string) {
  await requireSharedAssets(env);
  const version = versionId ? await getVersion(env.DB, site.id, versionId) : await latestVersion(env.DB, site.id);
  const pages = await ensureRendered(env, version, await siteOrigin(env, site));
  return pointTo(env, site, version, pages);
}

/** Rollback = move the pointer back to a version that was published before. No re-render. */
export async function rollback(env: Env, site: SiteRow, versionId: string) {
  const version = await getVersion(env.DB, site.id, versionId);
  if (!version.first_published_at) throw new HttpError(409, "게시된 적 없는 버전으로는 롤백할 수 없습니다");
  const exists = await env.SITES.head(r2PageKey(site.id, version.id));
  if (!exists) throw new HttpError(409, "렌더된 파일이 R2에 없습니다. publish로 다시 게시하세요");
  return pointTo(env, site, version, routesOf(JSON.parse(version.config) as SiteConfig));
}
