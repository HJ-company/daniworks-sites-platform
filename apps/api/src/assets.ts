import { variantUrl } from "@sites/renderer";
import type { Env } from "./env.js";
import { HttpError } from "./http.js";
import { r2MediaKey } from "./keys.js";
import { MAX_INPUT_BYTES, processPhotoExclusive, sha256Hex } from "./media.js";
import type { SiteRow } from "./store.js";

export interface AssetResult {
  /** Use this in config photos: `{ key, alt, width, height }`. */
  key: string;
  width: number;
  height: number;
  bytes: number;
  url: string;
}

/** Reads a body stream, aborting with 413 as soon as it passes the limit (no Content-Length trust). */
export async function readLimited(stream: ReadableStream<Uint8Array> | null, limit = MAX_INPUT_BYTES): Promise<Uint8Array> {
  if (!stream) return new Uint8Array();
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new HttpError(413, "사진이 너무 큽니다");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
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
    const res = await fetch(url, { redirect: "follow", headers: { accept: "image/*" } });
    if (!res.ok) throw new HttpError(422, `사진을 가져오지 못했습니다 (${res.status})`);
    return { bytes: await readLimited(res.body), name: url };
  }
  return { bytes: await readLimited(request.body), name: request.headers.get("x-file-name") };
}

/**
 * Stores an uploaded photo for a site: normalized JPEG plus WebP variants in R2, a row in
 * `assets`. Content-addressed by the input bytes, so the same upload returns the same key.
 */
export async function uploadAsset(env: Env, site: SiteRow, request: Request): Promise<AssetResult> {
  const { bytes, name } = await readUpload(request);
  const hash = await sha256Hex(bytes);
  const file = `${hash}.jpg`;
  const key = `m:${site.id}/${file}`;
  const url = `/_media/${site.id}/${file}`;

  const existing = await env.DB.prepare("SELECT width, height, bytes FROM assets WHERE key = ?")
    .bind(key)
    .first<{ width: number; height: number; bytes: number }>();
  if (existing) return { key, url, ...existing };

  const photo = await processPhotoExclusive(bytes);
  const meta = { httpMetadata: { contentType: "image/jpeg", cacheControl: "public, max-age=31536000, immutable" } };
  await env.SITES.put(r2MediaKey(site.id, file), photo.main, meta);
  for (const variant of photo.variants) {
    await env.SITES.put(r2MediaKey(site.id, variantUrl(file, variant.width)), variant.bytes, {
      httpMetadata: { contentType: "image/webp", cacheControl: "public, max-age=31536000, immutable" },
    });
  }
  await env.DB.prepare(
    "INSERT OR IGNORE INTO assets (key, site_id, r2_key, mime, width, height, bytes, original_name, created_at) VALUES (?, ?, ?, 'image/jpeg', ?, ?, ?, ?, ?)",
  )
    .bind(key, site.id, r2MediaKey(site.id, file), photo.width, photo.height, photo.main.byteLength, name, new Date().toISOString())
    .run();
  return { key, url, width: photo.width, height: photo.height, bytes: photo.main.byteLength };
}

export async function listAssets(env: Env, site: SiteRow) {
  const { results } = await env.DB.prepare(
    "SELECT key, width, height, bytes, original_name, created_at FROM assets WHERE site_id = ? ORDER BY created_at DESC",
  )
    .bind(site.id)
    .all<{ key: string }>();
  return results.map((row) => ({ ...row, url: `/_media/${row.key.slice(2)}` }));
}
