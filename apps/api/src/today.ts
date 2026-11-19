import { STARTER_TODO } from "@sites/renderer";
import { billingQueue } from "./billing.js";
import type { Env } from "./env.js";
import { BUSINESS_NAME_SQL } from "./store.js";

/** JSON paths of the strings that still hold the starter's "(작성 필요)" marker. */
export function placeholderPaths(value: unknown, path = ""): string[] {
  if (typeof value === "string") return value.includes(STARTER_TODO) ? [path] : [];
  if (Array.isArray(value)) return value.flatMap((item, i) => placeholderPaths(item, `${path}[${i}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) => placeholderPaths(item, path ? `${path}.${key}` : key));
  }
  return [];
}

interface SiteBrief {
  id: string;
  slug: string;
  business_name: string | null;
}

/** Audit rows of successful operator suspensions, newest first (the reason is in `target`). */
const SUSPENSIONS = "FROM audit_log a WHERE a.action = 'POST /sites/:id/suspend' AND a.status = 200";
const NEWEST = "ORDER BY a.created_at DESC LIMIT 1";

/** One column of the newest suspension of site `s` (a correlated subquery). */
const lastSuspension = (column: "target" | "created_at") => `(SELECT a.${column} ${SUSPENSIONS} AND a.site_id = s.id ${NEWEST})`;

/** Who took a site down, when and why: shown while an operator (not billing) has it down. */
export function lastSuspensionOf(db: D1Database, siteId: string) {
  return db
    .prepare(`SELECT a.actor_name, a.actor_type, a.target AS reason, a.created_at ${SUSPENSIONS} AND a.site_id = ? ${NEWEST}`)
    .bind(siteId)
    .first();
}

/**
 * The operator's to-do list for the day, in one call: payments to chase, sites an operator took
 * down, drafts waiting on the owner, domains that did not connect, sites without a customer.
 */
export async function todayList(env: Env) {
  const name = BUSINESS_NAME_SQL("s.id", "s.published_version_id");
  const now = new Date().toISOString();
  const [manual, drafts, domains, unlinked] = await env.DB.batch<SiteBrief & Record<string, unknown>>([
    // Taken down by an operator: nothing brings these back on its own.
    env.DB.prepare(
      `SELECT s.id, s.slug, ${name} AS business_name, ${lastSuspension("target")} AS reason, ${lastSuspension("created_at")} AS since
       FROM sites s WHERE s.status = 'suspended' AND s.suspend_reason = 'manual' AND s.cancelled_at IS NULL`,
    ),
    // Not public yet: the draft link was never made, has expired, is out with the owner, or the
    // site is paid for and only waits to be published.
    env.DB.prepare(
      `SELECT s.id, s.slug, ${name} AS business_name, s.preview_expires_at, sub.status AS billing_status
       FROM sites s JOIN subscriptions sub ON sub.site_id = s.id
       WHERE s.published_version_id IS NULL AND s.cancelled_at IS NULL AND sub.status IN ('trial', 'awaiting', 'active')
       ORDER BY s.created_at`,
    ),
    // Custom domains waiting on the owner's DNS or failed.
    env.DB.prepare(
      `SELECT s.id, s.slug, ${name} AS business_name, d.hostname, d.status, d.created_at, d.last_error
       FROM domains d JOIN sites s ON s.id = d.site_id
       WHERE d.kind = 'custom' AND d.status IN ('pending', 'failed') AND s.cancelled_at IS NULL ORDER BY d.created_at`,
    ),
    // Nobody to call about these.
    env.DB.prepare(`SELECT s.id, s.slug, ${name} AS business_name FROM sites s WHERE s.customer_id IS NULL AND s.cancelled_at IS NULL ORDER BY s.created_at`),
  ]);
  const draftRows = (drafts!.results as unknown as (SiteBrief & { preview_expires_at: string | null; billing_status: string })[]).map((row) => ({
    ...row,
    draft:
      row.billing_status === "active"
        ? "paid"
        : !row.preview_expires_at
          ? "no-link"
          : row.preview_expires_at <= now
            ? "expired"
            : row.billing_status === "awaiting"
              ? "billed"
              : "sent",
  }));
  return {
    billing: await billingQueue(env.DB),
    manualSuspensions: manual!.results,
    drafts: draftRows,
    domains: domains!.results,
    unlinked: unlinked!.results,
  };
}
