import type { Env } from "./env.js";
import { HttpError } from "./http.js";

/**
 * For every writer of a site's R2 files (uploads, renders of any kind): after writing, confirm
 * the site is not being purged or gone; if it is, delete what was just written and refuse.
 * Together with purge's final sweep this leaves no orphaned files.
 */
export async function ensureNotPurged(env: Env, siteId: string, written: string[]) {
  const row = await env.DB.prepare("SELECT purging_at FROM sites WHERE id = ?").bind(siteId).first<{ purging_at: string | null }>();
  if (row && !row.purging_at) return;
  if (written.length) await env.SITES.delete(written);
  throw new HttpError(409, "삭제 중인 사이트입니다");
}
