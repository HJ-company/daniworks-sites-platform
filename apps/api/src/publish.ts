import { ASSET_VERSION, renderSite, type SiteConfig } from "@sites/renderer";
import type { Env } from "./env.js";
import { HttpError } from "./http.js";
import { kvSiteKey, r2PageKey, r2SharedKey, type PublishedPointer } from "./keys.js";
import { getVersion, latestVersion, markPublished, markRendered, type SiteRow, type VersionRow } from "./store.js";

export const assetBase = () => `/_shared/${ASSET_VERSION}`;

async function requireSharedAssets(env: Env) {
  const head = await env.SITES.head(r2SharedKey(`${ASSET_VERSION}/_assets/site.css`));
  if (!head) {
    throw new HttpError(409, `공용 에셋 ${ASSET_VERSION}이 R2에 없습니다. scripts/upload-shared.mjs를 먼저 실행하세요`);
  }
}

/** Renders a version to R2 unless it is already rendered against the current shared assets. */
async function ensureRendered(env: Env, version: VersionRow) {
  if (version.rendered_at && version.asset_version === ASSET_VERSION) return;
  const config = JSON.parse(version.config) as SiteConfig;
  const { html } = await renderSite(config, { assetBase: assetBase() });
  await env.SITES.put(r2PageKey(version.site_id, version.id), html, {
    httpMetadata: { contentType: "text/html; charset=utf-8" },
  });
  await markRendered(env.DB, version.id, ASSET_VERSION);
}

async function pointTo(env: Env, site: SiteRow, version: VersionRow) {
  const publishedAt = await markPublished(env.DB, site.id, version.id);
  const pointer: PublishedPointer = { versionId: version.id, number: version.number, publishedAt };
  await env.ROUTES.put(kvSiteKey(site.id), JSON.stringify(pointer));
  return pointer;
}

/** Publish = render (if needed) → R2 → move the KV pointer. Visible worldwide within about a minute. */
export async function publish(env: Env, site: SiteRow, versionId?: string) {
  await requireSharedAssets(env);
  const version = versionId ? await getVersion(env.DB, site.id, versionId) : await latestVersion(env.DB, site.id);
  await ensureRendered(env, version);
  return pointTo(env, site, version);
}

/** Rollback = move the pointer back to a version that was published before. No re-render. */
export async function rollback(env: Env, site: SiteRow, versionId: string) {
  const version = await getVersion(env.DB, site.id, versionId);
  if (!version.first_published_at) throw new HttpError(409, "게시된 적 없는 버전으로는 롤백할 수 없습니다");
  const exists = await env.SITES.head(r2PageKey(site.id, version.id));
  if (!exists) throw new HttpError(409, "렌더된 파일이 R2에 없습니다. publish로 다시 게시하세요");
  return pointTo(env, site, version);
}
