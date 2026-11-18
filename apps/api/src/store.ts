import type { SiteConfig } from "@sites/renderer";
import { HttpError } from "./http.js";

export interface SiteRow {
  id: string;
  slug: string;
  template_id: string;
  published_version_id: string | null;
  status: string;
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

export async function markRendered(db: D1Database, versionId: string, assetVersion: string) {
  await db
    .prepare("UPDATE site_versions SET rendered_at = ?, asset_version = ? WHERE id = ?")
    .bind(now(), assetVersion, versionId)
    .run();
}

export async function markPublished(db: D1Database, siteId: string, versionId: string) {
  const at = now();
  await db.batch([
    db
      .prepare("UPDATE site_versions SET first_published_at = COALESCE(first_published_at, ?) WHERE id = ?")
      .bind(at, versionId),
    db.prepare("UPDATE sites SET published_version_id = ?, updated_at = ? WHERE id = ?").bind(versionId, at, siteId),
  ]);
  return at;
}

export async function versionByPreviewToken(db: D1Database, previewToken: string): Promise<VersionRow> {
  const row = await db
    .prepare("SELECT * FROM site_versions WHERE preview_token = ?")
    .bind(previewToken)
    .first<VersionRow>();
  if (!row) throw new HttpError(404, "프리뷰가 없습니다");
  return row;
}
