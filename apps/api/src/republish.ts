import { RENDER_VERSION } from "@sites/renderer";
import type { Env } from "./env.js";
import { HttpError } from "./http.js";
import { r2PageKey } from "./keys.js";
import { renderKeyOf, renderToR2, siteOrigin } from "./publish.js";
import { syncHostRecordsNow } from "./routes.js";
import { getSite, getVersion, primaryHostname } from "./store.js";

/**
 * Full republish after a renderer or template update, in three explicit steps so a visual
 * check can sit between rendering and serving: plan → stage (render, not served) → commit.
 */
export async function republishPlan(env: Env) {
  const { results } = await env.DB.prepare(
    `SELECT s.id, s.slug, s.published_version_id AS version_id, v.number, v.asset_version
     FROM sites s JOIN site_versions v ON v.id = s.published_version_id
     WHERE s.cancelled_at IS NULL ORDER BY s.slug`,
  ).all<{ id: string; slug: string; version_id: string; number: number; asset_version: string | null }>();
  const sites = [];
  for (const row of results) {
    const site = await getSite(env.DB, row.id);
    sites.push({
      siteId: row.id,
      slug: row.slug,
      versionId: row.version_id,
      number: row.number,
      assetVersion: row.asset_version,
      outdated: row.asset_version !== RENDER_VERSION,
      liveUrl: `${env.PUBLIC_SCHEME ?? "https"}://${await primaryHostname(env.DB, site, env.BASE_DOMAIN)}/`,
    });
  }
  return { renderVersion: RENDER_VERSION, total: sites.length, outdated: sites.filter((s) => s.outdated).length, sites };
}

/** Renders the live version with the current renderer under a new render_id. Not served. */
export async function stageRepublish(env: Env, siteId: string) {
  const site = await getSite(env.DB, siteId);
  if (site.cancelled_at) throw new HttpError(409, "해지된 사이트입니다");
  if (!site.published_version_id) throw new HttpError(409, "게시된 버전이 없습니다");
  const version = await getVersion(env.DB, siteId, site.published_version_id);
  // renderToR2 itself refuses (and cleans up) if the site is being purged.
  const render = await renderToR2(env, version, await siteOrigin(env, site));
  await env.DB.prepare(
    `INSERT INTO staged_renders (render_id, site_id, version_id, render_key, asset_version, base_render_id, created_at)
     SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM sites WHERE id = ? AND purging_at IS NULL)`,
  )
    .bind(render.renderId, siteId, version.id, render.renderKey, RENDER_VERSION, version.render_id, new Date().toISOString(), siteId)
    .run();
  return {
    siteId,
    versionId: version.id,
    renderId: render.renderId,
    stagedPath: `/staged/${siteId}/${render.renderId}/`,
    /** Every route in the render; all must look the same before committing. */
    routes: render.routes,
  };
}

/**
 * Serves the staged render (switched in only after a visual check). Valid only while that
 * version is still live and its origin unchanged, so an older render cannot replace newer work.
 */
export async function commitRepublish(env: Env, siteId: string, renderId: string) {
  const staged = await env.DB.prepare("SELECT * FROM staged_renders WHERE render_id = ? AND site_id = ?")
    .bind(renderId, siteId)
    .first<{ version_id: string; render_key: string; asset_version: string; base_render_id: string | null }>();
  if (!staged) throw new HttpError(404, "스테이지 렌더가 없습니다");
  // Staged before a renderer deployment: committing it would downgrade newer renders.
  if (staged.asset_version !== RENDER_VERSION) throw new HttpError(409, "이전 배포에서 만든 스테이지입니다. 다시 스테이지하세요");
  const site = await getSite(env.DB, siteId);
  if (site.published_version_id !== staged.version_id) throw new HttpError(409, "그사이 다른 버전이 게시되었습니다. 다시 스테이지하세요");
  if (staged.render_key !== renderKeyOf(env, await siteOrigin(env, site))) {
    throw new HttpError(409, "그사이 사이트 주소가 바뀌었습니다. 다시 스테이지하세요");
  }
  const now = new Date().toISOString();
  // One transaction: switch the render (fenced on the live render at staging time — a domain
  // change or publish since then wins), and only if that applied, mark the site for route
  // reconciliation and clear its stages. A failure after this still converges via the cron.
  const applied = `EXISTS (SELECT 1 FROM site_versions WHERE id = ? AND render_id = ?)`;
  const [updated] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE site_versions SET render_id = ?, rendered_origin = ?, asset_version = ?, rendered_at = ?
       WHERE id = ? AND render_id IS ? AND id = (SELECT published_version_id FROM sites WHERE id = ?)`,
    ).bind(renderId, staged.render_key, staged.asset_version, now, staged.version_id, staged.base_render_id, siteId),
    env.DB.prepare(
      `UPDATE sites SET template_version = ?, updated_at = ?, routes_synced_at = NULL WHERE id = ? AND ${applied}`,
    ).bind(staged.asset_version, now, siteId, staged.version_id, renderId),
    env.DB.prepare(`DELETE FROM staged_renders WHERE site_id = ? AND ${applied}`).bind(siteId, staged.version_id, renderId),
  ]);
  if (updated?.meta.changes !== 1) throw new HttpError(409, "그사이 게시나 주소 변경이 있었습니다. 다시 스테이지하세요");
  await syncHostRecordsNow(env, siteId);
  return { siteId, versionId: staged.version_id, renderId, assetVersion: staged.asset_version };
}

/** Raw staged HTML for the visual check (admin only). `path`: `` or `privacy`. */
export async function stagedPage(env: Env, siteId: string, renderId: string, path: string) {
  const staged = await env.DB.prepare("SELECT version_id FROM staged_renders WHERE render_id = ? AND site_id = ?")
    .bind(renderId, siteId)
    .first<{ version_id: string }>();
  if (!staged) throw new HttpError(404, "스테이지 렌더가 없습니다");
  const object = await env.SITES.get(r2PageKey(siteId, staged.version_id, path ? `${path}/index.html` : "index.html", renderId));
  if (!object) throw new HttpError(404, "페이지가 없습니다");
  return new Response(object.body, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" },
  });
}
