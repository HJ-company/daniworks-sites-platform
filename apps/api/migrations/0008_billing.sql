-- M4 4-B: customers' billing details, one subscription per site, manually confirmed payments.

ALTER TABLE customers ADD COLUMN external_ref TEXT;
ALTER TABLE customers ADD COLUMN business_number TEXT;
ALTER TABLE customers ADD COLUMN invoice_email TEXT;
ALTER TABLE customers ADD COLUMN memo TEXT;
-- customers.billing_cycle (M2) is unused: the cycle belongs to each site's subscription.

-- Why the site is suspended: 'billing' (not paid; a payment resumes it) or 'manual'
-- (operator; only the operator resumes it). NULL while active.
ALTER TABLE sites ADD COLUMN suspend_reason TEXT CHECK (suspend_reason IN ('billing', 'manual'));
UPDATE sites SET suspend_reason = 'manual' WHERE status = 'suspended' AND cancelled_at IS NULL;

-- Status is derived from payments (see billing.ts) and stored so lists can filter and so the
-- cron acts only when it changes. Amounts are KRW supply prices (VAT excluded).
CREATE TABLE subscriptions (
  site_id TEXT PRIMARY KEY REFERENCES sites(id),
  cycle TEXT NOT NULL DEFAULT 'monthly' CHECK (cycle IN ('monthly', 'yearly')),
  amount INTEGER NOT NULL CHECK (amount >= 0),
  status TEXT NOT NULL CHECK (status IN ('trial', 'awaiting', 'active', 'overdue', 'suspended', 'cancelled')),
  billed_at TEXT,
  -- Bumped with every payment change, cancellation and reactivation; status and serving writes
  -- are conditional on it so a refresh working from a stale view never overrides a newer one.
  billing_rev INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Accounting records: kept when a site is purged (tax records outlive the site), so no
-- foreign key; slug and business name are copied at confirmation. Periods are KST dates,
-- inclusive, editable by the operator. A voided row no longer counts.
CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  site_slug TEXT NOT NULL,
  business_name TEXT,
  amount INTEGER NOT NULL CHECK (amount >= 0),
  method TEXT NOT NULL DEFAULT 'manual' CHECK (method IN ('manual', 'pg')),
  payer_name TEXT,
  paid_on TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL CHECK (period_end >= period_start),
  confirmed_by TEXT,
  pg_tx_id TEXT,
  invoice_issued_on TEXT,
  memo TEXT,
  voided_at TEXT,
  void_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX payments_site ON payments(site_id, period_end);
CREATE INDEX payments_paid_on ON payments(paid_on);

-- Existing sites (local and staging test data): published ones count as paid for a month from
-- today, cancelled ones as cancelled, the rest as drafts awaiting a quote.
INSERT INTO subscriptions (site_id, cycle, amount, status, created_at, updated_at)
SELECT id, 'monthly', 30000,
  CASE WHEN cancelled_at IS NOT NULL THEN 'cancelled' WHEN published_version_id IS NOT NULL THEN 'active' ELSE 'trial' END,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM sites;
INSERT INTO payments (id, site_id, site_slug, amount, method, paid_on, period_start, period_end, confirmed_by, memo, created_at, updated_at)
SELECT lower(hex(randomblob(16))), id, slug, 0, 'manual',
  date('now', '+9 hours'), date('now', '+9 hours'), date('now', '+9 hours', '+1 month', '-1 day'),
  'migration', 'M4 이전 게시 사이트 이관', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM sites WHERE published_version_id IS NOT NULL AND cancelled_at IS NULL;
