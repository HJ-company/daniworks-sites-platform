-- 1 while a site's primary host changed (custom domain activated, failed or removed) and the live
-- version has not been re-rendered for the new origin yet. The domains cron retries until it is 0.
ALTER TABLE sites ADD COLUMN origin_pending INTEGER NOT NULL DEFAULT 0;

-- First time a custom domain became active. Domains that were active once keep being polled
-- (a temporary validation loss must recover on its own); never-active ones stop after 14 days.
ALTER TABLE domains ADD COLUMN activated_at TEXT;

-- Renders are immutable: each render of a version writes its pages under a new render_id and
-- the router follows the pointer's render_id. NULL = written before this (legacy path).
ALTER TABLE site_versions ADD COLUMN render_id TEXT;
