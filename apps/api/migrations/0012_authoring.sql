-- M4 4-E: authoring. Guides the AI tools read before writing a site (context7-style). Defaults
-- ship in code and are copied here on first use, so operators can edit them through MCP; every
-- edit is a new version. The site config schema is generated from code and never stored.
CREATE TABLE guides (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('policy', 'industry', 'design', 'writing')),
  scope TEXT NOT NULL DEFAULT 'operator' CHECK (scope IN ('operator', 'customer')),
  summary TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE guide_versions (
  slug TEXT NOT NULL REFERENCES guides(slug),
  version INTEGER NOT NULL,
  body TEXT NOT NULL,
  author TEXT,
  note TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (slug, version)
);

-- Which guide versions were current when the AI saved a version ({"slug": version}).
ALTER TABLE site_versions ADD COLUMN guide_versions TEXT;

-- Where each photo came from. AI images are allowed for backgrounds, illustrations and mood;
-- for real work only on the customer's request, which is recorded (channel, when, summary).
ALTER TABLE assets ADD COLUMN source TEXT NOT NULL DEFAULT 'upload' CHECK (source IN ('upload', 'url', 'ai'));
ALTER TABLE assets ADD COLUMN prompt TEXT;
ALTER TABLE assets ADD COLUMN purpose TEXT CHECK (purpose IN ('background', 'illustration', 'mood', 'work'));
ALTER TABLE assets ADD COLUMN customer_request TEXT;
ALTER TABLE assets ADD COLUMN cost_usd REAL;
UPDATE assets SET source = 'url' WHERE original_name LIKE 'https://%';
-- Deleting a photo reserves it (deleting_at, owned by deleting_token), removes its files, then marks it deleted
-- (deleted_at). The row stays as a tombstone: version saves that use it are refused for good,
-- and uploading the same photo again revives it once the deletion has finished.
ALTER TABLE assets ADD COLUMN deleting_at TEXT;
ALTER TABLE assets ADD COLUMN deleting_token TEXT;
ALTER TABLE assets ADD COLUMN deleted_at TEXT;
