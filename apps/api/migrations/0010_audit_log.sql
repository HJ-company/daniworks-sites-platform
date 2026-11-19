-- M4 4-D: who did what. Every authenticated change (console, MCP, script) is recorded with the
-- person behind it: the Authentik user for console and MCP, "script" for the fixed token.
CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'script')),
  actor_id TEXT NOT NULL,
  actor_name TEXT,
  via TEXT NOT NULL CHECK (via IN ('console', 'mcp', 'api', 'script')),
  action TEXT NOT NULL,
  site_id TEXT,
  target TEXT,
  status INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX audit_log_site ON audit_log(site_id, created_at DESC);
CREATE INDEX audit_log_created ON audit_log(created_at DESC);
