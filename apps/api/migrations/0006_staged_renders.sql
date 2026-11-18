-- Full republish: a live version rendered with the current renderer and assets under a new
-- render_id, not yet served. Committed (pointer switched) only after a visual check.
CREATE TABLE staged_renders (
  render_id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id),
  version_id TEXT NOT NULL REFERENCES site_versions(id),
  render_key TEXT NOT NULL,
  asset_version TEXT NOT NULL,
  -- The live render this stage replaces. Commit requires it unchanged, so anything that
  -- re-rendered the version since staging (domain change, publish) wins.
  base_render_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX staged_renders_site ON staged_renders(site_id, created_at DESC);
