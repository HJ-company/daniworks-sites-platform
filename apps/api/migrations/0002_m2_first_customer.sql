-- M2: customers, custom domains, uploaded photos, inquiries and daily metrics.

CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  contact_name TEXT,
  phone TEXT,
  email TEXT,
  billing_cycle TEXT CHECK (billing_cycle IN ('monthly', 'yearly')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Cancellation keeps sites.status = 'suspended' (public serving stops) and records when.
ALTER TABLE sites ADD COLUMN customer_id TEXT REFERENCES customers(id);
ALTER TABLE sites ADD COLUMN notify_email TEXT;
ALTER TABLE sites ADD COLUMN template_version TEXT;
ALTER TABLE sites ADD COLUMN cancelled_at TEXT;
CREATE INDEX sites_customer ON sites(customer_id);

-- Custom hostnames (Cloudflare for SaaS). Subdomain rows keep status 'active' and no cf fields.
ALTER TABLE domains ADD COLUMN cf_hostname_id TEXT;
ALTER TABLE domains ADD COLUMN ssl_status TEXT;
ALTER TABLE domains ADD COLUMN verification_records TEXT;
ALTER TABLE domains ADD COLUMN last_error TEXT;
ALTER TABLE domains ADD COLUMN checked_at TEXT;

CREATE TABLE assets (
  key TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id),
  r2_key TEXT NOT NULL,
  mime TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  bytes INTEGER NOT NULL,
  original_name TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX assets_site ON assets(site_id, created_at DESC);

CREATE TABLE inquiries (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id),
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  message TEXT NOT NULL,
  page TEXT,
  -- SHA-256 of IP + daily salt: rate limiting without storing the address.
  client_hash TEXT,
  notify_status TEXT NOT NULL DEFAULT 'pending' CHECK (notify_status IN ('pending', 'sent', 'failed', 'skipped')),
  notify_error TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX inquiries_site ON inquiries(site_id, created_at DESC);
CREATE INDEX inquiries_client ON inquiries(client_hash, created_at);

CREATE TABLE metrics_daily (
  site_id TEXT NOT NULL REFERENCES sites(id),
  date TEXT NOT NULL,
  event TEXT NOT NULL CHECK (event IN ('pageview', 'tel', 'kakao', 'map', 'booking', 'inquiry_cta', 'inquiry')),
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (site_id, date, event)
);

-- Origin the HTML was rendered for (canonical, OG). A domain change re-renders on publish.
ALTER TABLE site_versions ADD COLUMN rendered_origin TEXT;
