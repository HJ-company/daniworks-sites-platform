import { getDomain } from "tldts";
import type { Env } from "./env.js";
import { HttpError } from "./http.js";
import { kvHostKey } from "./keys.js";
import { renderKeyOf, rerenderLive, siteOrigin } from "./publish.js";
import { kvWrite } from "./routes.js";
import { SaasClient, type CustomHostname } from "./saas.js";
import { acquireRoutesLease, getSite, releaseRoutesLease, type SiteRow } from "./store.js";

export const INCLUDED_HOSTNAMES = 100;
/** The platform's own zone; never connectable as a customer domain in any environment. */
const PLATFORM_ZONE = "dsites.kr";

export interface DomainRow {
  hostname: string;
  site_id: string;
  kind: string;
  status: string;
  cf_hostname_id: string | null;
  ssl_status: string | null;
  verification_records: string | null;
  last_error: string | null;
  checked_at: string | null;
  activated_at: string | null;
  created_at: string;
}

/** Lowercase FQDN without scheme, path or port; rejects platform hosts. */
export function normalizeHostname(input: unknown, baseDomain: string): string {
  if (typeof input !== "string") throw new HttpError(422, "hostname이 필요합니다");
  const host = input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\.$/, "");
  const label = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
  if (!new RegExp(`^(?:${label}\\.)+[a-z]{2,63}$`).test(host) || host.length > 253) {
    throw new HttpError(422, `도메인 형식이 아닙니다: ${input}`);
  }
  const platform = [baseDomain, PLATFORM_ZONE];
  if (platform.some((zone) => host === zone || host.endsWith(`.${zone}`)) || host.endsWith(".localhost")) {
    throw new HttpError(422, "플랫폼 도메인은 연결할 수 없습니다");
  }
  return host;
}

/**
 * The domain the customer registered, from the Public Suffix List: `example.co.kr` for
 * `www.shop.example.co.kr`, `example.seoul.kr` for `www.example.seoul.kr`. Null if none.
 */
export function registrableDomain(hostname: string): string | null {
  return getDomain(hostname, { allowPrivateDomains: false });
}

/** `example.co.kr` and `example.com` are apex; `www.example.co.kr` is not. */
export function isApex(hostname: string) {
  return registrableDomain(hostname) === hostname;
}

/** DNS instructions shown to the operator and, later, the customer. */
export function instructions(env: Env, hostname: string, cf: CustomHostname) {
  const target = env.DOMAIN_CNAME_TARGET ?? `connect.${env.BASE_DOMAIN}`;
  const apex = isApex(hostname);
  const zone = registrableDomain(hostname);
  return {
    cname: { type: "CNAME", name: hostname, value: target },
    host: registrarHost(hostname, apex, zone),
    zone,
    /** Only for a domain already live elsewhere: validate before switching DNS (no downtime). */
    optionalTxt: cf.ownership_verification
      ? { type: "TXT", name: cf.ownership_verification.name, value: cf.ownership_verification.value }
      : null,
    apex,
    note: apex
      ? `루트 도메인입니다. 대부분의 국내 등록업체는 루트에 CNAME을 걸 수 없습니다. www.${hostname}을 연결하고, 등록업체에서 ${hostname} → https://www.${hostname} 포워딩을 설정하세요(https 포워딩 지원 여부 확인).`
      : null,
  };
}

const now = () => new Date().toISOString();

async function touchSite(env: Env, siteId: string) {
  await env.DB.prepare("UPDATE sites SET updated_at = ? WHERE id = ?").bind(now(), siteId).run();
}

/**
 * The primary host changed: re-render the live version for the new canonical origin and refresh
 * routing. `origin_pending` stays 1 until this succeeds, so the cron retries a failed attempt.
 */
async function afterPrimaryChange(env: Env, siteId: string) {
  await env.DB.prepare("UPDATE sites SET origin_pending = 1, updated_at = ? WHERE id = ?").bind(now(), siteId).run();
  if (await rerenderLive(env, siteId)) {
    await env.DB.prepare("UPDATE sites SET origin_pending = 0 WHERE id = ?").bind(siteId).run();
  }
}

function requireSaas(env: Env) {
  if (!SaasClient.configured(env)) throw new HttpError(503, "커스텀 도메인(Cloudflare for SaaS)이 설정되지 않았습니다");
  return new SaasClient(env);
}

export async function listDomains(env: Env, siteId: string) {
  const { results } = await env.DB.prepare("SELECT * FROM domains WHERE site_id = ? ORDER BY kind DESC, created_at")
    .bind(siteId)
    .all<DomainRow>();
  return results.map((row) => ({ ...row, verification_records: withRegistrarHost(row.hostname, row.verification_records) }));
}

/** Registrar host field: `www`, `www.shop`, `@` for the apex; null when the zone is unknown. */
const registrarHost = (hostname: string, apex: boolean, zone: string | null) => (apex ? "@" : zone ? hostname.slice(0, -(zone.length + 1)) : null);

/** Stored instructions, completed with the registrar host field for rows saved before M4. */
function withRegistrarHost(hostname: string, stored: string | null) {
  if (!stored) return null;
  const records = JSON.parse(stored) as { apex: boolean; host?: string | null; zone?: string | null };
  if (records.host !== undefined) return records;
  const zone = registrableDomain(hostname);
  return { ...records, zone, host: registrarHost(hostname, records.apex, zone) };
}

export async function addDomain(env: Env, site: SiteRow, input: unknown) {
  if (site.cancelled_at) throw new HttpError(409, "해지된 사이트에는 도메인을 연결할 수 없습니다");
  const hostname = normalizeHostname(input, env.BASE_DOMAIN);
  const taken = await env.DB.prepare("SELECT site_id FROM domains WHERE hostname = ?").bind(hostname).first<{ site_id: string }>();
  if (taken) throw new HttpError(409, taken.site_id === site.id ? "이미 연결 중인 도메인입니다" : "다른 사이트가 쓰는 도메인입니다");
  const saas = requireSaas(env);
  const cf = await saas.create(hostname);
  const records = instructions(env, hostname, cf);
  try {
    // Only for a site that is not cancelled (also when cancellation lands meanwhile).
    const inserted = await env.DB.prepare(
      `INSERT INTO domains (hostname, site_id, kind, status, cf_hostname_id, ssl_status, verification_records, created_at)
       SELECT ?, ?, 'custom', 'pending', ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM sites WHERE id = ? AND cancelled_at IS NULL)`,
    )
      .bind(hostname, site.id, cf.id, cf.ssl?.status ?? null, JSON.stringify(records), now(), site.id)
      .run();
    if (inserted.meta.changes !== 1) throw new HttpError(409, "해지된 사이트에는 도메인을 연결할 수 없습니다");
  } catch (error) {
    // Lost a race (same hostname, or cancellation): do not leave a billed hostname behind.
    await saas.delete(cf.id);
    throw error;
  }
  return { hostname, status: "pending", instructions: records };
}

/** Polls Cloudflare; on activation the domain becomes the site's primary host. */
export async function refreshDomain(env: Env, row: DomainRow) {
  if (!row.cf_hostname_id || row.status === "removing") return row.status;
  const saas = requireSaas(env);
  let cf: CustomHostname | null;
  try {
    cf = await saas.get(row.cf_hostname_id);
  } catch (error) {
    // Deleted at Cloudflare (outside this API): a confirmed failure, not a transient one.
    if (error instanceof HttpError && error.status === 404) {
      cf = null;
    } else {
      await env.DB.prepare("UPDATE domains SET last_error = ?, checked_at = ? WHERE hostname = ?")
        .bind(String(error instanceof Error ? error.message : error).slice(0, 500), now(), row.hostname)
        .run();
      return row.status;
    }
  }
  const ready = cf?.status === "active" && cf.ssl?.status === "active";
  const failed = !cf || ["moved", "deleted", "blocked"].includes(cf.status);
  const status = ready ? "active" : failed ? "failed" : "pending";
  const error = cf ? cf.verification_errors?.join("; ") || null : "Cloudflare에 호스트네임이 없습니다";
  // Fenced on the state this refresh started from: a concurrent removal or refresh wins.
  const update = env.DB.prepare(
    `UPDATE domains SET status = ?, ssl_status = ?, last_error = ?, checked_at = ?,
       activated_at = CASE WHEN ? = 'active' THEN COALESCE(activated_at, ?) ELSE activated_at END
     WHERE hostname = ? AND status = ? AND cf_hostname_id = ?`,
  ).bind(status, cf?.ssl?.status ?? null, error, now(), status, now(), row.hostname, row.status, row.cf_hostname_id);
  if (status === row.status) {
    await update.run();
    return status;
  }
  // Status and the re-render marker commit together, so an interruption here is retried by the cron.
  const [applied] = await env.DB.batch([
    update,
    env.DB.prepare("UPDATE sites SET origin_pending = 1, updated_at = ? WHERE id = ?").bind(now(), row.site_id),
  ]);
  if (applied?.meta.changes !== 1) return row.status;
  await afterPrimaryChange(env, row.site_id);
  return status;
}

/**
 * Removal is resumable: stop billing at Cloudflare, mark the row `removing` (routing treats it
 * as gone), restore the primary host, and only then delete the row. A failure at any step
 * leaves a `removing` row that a retry or the cron finishes.
 */
export async function removeDomain(env: Env, siteId: string, hostname: string) {
  const row = await env.DB.prepare("SELECT * FROM domains WHERE hostname = ? AND site_id = ? AND kind = 'custom'")
    .bind(hostname, siteId)
    .first<DomainRow>();
  if (!row) throw new HttpError(404, "연결된 커스텀 도메인이 아닙니다");
  // Intent first, together with the routing and origin retry markers: if anything below stops
  // (even a Cloudflare outage), the cron restores the platform host and finishes the removal.
  if (row.status !== "removing") {
    await env.DB.batch([
      env.DB.prepare("UPDATE domains SET status = 'removing' WHERE hostname = ?").bind(hostname),
      env.DB.prepare("UPDATE sites SET origin_pending = 1, routes_synced_at = NULL, updated_at = ? WHERE id = ?").bind(now(), siteId),
    ]);
  }
  if (row.cf_hostname_id) await requireSaas(env).delete(row.cf_hostname_id);
  await afterPrimaryChange(env, siteId);
  // Final cleanup under the route-writer lease, so no in-flight sync can recreate the record.
  const token = await acquireRoutesLease(env.DB, siteId);
  if (!token) throw new HttpError(409, "라우팅을 갱신하는 중입니다. 삭제는 곧 자동으로 마무리됩니다");
  try {
    await kvWrite(() => env.ROUTES.delete(kvHostKey(hostname)));
    await env.DB.prepare("DELETE FROM domains WHERE hostname = ? AND status = 'removing'").bind(hostname).run();
  } finally {
    await releaseRoutesLease(env.DB, siteId, token);
  }
  await touchSite(env, siteId);
  return { hostname, removed: true };
}

/**
 * Cron: finish interrupted removals, retry pending origin re-renders, check pending hostnames
 * every few minutes (for 14 days) and active ones every 6 hours (a moved or expired hostname
 * falls back to the platform subdomain).
 */
export async function maintainDomains(env: Env) {
  const result = { removed: 0, rerendered: 0, checked: 0, changed: 0 };
  const { results: removing } = await env.DB.prepare("SELECT hostname, site_id FROM domains WHERE status = 'removing' LIMIT 20")
    .all<{ hostname: string; site_id: string }>();
  for (const row of removing) {
    try {
      await removeDomain(env, row.site_id, row.hostname);
      result.removed++;
    } catch (error) {
      console.error("[domains] removal retry failed", row.hostname, error);
    }
  }
  const { results: pendingOrigins } = await env.DB.prepare("SELECT id FROM sites WHERE origin_pending = 1 LIMIT 20").all<{ id: string }>();
  for (const { id } of pendingOrigins) {
    try {
      await afterPrimaryChange(env, id);
      result.rerendered++;
    } catch (error) {
      console.error("[domains] origin re-render failed", id, error);
    }
  }
  if (!SaasClient.configured(env)) return result;
  const at = Date.now();
  const { results } = await env.DB.prepare(
    `SELECT * FROM domains WHERE kind = 'custom' AND (
       (status = 'pending' AND activated_at IS NULL AND created_at >= ? AND (checked_at IS NULL OR checked_at < ?))
       OR (status IN ('pending', 'failed') AND activated_at IS NOT NULL AND (checked_at IS NULL OR checked_at < ?))
       OR (status = 'active' AND (checked_at IS NULL OR checked_at < ?))
     ) ORDER BY checked_at LIMIT 50`,
  )
    .bind(
      new Date(at - 14 * 86_400_000).toISOString(),
      new Date(at - 4 * 60_000).toISOString(),
      new Date(at - 30 * 60_000).toISOString(),
      new Date(at - 6 * 3_600_000).toISOString(),
    )
    .all<DomainRow>();
  for (const row of results) {
    try {
      if ((await refreshDomain(env, row)) !== row.status) result.changed++;
      result.checked++;
    } catch (error) {
      console.error("[domains] refresh failed", row.hostname, error);
    }
  }
  return result;
}

export async function domainQuota(env: Env) {
  const used = await requireSaas(env).count();
  return { used, included: INCLUDED_HOSTNAMES, overage: Math.max(0, used - INCLUDED_HOSTNAMES) };
}

/**
 * Hourly: any live version whose HTML was rendered for a different origin than the site's
 * current primary host gets `origin_pending`, whatever race produced it; maintainDomains fixes it.
 */
export async function auditOrigins(env: Env) {
  const { results } = await env.DB.prepare(
    `SELECT s.id, v.rendered_origin FROM sites s JOIN site_versions v ON v.id = s.published_version_id
     WHERE s.origin_pending = 0`,
  ).all<{ id: string; rendered_origin: string | null }>();
  let stale = 0;
  for (const row of results) {
    const site = await getSite(env.DB, row.id);
    if (row.rendered_origin !== renderKeyOf(env, await siteOrigin(env, site))) {
      await env.DB.prepare("UPDATE sites SET origin_pending = 1 WHERE id = ?").bind(row.id).run();
      stale++;
    }
  }
  return { sites: results.length, stale };
}
