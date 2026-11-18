-- Naver blog RSS per published site. Kept in sync on publish/rollback; the cron refreshes
-- stale feeds and caches the latest posts in KV (blog:<siteId>) for the router.
CREATE TABLE blog_feeds (
  site_id TEXT PRIMARY KEY REFERENCES sites(id),
  blog_url TEXT NOT NULL,
  fetched_at TEXT,
  status TEXT,
  error TEXT,
  post_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX blog_feeds_due ON blog_feeds(fetched_at);
