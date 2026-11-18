import type { Env } from "./env.js";
import { kvHostKey, type HostRecord, type PublishedPointer } from "./keys.js";
import {
  acquireRoutesLease,
  clearRoutesSynced,
  holdsRoutesLease,
  markRoutesSynced,
  primaryHostname,
  releaseRoutesLease,
  servingState,
  sitesNeedingRouteSync,
  type SiteRow,
} from "./store.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** KV allows one write per key per second; retry rate-limited writes a few times. */
async function kvWrite(op: () => Promise<void>) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await op();
    } catch (error) {
      const limited = /429|too many/i.test(String(error));
      if (!limited || attempt >= 3) throw error;
      await sleep(1100);
    }
  }
}

/** Public status of a site as the router sees it. */
export function hostStatus(site: SiteRow): HostRecord["status"] {
  if (site.cancelled_at) return "cancelled";
  return site.status === "suspended" ? "suspended" : "active";
}

type Snapshot = Awaited<ReturnType<typeof snapshot>>;
type DomainRow = Snapshot["domains"][number];

/** What KV should hold for a hostname; null means the key must not exist. */
function expectedRecord(state: Snapshot, domain: DomainRow): HostRecord | null {
  // Custom hostnames that are not active yet must not serve the site.
  if (domain.kind === "custom" && domain.status !== "active") return null;
  return {
    siteId: state.site.id,
    status: state.status,
    pointer: state.pointer,
    redirectTo: domain.hostname === state.primary ? null : state.primary,
  };
}

/** Routes a stored config renders to (v2 adds the privacy page). */
export const routesOf = (config: { version?: unknown }) => (config.version === 2 ? ["/", "/privacy"] : ["/"]);

async function snapshot(env: Env, siteId: string) {
  const { site, version } = await servingState(env.DB, siteId);
  const pointer: PublishedPointer | null =
    version
      ? {
          versionId: version.id,
          number: version.number,
          // Rows from before migration 0003 are backfilled; never drop a live pointer over a missing time.
          publishedAt: site.published_at ?? site.updated_at,
          pages: routesOf(JSON.parse(version.config) as { version?: unknown }),
        }
      : null;
  const primary = await primaryHostname(env.DB, site, env.BASE_DOMAIN);
  const { results: domains } = await env.DB.prepare("SELECT hostname, kind, status FROM domains WHERE site_id = ?")
    .bind(site.id)
    .all<{ hostname: string; kind: string; status: string }>();
  const status = hostStatus(site);
  const key = JSON.stringify([status, pointer?.versionId, pointer?.publishedAt, primary, domains]);
  return { site, pointer, primary, domains, status, key };
}

/**
 * Rewrites the KV record of every hostname of a site from D1, the source of truth: status,
 * published pointer and redirect. One writer per site at a time (D1 lease). A caller that
 * cannot take the lease leaves the site marked unsynced; the holder re-reads D1 after writing
 * and catches up, and the reconcile cron covers anything left. Returns whether KV now matches.
 */
export async function syncHostRecords(env: Env, siteId: string): Promise<boolean> {
  await clearRoutesSynced(env.DB, siteId);
  const token = await acquireRoutesLease(env.DB, siteId);
  if (!token) return false;
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const state = await snapshot(env, siteId);
      for (const domain of state.domains) {
        // Fence: a holder whose lease expired must not overwrite a newer writer.
        if (!(await holdsRoutesLease(env.DB, siteId, token))) return false;
        const record = expectedRecord(state, domain);
        await kvWrite(() =>
          record
            ? env.ROUTES.put(kvHostKey(domain.hostname), JSON.stringify(record))
            : env.ROUTES.delete(kvHostKey(domain.hostname)),
        );
        // The lease may have expired while the write was in flight; then this write may be
        // stale, so leave the site dirty for the cron instead of trusting anyone's marker.
        if (!(await holdsRoutesLease(env.DB, siteId, token))) {
          await clearRoutesSynced(env.DB, siteId);
          return false;
        }
      }
      if ((await snapshot(env, siteId)).key === state.key) {
        await markRoutesSynced(env.DB, siteId, state.site.updated_at);
        return true;
      }
    }
    return false;
  } finally {
    await releaseRoutesLease(env.DB, siteId, token);
  }
}

/**
 * For request handlers: syncs now, retrying briefly while another writer holds the lease, so
 * the caller's change is live when it responds. The cron catches anything still pending.
 */
export async function syncHostRecordsNow(env: Env, siteId: string) {
  for (let attempt = 0; attempt < 4; attempt++) {
    if (await syncHostRecords(env, siteId)) return true;
    await sleep(1000);
  }
  return false;
}

/**
 * Cron safety net: re-syncs sites whose host records may lag D1 (a request failed after D1
 * committed, or KV kept rejecting writes). Guarantees serving converges to D1 within minutes.
 */
export async function reconcileHostRecords(env: Env) {
  const ids = await sitesNeedingRouteSync(env.DB);
  let synced = 0;
  for (const id of ids) {
    try {
      if (await syncHostRecords(env, id)) synced++;
    } catch (error) {
      console.error("[routes] reconcile failed", id, error);
    }
  }
  return { pending: ids.length, synced };
}

/**
 * Hourly audit: compares every site's expected host records with KV and marks mismatches
 * dirty, so the reconcile pass repairs them whatever race produced them. Writes nothing itself.
 */
export async function auditHostRecords(env: Env) {
  const { results } = await env.DB.prepare("SELECT id FROM sites").all<{ id: string }>();
  let dirty = 0;
  for (const { id } of results) {
    const state = await snapshot(env, id);
    for (const domain of state.domains) {
      const expected = expectedRecord(state, domain);
      const actual = await env.ROUTES.get(kvHostKey(domain.hostname));
      if ((expected ? JSON.stringify(expected) : null) !== actual) {
        await clearRoutesSynced(env.DB, id);
        dirty++;
        break;
      }
    }
  }
  return { sites: results.length, dirty };
}
