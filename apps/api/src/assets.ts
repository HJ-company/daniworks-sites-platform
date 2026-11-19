import { VARIANT_WIDTHS, variantUrl } from "@sites/renderer";
import type { Env } from "./env.js";
import { HttpError } from "./http.js";
import { r2MediaKey } from "./keys.js";
import { sha256Hex } from "./hash.js";
import { MAX_INPUT_BYTES, processPhotoExclusive } from "./media.js";
import { normalizeNaverImage } from "./remote-image.js";
import { ensureNotPurged } from "./purge-guard.js";
import { readLimited } from "./stream.js";
import type { SiteRow } from "./store.js";

export interface AssetResult {
  /** Use this in config photos: `{ key, alt, width, height }`. */
  key: string;
  width: number;
  height: number;
  bytes: number;
  url: string;
}

/** Reads the upload body: raw image bytes, or JSON `{ url }` to fetch an https image (MCP, blogs). */
async function readUpload(request: Request): Promise<{ bytes: Uint8Array; name: string | null }> {
  const type = request.headers.get("content-type") ?? "";
  if (type.startsWith("application/json")) {
    // Only a URL is expected; read at most 4 KB before parsing.
    const raw = await readLimited(request.body, 4096);
    let body: { url?: string } | null = null;
    try {
      body = JSON.parse(new TextDecoder().decode(raw)) as { url?: string };
    } catch {
      throw new HttpError(400, "요청 본문이 JSON이 아닙니다");
    }
    const url = body?.url;
    if (!url || !/^https:\/\/[^\s]+$/.test(url)) throw new HttpError(400, "url은 https:// 주소여야 합니다");
    // No Referer: Naver blog images refuse foreign referrers but serve requests without one.
    const res = await fetch(normalizeNaverImage(url), { redirect: "follow", headers: { accept: "image/*" } });
    if (!res.ok) throw new HttpError(422, `사진을 가져오지 못했습니다 (${res.status})`);
    return { bytes: await readLimited(res.body), name: url };
  }
  return { bytes: await readLimited(request.body), name: request.headers.get("x-file-name") };
}

/** Where a stored photo came from, and for AI images why and at whose request. */
export interface AssetOrigin {
  source: "upload" | "url" | "ai";
  name: string | null;
  prompt?: string | null;
  purpose?: "background" | "illustration" | "mood" | "work" | null;
  customerRequest?: string | null;
  costUsd?: number | null;
}

/**
 * Stores an uploaded photo for a site: normalized JPEG plus WebP variants in R2, a row in
 * `assets`. Content-addressed by the input bytes, so the same upload returns the same key.
 */
export async function uploadAsset(env: Env, site: SiteRow, request: Request): Promise<AssetResult> {
  if (site.cancelled_at) throw new HttpError(409, "해지된 사이트에는 사진을 올릴 수 없습니다");
  const { bytes, name } = await readUpload(request);
  return storePhoto(env, site, bytes, { source: name?.startsWith("https://") ? "url" : "upload", name });
}

/** Shared by uploads and AI images: one pipeline, one place for the photo rules (3MP, WebP). */
export async function storePhoto(env: Env, site: SiteRow, bytes: Uint8Array, origin: AssetOrigin): Promise<AssetResult> {
  if (site.cancelled_at) throw new HttpError(409, "해지된 사이트에는 사진을 올릴 수 없습니다");
  const hash = await sha256Hex(bytes);
  const file = `${hash}.jpg`;
  const key = `m:${site.id}/${file}`;
  const url = `/_media/${site.id}/${file}`;

  const existing = await env.DB.prepare("SELECT width, height, bytes, deleting_at, deleted_at FROM assets WHERE key = ?")
    .bind(key)
    .first<{ width: number; height: number; bytes: number; deleting_at: string | null; deleted_at: string | null }>();
  if (existing && !existing.deleting_at) return { key, url, width: existing.width, height: existing.height, bytes: existing.bytes };
  // Its deletion is still removing files: writing them now could be undone a moment later.
  if (existing && !existing.deleted_at) throw new HttpError(409, "같은 사진을 지우는 중입니다. 잠시 뒤 다시 올리세요");
  // Otherwise a finished tombstone (or nothing): write the files and (re)activate the row.

  const photo = await processPhotoExclusive(bytes);
  const meta = { httpMetadata: { contentType: "image/jpeg", cacheControl: "public, max-age=31536000, immutable" } };
  const written = [r2MediaKey(site.id, file)];
  await env.SITES.put(written[0]!, photo.main, meta);
  for (const variant of photo.variants) {
    const key = r2MediaKey(site.id, variantUrl(file, variant.width));
    written.push(key);
    await env.SITES.put(key, variant.bytes, {
      httpMetadata: { contentType: "image/webp", cacheControl: "public, max-age=31536000, immutable" },
    });
  }
  await ensureNotPurged(env, site.id, written);
  await env.DB.prepare(
    `INSERT INTO assets (key, site_id, r2_key, mime, width, height, bytes, original_name, source, prompt, purpose, customer_request, cost_usd, created_at)
     SELECT ?, ?, ?, 'image/jpeg', ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM sites WHERE id = ? AND purging_at IS NULL)
     ON CONFLICT(key) DO UPDATE SET deleting_at = NULL, deleted_at = NULL, created_at = excluded.created_at WHERE assets.deleted_at IS NOT NULL`,
  )
    .bind(
      key,
      site.id,
      r2MediaKey(site.id, file),
      photo.width,
      photo.height,
      photo.main.byteLength,
      origin.name,
      origin.source,
      origin.prompt ?? null,
      origin.purpose ?? null,
      origin.customerRequest ?? null,
      origin.costUsd ?? null,
      new Date().toISOString(),
      site.id,
    )
    .run();
  return { key, url, width: photo.width, height: photo.height, bytes: photo.main.byteLength };
}

/**
 * Whether any version of any site refers to a photo. Configs may point at another site's
 * photo (the key carries its site), so ownership alone does not tell.
 */
async function inUse(env: Env, key: string) {
  const row = await env.DB.prepare("SELECT 1 AS used FROM site_versions WHERE instr(config, ?) > 0 LIMIT 1").bind(`"${key}"`).first();
  return Boolean(row);
}

export async function listAssets(env: Env, site: SiteRow) {
  const { results } = await env.DB.prepare(
    `SELECT key, width, height, bytes, original_name, source, prompt, purpose, customer_request, cost_usd, created_at
     FROM assets WHERE site_id = ? AND deleting_at IS NULL ORDER BY created_at DESC`,
  )
    .bind(site.id)
    .all<{ key: string; customer_request: string | null }>();
  // One pass: every version (of any site) that mentions this site's photos, keys collected once.
  const { results: configs } = await env.DB.prepare("SELECT config FROM site_versions WHERE instr(config, ?) > 0")
    .bind(`"m:${site.id}/`)
    .all<{ config: string }>();
  const used = new Set<string>();
  for (const { config } of configs) for (const match of config.matchAll(/"(m:[A-Za-z0-9_-]+\/[a-f0-9]{8,64}\.jpg)"/g)) used.add(match[1]!);
  return results.map((row) => ({
    ...row,
    customer_request: row.customer_request ? (JSON.parse(row.customer_request) as unknown) : null,
    url: `/_media/${row.key.slice(2)}`,
    in_use: used.has(row.key),
  }));
}

/**
 * Removes an unused photo's files (JPEG and WebP variants), keeping its row as a tombstone so no
 * later version can use the key. Refused while any version of any site refers to it: a rollback
 * or an old draft would show a broken image.
 */
export async function deleteAsset(env: Env, site: SiteRow, key: string) {
  const row = await env.DB.prepare("SELECT key, r2_key, deleted_at FROM assets WHERE key = ? AND site_id = ?")
    .bind(key, site.id)
    .first<{ key: string; r2_key: string; deleted_at: string | null }>();
  if (!row || row.deleted_at) throw new HttpError(404, "이 사이트의 사진이 아닙니다");
  // Check and reserve in one statement: a version saved after this sees the reservation and is
  // refused (store.ts); one saved before it makes this refuse. The token makes the deletion ours.
  const token = crypto.randomUUID();
  const at = new Date().toISOString();
  const reserved = await env.DB.prepare(
    `UPDATE assets SET deleting_at = ?, deleting_token = ?
     WHERE key = ? AND deleting_at IS NULL AND NOT EXISTS (SELECT 1 FROM site_versions WHERE instr(config, ?) > 0)`,
  )
    .bind(at, token, key, `"${key}"`)
    .run();
  if (reserved.meta.changes !== 1) {
    if (await inUse(env, key)) throw new HttpError(409, "버전에서 쓰는 사진은 지울 수 없습니다. 먼저 설정에서 빼고 저장하세요");
    // Another deletion holds it. Take over only one abandoned for 5 minutes (its worker died).
    const takeover = await env.DB.prepare(
      "UPDATE assets SET deleting_at = ?, deleting_token = ? WHERE key = ? AND deleted_at IS NULL AND deleting_at < ?",
    )
      .bind(at, token, key, new Date(Date.now() - 5 * 60_000).toISOString())
      .run();
    if (takeover.meta.changes !== 1) throw new HttpError(409, "이 사진을 지우는 중입니다. 잠시 뒤 확인하세요");
  }
  const file = key.slice(key.indexOf("/") + 1);
  await env.SITES.delete([row.r2_key, ...VARIANT_WIDTHS.map((width) => r2MediaKey(site.id, variantUrl(file, width)))]);
  // The row stays as a tombstone: a stale editor saving this key later is still refused, and
  // only now may the same photo be uploaded again.
  await env.DB.prepare("UPDATE assets SET deleted_at = ? WHERE key = ? AND deleting_token = ?").bind(new Date().toISOString(), key, token).run();
  return { key, deleted: true };
}
