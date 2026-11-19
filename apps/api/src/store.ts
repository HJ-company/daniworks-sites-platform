import type { SiteConfig } from "@sites/renderer";
import { HttpError } from "./http.js";

export interface SiteRow {
  id: string;
  slug: string;
  template_id: string;
  published_version_id: string | null;
  status: string;
  customer_id: string | null;
  notify_email: string | null;
  template_version: string | null;
  cancelled_at: string | null;
  suspend_reason: "billing" | "manual" | null;
  preview_token: string | null;
  preview_expires_at: string | null;
  published_at: string | null;
  routes_synced_at: string | null;
  origin_pending: number;
  created_at: string;
  updated_at: string;
}

export interface VersionRow {
  id: string;
  site_id: string;
  number: number;
  config: string;
  created_by: string;
  note: string | null;
  preview_token: string;
  asset_version: string | null;
  rendered_at: string | null;
  rendered_origin: string | null;
  render_id: string | null;
  first_published_at: string | null;
  created_at: string;
}

export type CreatedBy = "ai" | "operator" | "customer";

const now = () => new Date().toISOString();
const token = () => crypto.randomUUID().replace(/-/g, "");

export async function getSite(db: D1Database, id: string): Promise<SiteRow> {
  const site = await db.prepare("SELECT * FROM sites WHERE id = ?").bind(id).first<SiteRow>();
  if (!site) throw new HttpError(404, `사이트가 없습니다: ${id}`);
  return site;
}

export async function getVersion(db: D1Database, siteId: string, versionId: string): Promise<VersionRow> {
  const row = await db
    .prepare("SELECT * FROM site_versions WHERE id = ? AND site_id = ?")
    .bind(versionId, siteId)
    .first<VersionRow>();
  if (!row) throw new HttpError(404, `버전이 없습니다: ${versionId}`);
  return row;
}

export async function latestVersion(db: D1Database, siteId: string): Promise<VersionRow> {
  const row = await db
    .prepare("SELECT * FROM site_versions WHERE site_id = ? ORDER BY number DESC LIMIT 1")
    .bind(siteId)
    .first<VersionRow>();
  if (!row) throw new HttpError(409, "버전이 없습니다");
  return row;
}

export async function listVersions(db: D1Database, siteId: string) {
  const { results } = await db
    .prepare(
      "SELECT id, number, created_by, author, note, preview_token, asset_version, rendered_at, first_published_at, created_at FROM site_versions WHERE site_id = ? ORDER BY number DESC",
    )
    .bind(siteId)
    .all();
  return results;
}

/** SQL condition: none of the photos a config (bound as the parameter) uses is being deleted. */
const NO_PHOTO_BEING_DELETED = `NOT EXISTS (SELECT 1 FROM assets WHERE deleting_at IS NOT NULL AND instr(?, '"' || key || '"') > 0)`;

/** `extra` statements (the subscription, the customer link) commit together with the site. */
export async function createSite(
  db: D1Database,
  config: SiteConfig,
  createdBy: CreatedBy,
  hostname: string,
  extra: (siteId: string) => D1PreparedStatement[] = () => [],
  author: string | null = null,
) {
  const exists = await db.prepare("SELECT id FROM sites WHERE slug = ?").bind(config.slug).first();
  if (exists) throw new HttpError(409, `이미 쓰는 slug입니다: ${config.slug}`);
  const siteId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const at = now();
  const json = JSON.stringify(config);
  // A photo being deleted skips the site row; the version insert then fails its foreign key and
  // the whole batch rolls back.
  const created = db.batch([
    db
      .prepare(`INSERT INTO sites (id, slug, template_id, created_at, updated_at) SELECT ?, ?, ?, ?, ? WHERE ${NO_PHOTO_BEING_DELETED}`)
      .bind(siteId, config.slug, config.templateId, at, at, json),
    db
      .prepare(
        "INSERT INTO site_versions (id, site_id, number, config, created_by, author, note, preview_token, created_at) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)",
      )
      .bind(versionId, siteId, json, createdBy, author, "최초 생성", token(), at),
    db
      .prepare("INSERT INTO domains (hostname, site_id, kind, created_at) VALUES (?, ?, 'subdomain', ?)")
      .bind(hostname, siteId, at),
    ...extra(siteId),
  ]);
  try {
    await created;
  } catch (error) {
    if (/FOREIGN KEY/i.test(String(error))) throw new HttpError(409, "지우는 중인 사진을 쓰고 있습니다. 다른 사진으로 바꾸세요");
    throw error;
  }
  return { siteId, versionId };
}

export async function addVersion(
  db: D1Database,
  site: SiteRow,
  config: SiteConfig,
  createdBy: CreatedBy,
  note: string | null,
  author: string | null = null,
) {
  if (config.slug !== site.slug) throw new HttpError(422, "slug는 바꿀 수 없습니다", [`slug: ${site.slug}`]);
  const latest = await latestVersion(db, site.id);
  const versionId = crypto.randomUUID();
  const at = now();
  const [inserted] = await db.batch([
    db
      .prepare(
        // Never into a site being purged (its rows are being deleted), nor with a photo being deleted.
        `INSERT INTO site_versions (id, site_id, number, config, created_by, author, note, preview_token, created_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM sites WHERE id = ? AND purging_at IS NULL) AND ${NO_PHOTO_BEING_DELETED}`,
      )
      .bind(versionId, site.id, latest.number + 1, JSON.stringify(config), createdBy, author, note, token(), at, site.id, JSON.stringify(config)),
    db.prepare("UPDATE sites SET updated_at = ? WHERE id = ?").bind(at, site.id),
  ]);
  if (inserted?.meta.changes !== 1) {
    const purging = await db.prepare("SELECT 1 AS x FROM sites WHERE id = ? AND purging_at IS NOT NULL").bind(site.id).first();
    throw new HttpError(409, purging ? "삭제 중인 사이트입니다" : "지우는 중인 사진을 쓰고 있습니다. 다른 사진으로 바꾸세요");
  }
  return { versionId, number: latest.number + 1 };
}

/**
 * Records a finished render in one statement: its id, assets and `renderKey` (stored in
 * rendered_origin: origin and other render inputs outside the config) always match its pages.
 */
export async function markRendered(db: D1Database, versionId: string, assetVersion: string, renderKey: string, renderId: string) {
  await db
    .prepare("UPDATE site_versions SET rendered_at = ?, asset_version = ?, rendered_origin = ?, render_id = ? WHERE id = ?")
    .bind(now(), assetVersion, renderKey, renderId, versionId)
    .run();
}

/**
 * Moves the publish pointer in D1. Refused (409) if the site was cancelled meanwhile: the
 * check is part of the same statements, not the caller's earlier snapshot.
 */
export async function markPublished(db: D1Database, siteId: string, versionId: string, templateVersion: string) {
  const at = now();
  const live = "EXISTS (SELECT 1 FROM sites WHERE id = ? AND cancelled_at IS NULL)";
  const [, pointed] = await db.batch([
    db
      .prepare(`UPDATE site_versions SET first_published_at = COALESCE(first_published_at, ?) WHERE id = ? AND ${live}`)
      .bind(at, versionId, siteId),
    db
      .prepare(
        "UPDATE sites SET published_version_id = ?, published_at = ?, template_version = ?, updated_at = ? WHERE id = ? AND cancelled_at IS NULL",
      )
      .bind(versionId, at, templateVersion, at, siteId),
  ]);
  if (pointed?.meta.changes !== 1) throw new HttpError(409, "해지된 사이트입니다. 먼저 해지를 취소하세요");
  return at;
}

/** Active custom domain if any, else the default subdomain. */
export async function primaryHostname(db: D1Database, site: SiteRow, baseDomain: string): Promise<string> {
  const custom = await db
    .prepare("SELECT hostname FROM domains WHERE site_id = ? AND kind = 'custom' AND status = 'active' ORDER BY created_at LIMIT 1")
    .bind(site.id)
    .first<{ hostname: string }>();
  return custom?.hostname ?? `${site.slug}.${baseDomain}`;
}

export async function versionByPreviewToken(db: D1Database, previewToken: string): Promise<VersionRow> {
  const row = await db
    .prepare("SELECT * FROM site_versions WHERE preview_token = ?")
    .bind(previewToken)
    .first<VersionRow>();
  if (!row) throw new HttpError(404, "프리뷰가 없습니다");
  return row;
}

/** Operator suspend/resume. A manual suspension is never lifted by an incoming payment. */
export async function setSiteStatus(db: D1Database, siteId: string, status: "active" | "suspended") {
  await db
    .prepare("UPDATE sites SET status = ?, suspend_reason = ?, updated_at = ? WHERE id = ?")
    .bind(status, status === "suspended" ? "manual" : null, now(), siteId)
    .run();
}

/** Authoritative serving state from D1: site row plus the published version, if any. */
export async function servingState(db: D1Database, siteId: string) {
  const site = await getSite(db, siteId);
  const version = site.published_version_id
    ? await db
        .prepare("SELECT id, number, config, render_id FROM site_versions WHERE id = ?")
        .bind(site.published_version_id)
        .first<{ id: string; number: number; config: string; render_id: string | null }>()
    : null;
  return { site, version };
}

/** Records that KV host records reflect the site as of `updatedAt` (no-op if the row moved on). */
export async function markRoutesSynced(db: D1Database, siteId: string, updatedAt: string) {
  await db
    .prepare("UPDATE sites SET routes_synced_at = ? WHERE id = ? AND updated_at = ?")
    .bind(updatedAt, siteId, updatedAt)
    .run();
}

/** Sites whose KV host records may lag D1. */
export async function sitesNeedingRouteSync(db: D1Database, limit = 100) {
  const { results } = await db
    .prepare("SELECT id FROM sites WHERE routes_synced_at IS NULL OR routes_synced_at < updated_at ORDER BY updated_at LIMIT ?")
    .bind(limit)
    .all<{ id: string }>();
  return results.map((row) => row.id);
}

export async function clearRoutesSynced(db: D1Database, siteId: string) {
  await db.prepare("UPDATE sites SET routes_synced_at = NULL WHERE id = ?").bind(siteId).run();
}

const LEASE_MS = 60_000;

/** Takes the per-site route-sync lease; null when another writer holds it. */
export async function acquireRoutesLease(db: D1Database, siteId: string): Promise<string | null> {
  const token = crypto.randomUUID();
  const now = new Date();
  const result = await db
    .prepare(
      "UPDATE sites SET routes_lock_token = ?, routes_lock_until = ? WHERE id = ? AND (routes_lock_until IS NULL OR routes_lock_until < ?)",
    )
    .bind(token, new Date(now.getTime() + LEASE_MS).toISOString(), siteId, now.toISOString())
    .run();
  return result.meta.changes === 1 ? token : null;
}

export async function holdsRoutesLease(db: D1Database, siteId: string, token: string) {
  const row = await db
    .prepare("SELECT 1 AS held FROM sites WHERE id = ? AND routes_lock_token = ? AND routes_lock_until >= ?")
    .bind(siteId, token, new Date().toISOString())
    .first<{ held: number }>();
  return Boolean(row);
}

export async function releaseRoutesLease(db: D1Database, siteId: string, token: string) {
  await db
    .prepare("UPDATE sites SET routes_lock_token = NULL, routes_lock_until = NULL WHERE id = ? AND routes_lock_token = ?")
    .bind(siteId, token)
    .run();
}

/** SQL for a site's business name: the live version's, else the latest draft's. */
export const BUSINESS_NAME_SQL = (siteIdColumn: string, publishedColumn: string) =>
  `(SELECT json_extract(config, '$.business.name') FROM site_versions
    WHERE id = COALESCE(${publishedColumn}, (SELECT id FROM site_versions WHERE site_id = ${siteIdColumn} ORDER BY number DESC LIMIT 1)))`;

export async function businessName(db: D1Database, site: SiteRow): Promise<string | null> {
  const row = await db
    .prepare(`SELECT ${BUSINESS_NAME_SQL("?1", "?2")} AS name`)
    .bind(site.id, site.published_version_id)
    .first<{ name: string | null }>();
  return row?.name ?? null;
}

export async function listSites(db: D1Database, baseDomain: string) {
  const { results } = await db
    .prepare(
      `SELECT s.id, s.slug, s.template_id, s.status, s.cancelled_at, s.published_version_id, s.published_at,
              s.notify_email, s.created_at, s.updated_at, s.customer_id, s.suspend_reason,
              ${BUSINESS_NAME_SQL("s.id", "s.published_version_id")} AS business_name,
              (SELECT status FROM subscriptions WHERE site_id = s.id) AS billing_status,
              (SELECT name FROM customers WHERE id = s.customer_id) AS customer_name,
              (SELECT number FROM site_versions WHERE id = s.published_version_id) AS published_number,
              (SELECT MAX(number) FROM site_versions WHERE site_id = s.id) AS latest_number,
              (SELECT hostname FROM domains WHERE site_id = s.id AND kind = 'custom' AND status = 'active' ORDER BY created_at LIMIT 1) AS custom_hostname
       FROM sites s ORDER BY s.updated_at DESC`,
    )
    .all<{ slug: string; custom_hostname: string | null }>();
  return results.map((row) => ({ ...row, hostname: row.custom_hostname ?? `${row.slug}.${baseDomain}` }));
}
