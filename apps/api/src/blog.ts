import { naverRssUrl, parseNaverRss, type BlogFeed } from "@sites/renderer/blog";
import { readLimited } from "./stream.js";
import type { Env } from "./env.js";
import { HttpError } from "./http.js";

export const kvBlogKey = (siteId: string) => `blog:${siteId}`;
const STALE_MS = 3 * 3_600_000;

/** Keeps the feed row in step with the live version: present with its blog URL, or removed. */
export async function syncBlogFeed(env: Env, siteId: string, config: { business?: { blogUrl?: string } }) {
  const blogUrl = config.business?.blogUrl ?? null;
  if (!blogUrl) {
    await env.DB.prepare("DELETE FROM blog_feeds WHERE site_id = ?").bind(siteId).run();
    await env.ROUTES.delete(kvBlogKey(siteId));
    return;
  }
  // Another blog's posts must never show under this link: drop the cache when the URL changes.
  const previous = await env.DB.prepare("SELECT blog_url FROM blog_feeds WHERE site_id = ?").bind(siteId).first<{ blog_url: string }>();
  if (previous && previous.blog_url !== blogUrl) await env.ROUTES.delete(kvBlogKey(siteId));
  // A new or changed URL is due immediately (fetched_at NULL).
  await env.DB.prepare(
    `INSERT INTO blog_feeds (site_id, blog_url) VALUES (?, ?)
     ON CONFLICT (site_id) DO UPDATE SET blog_url = excluded.blog_url,
       fetched_at = CASE WHEN blog_feeds.blog_url = excluded.blog_url THEN blog_feeds.fetched_at ELSE NULL END`,
  )
    .bind(siteId, blogUrl)
    .run();
}

/** Fetches one feed and caches its latest posts. Failures keep the previous cache. */
export async function refreshBlog(env: Env, siteId: string) {
  const row = await env.DB.prepare("SELECT blog_url FROM blog_feeds WHERE site_id = ?").bind(siteId).first<{ blog_url: string }>();
  if (!row) throw new HttpError(404, "블로그가 연결된 게시 버전이 없습니다");
  const rss = naverRssUrl(row.blog_url, env.BLOG_RSS_BASE);
  const now = new Date().toISOString();
  try {
    if (!rss) throw new Error("네이버 블로그 주소가 아닙니다");
    const res = await fetch(rss, { headers: { "user-agent": "dsites-blog-feed/1.0", accept: "application/rss+xml, text/xml" } });
    if (!res.ok) throw new Error(`RSS ${res.status}`);
    const xml = new TextDecoder().decode(await readLimited(res.body, 2 * 1024 * 1024));
    const feed: BlogFeed = { source: row.blog_url, fetchedAt: now, posts: parseNaverRss(xml) };
    // The blog may have changed while fetching: never let an obsolete result become the cache.
    const current = await env.DB.prepare("SELECT blog_url FROM blog_feeds WHERE site_id = ?").bind(siteId).first<{ blog_url: string }>();
    if (current?.blog_url !== row.blog_url) return { status: "stale" };
    await env.ROUTES.put(kvBlogKey(siteId), JSON.stringify(feed));
    const updated = await env.DB.prepare(
      "UPDATE blog_feeds SET fetched_at = ?, status = 'ok', error = NULL, post_count = ? WHERE site_id = ? AND blog_url = ?",
    )
      .bind(now, feed.posts.length, siteId, row.blog_url)
      .run();
    // Changed between the check and the write: make the new blog due again.
    if (updated.meta.changes !== 1) await env.DB.prepare("UPDATE blog_feeds SET fetched_at = NULL WHERE site_id = ?").bind(siteId).run();
    return { status: "ok", posts: feed.posts.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await env.DB.prepare("UPDATE blog_feeds SET fetched_at = ?, status = 'error', error = ? WHERE site_id = ? AND blog_url = ?")
      .bind(now, message.slice(0, 300), siteId, row.blog_url)
      .run();
    return { status: "error", error: message };
  }
}

/** Cron: refresh up to 20 feeds that are new or older than three hours. */
export async function refreshDueBlogs(env: Env) {
  const { results } = await env.DB.prepare(
    "SELECT site_id FROM blog_feeds WHERE fetched_at IS NULL OR fetched_at < ? ORDER BY fetched_at LIMIT 20",
  )
    .bind(new Date(Date.now() - STALE_MS).toISOString())
    .all<{ site_id: string }>();
  let ok = 0;
  for (const { site_id } of results) if ((await refreshBlog(env, site_id)).status === "ok") ok++;
  return { due: results.length, ok };
}
