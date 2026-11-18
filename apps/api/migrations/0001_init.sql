-- Sites, their append-only versions, and the hostnames that route to them.
CREATE TABLE sites (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  template_id TEXT NOT NULL,
  published_version_id TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE site_versions (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id),
  number INTEGER NOT NULL,
  config TEXT NOT NULL,
  created_by TEXT NOT NULL CHECK (created_by IN ('ai', 'operator', 'customer')),
  note TEXT,
  preview_token TEXT NOT NULL UNIQUE,
  asset_version TEXT,
  rendered_at TEXT,
  first_published_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (site_id, number)
);

CREATE TABLE domains (
  hostname TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id),
  kind TEXT NOT NULL CHECK (kind IN ('subdomain', 'custom')),
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL
);

CREATE INDEX site_versions_site ON site_versions(site_id, number DESC);
CREATE INDEX domains_site ON domains(site_id);
