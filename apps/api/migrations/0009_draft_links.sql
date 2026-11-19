-- M4 4-C: one draft link per site for the customer (dsites.kr/preview/<token>). It always shows
-- the latest version, so fixing the draft never changes the link. Valid for 30 days; the
-- operator revokes or reissues it. NULL token: no link.
ALTER TABLE sites ADD COLUMN preview_token TEXT;
ALTER TABLE sites ADD COLUMN preview_expires_at TEXT;
CREATE UNIQUE INDEX sites_preview_token ON sites(preview_token) WHERE preview_token IS NOT NULL;
