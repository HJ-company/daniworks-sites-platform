-- When published_version_id last changed (publish or rollback); the router pointer is built from it.
ALTER TABLE sites ADD COLUMN published_at TEXT;

-- Sites published before this column existed: best available time, so their pointer survives.
UPDATE sites
SET published_at = COALESCE(
  (SELECT first_published_at FROM site_versions WHERE site_versions.id = sites.published_version_id),
  updated_at
)
WHERE published_version_id IS NOT NULL AND published_at IS NULL;

-- Last sites.updated_at whose state was written to the router's KV host records. A cron
-- re-syncs rows where this lags updated_at (e.g. a KV write was rate limited).
ALTER TABLE sites ADD COLUMN routes_synced_at TEXT;

-- Per-site lease so only one writer updates the KV host records at a time.
ALTER TABLE sites ADD COLUMN routes_lock_token TEXT;
ALTER TABLE sites ADD COLUMN routes_lock_until TEXT;
