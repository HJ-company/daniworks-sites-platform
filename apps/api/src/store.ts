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
      "SELECT id, number, created_by, note, preview_token, asset_version, rendered_at, first_published_at, created_at FROM site_versions WHERE site_id = ? ORDER BY number DESC",
    )
    .bind(siteId)
    .all();
  return results;
}

export async function createSite(db: D1Database, config: SiteConfig, createdBy: CreatedBy, hostname: string) {
  const exists = await db.prepare("SELECT id FROM sites WHERE slug = ?").bind(config.slug).first();
  if (exists) throw new HttpError(409, `이미 쓰는 slug입니다: ${config.slug}`);
  const siteId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const at = now();
  await db.batch([
    db
      .prepare("INSERT INTO sites (id, slug, template_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .bind(siteId, config.slug, config.templateId, at, at),
    db
      .prepare(
        "INSERT INTO site_versions (id, site_id, number, config, created_by, note, preview_token, created_at) VALUES (?, ?, 1, ?, ?, ?, ?, ?)",
      )
      .bind(versionId, siteId, JSON.stringify(config), createdBy, "최초 생성", token(), at),
    db
      .prepare("INSERT INTO domains (hostname, site_id, kind, created_at) VALUES (?, ?, 'subdomain', ?)")
      .bind(hostname, siteId, at),
  ]);
  return { siteId, versionId };
}

export async function addVersion(
  db: D1Database,
  site: SiteRow,
  config: SiteConfig,
  createdBy: CreatedBy,
  note: string | null,
) {
  if (config.slug !== site.slug) throw new HttpError(422, "slug는 바꿀 수 없습니다", [`slug: ${site.slug}`]);
  const latest = await latestVersion(db, site.id);
  const versionId = crypto.randomUUID();
  const at = now();
  await db.batch([
    db
      .prepare(
        "INSERT INTO site_versions (id, site_id, number, config, created_by, note, preview_token, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(versionId, site.id, latest.number + 1, JSON.stringify(config), createdBy, note, token(), at),
    db.prepare("UPDATE sites SET updated_at = ? WHERE id = ?").bind(at, site.id),
  ]);
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

export async function markPublished(db: D1Database, siteId: string, versionId: string, templateVersion: string) {
  const at = now();
  await db.batch([
    db
      .prepare("UPDATE site_versions SET first_published_at = COALESCE(first_published_at, ?) WHERE id = ?")
      .bind(at, versionId),
    db
      .prepare(
        "UPDATE sites SET published_version_id = ?, published_at = ?, template_version = ?, updated_at = ? WHERE id = ?",
      )
      .bind(versionId, at, templateVersion, at, siteId),
  ]);
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

export async function setSiteStatus(db: D1Database, siteId: string, status: "active" | "suspended") {
  await db.prepare("UPDATE sites SET status = ?, updated_at = ? WHERE id = ?").bind(status, now(), siteId).run();
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

export async function listSites(db: D1Database, baseDomain: string) {
  const { results } = await db
    .prepare(
      `SELECT s.id, s.slug, s.template_id, s.status, s.cancelled_at, s.published_version_id, s.published_at,
              s.notify_email, s.created_at, s.updated_at,
              (SELECT number FROM site_versions WHERE id = s.published_version_id) AS published_number,
              (SELECT MAX(number) FROM site_versions WHERE site_id = s.id) AS latest_number,
              (SELECT hostname FROM domains WHERE site_id = s.id AND kind = 'custom' AND status = 'active' ORDER BY created_at LIMIT 1) AS custom_hostname
       FROM sites s ORDER BY s.updated_at DESC`,
    )
    .all<{ slug: string; custom_hostname: string | null }>();
  return results.map((row) => ({ ...row, hostname: row.custom_hostname ?? `${row.slug}.${baseDomain}` }));
}
