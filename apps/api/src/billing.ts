import type { Env } from "./env.js";
import { HttpError } from "./http.js";
import { kstDay } from "./metrics.js";
import { syncHostRecordsNow } from "./routes.js";
import { BUSINESS_NAME_SQL, businessName, type SiteRow } from "./store.js";

/**
 * Billing (M4 4-B). One subscription per site; payments are confirmed by an operator and each
 * covers a period of KST dates (inclusive) the operator may edit. The subscription status is
 * derived from those periods:
 *
 *   trial      draft sent, nothing billed yet          (publish refused)
 *   awaiting   billed, no payment yet                  (publish refused)
 *   active     today within a paid period
 *   overdue    paid period ended, grace period running (site stays public)
 *   suspended  grace period over                       (site shows the preparing page)
 *   cancelled  site cancelled
 *
 * The derived status is stored so lists can filter on it and so side effects (suspending,
 * resuming) run only on a change.
 */

export type Cycle = "monthly" | "yearly";
export type BillingStatus = "trial" | "awaiting" | "active" | "overdue" | "suspended" | "cancelled";

export const GRACE_DAYS = 14;
/** Default supply prices in KRW (VAT excluded); editable per site. */
export const DEFAULT_AMOUNT: Record<Cycle, number> = { monthly: 30_000, yearly: 360_000 };
const PUBLISHABLE: BillingStatus[] = ["active", "overdue"];

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const toUtc = (day: string) => Date.parse(`${day}T00:00:00Z`);
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function isDay(value: unknown): value is string {
  if (typeof value !== "string" || !DAY.test(value)) return false;
  const ms = toUtc(value);
  return Number.isFinite(ms) && fromUtc(ms) === value;
}
export const addDays = (day: string, days: number) => fromUtc(toUtc(day) + days * 86_400_000);
export const daysBetween = (from: string, to: string) => Math.round((toUtc(to) - toUtc(from)) / 86_400_000);

/** Same day `months` later, clamped to the end of a shorter month (Jan 31 + 1 → Feb 28). */
export function addMonths(day: string, months: number) {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return fromUtc(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, last)));
}

export const today = () => kstDay(new Date());

/**
 * Period a new payment covers by default. Paid early or within the grace period, it continues
 * right after the paid period (grace days were served, so they are not free); after a
 * suspension, or for the first payment, it starts on the payment day. The operator may edit it.
 */
export function defaultPeriod(cycle: Cycle, paidThrough: string | null, paidOn: string) {
  const continues = paidThrough !== null && daysBetween(paidThrough, paidOn) <= GRACE_DAYS;
  const start = continues ? addDays(paidThrough, 1) : paidOn;
  return { start, end: addDays(addMonths(start, cycle === "yearly" ? 12 : 1), -1) };
}

export interface Period {
  start: string;
  end: string;
}

/**
 * What the paid periods say about a day. `coveredThrough`: last day of the unbroken run of
 * periods (overlapping or back to back) that includes `on`, or null if `on` is not paid.
 * `lastEndBefore`: the latest period end before `on`. `latestEnd`: the latest end of all.
 */
export function coverage(periods: Period[], on: string) {
  const sorted = [...periods].sort((a, b) => a.start.localeCompare(b.start));
  let coveredThrough: string | null = null;
  for (const period of sorted) {
    if (coveredThrough === null) {
      if (period.start <= on && on <= period.end) coveredThrough = period.end;
    } else if (period.start <= addDays(coveredThrough, 1) && period.end > coveredThrough) {
      coveredThrough = period.end;
    }
  }
  const ends = sorted.map((p) => p.end);
  const before = ends.filter((end) => end < on);
  return {
    coveredThrough,
    lastEndBefore: before.length ? before.reduce((a, b) => (a > b ? a : b)) : null,
    latestEnd: ends.length ? ends.reduce((a, b) => (a > b ? a : b)) : null,
  };
}

/**
 * The default period for a new payment: continues the current (or just expired) paid run, and
 * stops the day before a later prepaid period so it fills the gap instead of overlapping it.
 */
export function nextUnpaidPeriod(cycle: Cycle, paidThrough: string | null, periods: Period[], on: string): Period {
  const period = defaultPeriod(cycle, paidThrough, on);
  const later = periods.filter((p) => p.start > period.start && p.start <= period.end).map((p) => p.start).sort()[0];
  return later ? { start: period.start, end: addDays(later, -1) } : period;
}

export function deriveStatus(state: { cancelled: boolean; billedAt: string | null; periods: Period[] }, on: string): BillingStatus {
  if (state.cancelled) return "cancelled";
  const { coveredThrough, lastEndBefore } = coverage(state.periods, on);
  if (coveredThrough) return "active";
  if (lastEndBefore) return daysBetween(lastEndBefore, on) <= GRACE_DAYS ? "overdue" : "suspended";
  // Nothing paid yet (or only a period that starts later): billed, waiting for the period.
  return state.billedAt || state.periods.length ? "awaiting" : "trial";
}

export const canPublish = (status: BillingStatus) => PUBLISHABLE.includes(status);

export const STATUS_LABEL: Record<BillingStatus, string> = {
  trial: "시안",
  awaiting: "입금 대기",
  active: "활성",
  overdue: "연체",
  suspended: "중단",
  cancelled: "해지",
};

// ---------------------------------------------------------------------------------- storage

export interface SubscriptionRow {
  site_id: string;
  cycle: Cycle;
  amount: number;
  status: BillingStatus;
  billed_at: string | null;
  billing_rev: number;
  created_at: string;
  updated_at: string;
}

export interface PaymentRow {
  id: string;
  site_id: string;
  site_slug: string;
  business_name: string | null;
  amount: number;
  method: "manual" | "pg";
  payer_name: string | null;
  paid_on: string;
  period_start: string;
  period_end: string;
  confirmed_by: string | null;
  pg_tx_id: string | null;
  invoice_issued_on: string | null;
  memo: string | null;
  voided_at: string | null;
  void_reason: string | null;
  created_at: string;
  updated_at: string;
}

const now = () => new Date().toISOString();

export function newSubscription(db: D1Database, siteId: string, cycle: Cycle = "monthly") {
  return db
    .prepare("INSERT INTO subscriptions (site_id, cycle, amount, status, created_at, updated_at) VALUES (?, ?, ?, 'trial', ?, ?)")
    .bind(siteId, cycle, DEFAULT_AMOUNT[cycle], now(), now());
}

async function loadState(db: D1Database, siteId: string, on: string) {
  const row = await db
    .prepare(
      `SELECT sub.*, s.cancelled_at, s.status AS site_status, s.suspend_reason, s.published_version_id
       FROM subscriptions sub JOIN sites s ON s.id = sub.site_id WHERE sub.site_id = ?`,
    )
    .bind(siteId)
    .first<
      SubscriptionRow & { cancelled_at: string | null; site_status: string; suspend_reason: string | null; published_version_id: string | null }
    >();
  if (!row) throw new HttpError(404, "구독 정보가 없습니다");
  const { results: periods } = await db
    .prepare("SELECT period_start AS start, period_end AS end FROM payments WHERE site_id = ? AND voided_at IS NULL")
    .bind(siteId)
    .all<Period>();
  const status = deriveStatus({ cancelled: Boolean(row.cancelled_at), billedAt: row.billed_at, periods }, on);
  return { row, status, periods, ...coverage(periods, on) };
}

/** Subscription with its derived dates, for the console and the publish check. */
export async function subscriptionOf(db: D1Database, siteId: string, on = today()) {
  const { row, status, periods, coveredThrough, lastEndBefore, latestEnd } = await loadState(db, siteId, on);
  // The last paid day that matters today: the end of the current run, else of the last one.
  const paidThrough = coveredThrough ?? lastEndBefore;
  const graceEndsOn = !coveredThrough && lastEndBefore ? addDays(lastEndBefore, GRACE_DAYS) : null;
  return {
    siteId: row.site_id,
    cycle: row.cycle,
    amount: row.amount,
    status,
    statusLabel: STATUS_LABEL[status],
    billedAt: row.billed_at,
    paidThrough,
    /** A prepaid period further out, if any. */
    latestEnd,
    /** Start of the next paid period that has not begun yet (prepaid), if any. */
    nextPaidStart: periods.map((p) => p.start).filter((start) => start > on).sort()[0] ?? null,
    nextDueOn: paidThrough ? addDays(paidThrough, 1) : null,
    graceEndsOn,
    graceDaysLeft: status === "overdue" && graceEndsOn ? daysBetween(on, graceEndsOn) : null,
    daysOverdue: !coveredThrough && lastEndBefore ? daysBetween(lastEndBefore, on) : null,
    canPublish: canPublish(status),
    nextPeriod: nextUnpaidPeriod(row.cycle, paidThrough, periods, on),
  };
}

/**
 * Re-derives the stored status and makes public serving follow it. Idempotent, so it runs
 * after every payment change and hourly: a published site is served only while paid or in
 * grace; one the billing suspended comes back once paid. Operator suspensions and
 * cancellations are left alone. Writes are conditional on the billing revision it read: if
 * payments or the cancellation changed meanwhile it starts over from the new state.
 */
export async function refreshBilling(env: Env, siteId: string, on = today()) {
  for (let attempt = 0; ; attempt++) {
    const { row, status } = await loadState(env.DB, siteId, on);
    const rev = row.billing_rev;
    const same = "EXISTS (SELECT 1 FROM subscriptions WHERE site_id = ? AND billing_rev = ?)";
    const moved = await env.DB.prepare("UPDATE subscriptions SET status = ?, updated_at = ? WHERE site_id = ? AND billing_rev = ?")
      .bind(status, now(), siteId, rev)
      .run();
    if (moved.meta.changes !== 1) {
      if (attempt < 3) continue;
      throw new HttpError(409, "결제 정보가 바뀌는 중입니다. 다시 시도하세요");
    }
    let site: "suspended" | "resumed" | null = null;
    if (!row.cancelled_at) {
      const serve = canPublish(status);
      if (!serve && row.site_status === "active" && row.published_version_id) {
        const done = await env.DB.prepare(
          `UPDATE sites SET status = 'suspended', suspend_reason = 'billing', updated_at = ?
           WHERE id = ? AND status = 'active' AND cancelled_at IS NULL AND ${same}`,
        )
          .bind(now(), siteId, siteId, rev)
          .run();
        if (done.meta.changes === 1) site = "suspended";
      } else if (serve && row.site_status === "suspended" && row.suspend_reason === "billing") {
        const done = await env.DB.prepare(
          `UPDATE sites SET status = 'active', suspend_reason = NULL, updated_at = ?
           WHERE id = ? AND status = 'suspended' AND suspend_reason = 'billing' AND cancelled_at IS NULL AND ${same}`,
        )
          .bind(now(), siteId, siteId, rev)
          .run();
        if (done.meta.changes === 1) site = "resumed";
      }
      if (site) await syncHostRecordsNow(env, siteId);
    }
    return { siteId, from: row.status, status, changed: status !== row.status || site !== null, site };
  }
}

/** Cron: every live subscription. One site failing never stops the others. */
export async function refreshAllBilling(env: Env, on = today()) {
  const { results } = await env.DB.prepare("SELECT site_id FROM subscriptions WHERE status != 'cancelled'").all<{ site_id: string }>();
  const changes = [];
  const errors: { siteId: string; error: string }[] = [];
  for (const { site_id } of results) {
    try {
      const result = await refreshBilling(env, site_id, on);
      if (result.changed) changes.push(result);
    } catch (error) {
      errors.push({ siteId: site_id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { checked: results.length, changes, errors };
}

/** Publish, rollback and resume go through here: no exceptions before a payment is confirmed. */
export async function requirePublishable(db: D1Database, siteId: string) {
  const sub = await subscriptionOf(db, siteId);
  if (!sub.canPublish) {
    throw new HttpError(409, `입금이 확인된 기간에만 공개할 수 있습니다 (구독: ${sub.statusLabel})`, { reason: "subscription", status: sub.status });
  }
}

// ---------------------------------------------------------------------------------- inputs

function amountOf(value: unknown): number {
  const amount = typeof value === "string" ? Number(value.replace(/,/g, "")) : value;
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 0 || amount > 100_000_000) {
    throw new HttpError(422, "금액은 0 이상의 정수(원)여야 합니다");
  }
  return amount;
}

function optionalText(value: unknown, max: number, label: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.trim().length > max) throw new HttpError(422, `${label}은(는) ${max}자 이하여야 합니다`);
  return value.trim() || null;
}

function dayOf(value: unknown, label: string): string {
  if (!isDay(value)) throw new HttpError(422, `${label}은(는) YYYY-MM-DD 날짜여야 합니다`);
  return value;
}

function cycleOf(value: unknown): Cycle {
  if (value !== "monthly" && value !== "yearly") throw new HttpError(422, "결제 주기는 monthly 또는 yearly입니다");
  return value;
}

// ---------------------------------------------------------------------------------- actions

export async function updateSubscription(env: Env, site: SiteRow, body: { cycle?: unknown; amount?: unknown }) {
  const { row: current } = await loadState(env.DB, site.id, today());
  const cycle = body.cycle === undefined ? current.cycle : cycleOf(body.cycle);
  // Switching the cycle without a price resets to that cycle's default price.
  const amount = body.amount !== undefined ? amountOf(body.amount) : cycle !== current.cycle ? DEFAULT_AMOUNT[cycle] : current.amount;
  await env.DB.prepare("UPDATE subscriptions SET cycle = ?, amount = ?, updated_at = ? WHERE site_id = ?").bind(cycle, amount, now(), site.id).run();
  return subscriptionOf(env.DB, site.id);
}

/** The customer accepted the draft: ask for payment (시안 → 입금 대기). */
export async function billSite(env: Env, site: SiteRow) {
  if (site.cancelled_at) throw new HttpError(409, "해지된 사이트입니다");
  await env.DB.prepare("UPDATE subscriptions SET billed_at = COALESCE(billed_at, ?), updated_at = ? WHERE site_id = ?").bind(now(), now(), site.id).run();
  await refreshBilling(env, site.id);
  return subscriptionOf(env.DB, site.id);
}

/**
 * Operator confirmed a deposit. The period defaults to the next unpaid one; the operator may
 * set it instead. A default period is inserted only if no valid payment overlaps it, retrying
 * on a clash, so two confirmations at once get consecutive periods rather than the same one.
 */
export async function recordPayment(
  env: Env,
  site: SiteRow,
  body: { amount?: unknown; payerName?: unknown; paidOn?: unknown; periodStart?: unknown; periodEnd?: unknown; memo?: unknown },
  confirmedBy: string,
) {
  if (site.cancelled_at) throw new HttpError(409, "해지된 사이트입니다. 먼저 해지를 취소하세요");
  const paidOn = body.paidOn === undefined ? today() : dayOf(body.paidOn, "입금일");
  const explicit = body.periodStart !== undefined || body.periodEnd !== undefined;
  const payerName = optionalText(body.payerName, 40, "입금자명");
  const memo = optionalText(body.memo, 200, "메모");
  const name = await businessName(env.DB, site);
  const id = crypto.randomUUID();
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await subscriptionOf(env.DB, site.id, paidOn);
    const periodStart = body.periodStart === undefined ? current.nextPeriod.start : dayOf(body.periodStart, "시작일");
    // Without an end, the period runs one cycle from the chosen start.
    const periodEnd =
      body.periodEnd !== undefined
        ? dayOf(body.periodEnd, "종료일")
        : body.periodStart === undefined
          ? current.nextPeriod.end
          : addDays(addMonths(periodStart, current.cycle === "yearly" ? 12 : 1), -1);
    if (periodEnd < periodStart) throw new HttpError(422, "종료일이 시작일보다 빠릅니다");
    const amount = body.amount === undefined ? current.amount : amountOf(body.amount);
    const [inserted] = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO payments (id, site_id, site_slug, business_name, amount, method, payer_name, paid_on, period_start, period_end,
                               confirmed_by, memo, created_at, updated_at)
         SELECT ?, ?, ?, ?, ?, 'manual', ?, ?, ?, ?, ?, ?, ?, ?
         WHERE ? OR NOT EXISTS (SELECT 1 FROM payments WHERE site_id = ? AND voided_at IS NULL AND period_start <= ? AND period_end >= ?)`,
      ).bind(id, site.id, site.slug, name, amount, payerName, paidOn, periodStart, periodEnd, confirmedBy, memo, now(), now(),
        explicit ? 1 : 0, site.id, periodEnd, periodStart),
      // A payment implies the site was billed. The revision moves only if the payment went in.
      env.DB.prepare(
        "UPDATE subscriptions SET billed_at = COALESCE(billed_at, ?), billing_rev = billing_rev + 1 WHERE site_id = ? AND EXISTS (SELECT 1 FROM payments WHERE id = ?)",
      ).bind(now(), site.id, id),
    ]);
    if (inserted?.meta.changes === 1) {
      const refreshed = await refreshBilling(env, site.id);
      return { payment: await getPayment(env.DB, id), subscription: await subscriptionOf(env.DB, site.id), site: refreshed.site };
    }
  }
  throw new HttpError(409, "같은 사이트의 입금이 동시에 처리되고 있습니다. 다시 시도하세요");
}

export async function getPayment(db: D1Database, id: string) {
  const row = await db.prepare("SELECT * FROM payments WHERE id = ?").bind(id).first<PaymentRow>();
  if (!row) throw new HttpError(404, "결제 기록이 없습니다");
  return row;
}

/**
 * Corrections: the covered period (extend or shorten), payer, invoice date, memo, amount.
 * Only the fields given are written, so concurrent edits of different fields both stick; the
 * date order is checked against the row as it is at write time.
 */
export async function updatePayment(
  env: Env,
  id: string,
  body: { periodStart?: unknown; periodEnd?: unknown; payerName?: unknown; invoiceIssuedOn?: unknown; memo?: unknown; amount?: unknown },
) {
  const row = await getPayment(env.DB, id);
  if (row.voided_at) throw new HttpError(409, "취소된 결제는 고칠 수 없습니다");
  const sets: [string, unknown][] = [];
  if (body.periodStart !== undefined) sets.push(["period_start", dayOf(body.periodStart, "시작일")]);
  if (body.periodEnd !== undefined) sets.push(["period_end", dayOf(body.periodEnd, "종료일")]);
  if (body.payerName !== undefined) sets.push(["payer_name", optionalText(body.payerName, 40, "입금자명")]);
  if (body.invoiceIssuedOn !== undefined) {
    sets.push(["invoice_issued_on", body.invoiceIssuedOn === null || body.invoiceIssuedOn === "" ? null : dayOf(body.invoiceIssuedOn, "계산서 발행일")]);
  }
  if (body.memo !== undefined) sets.push(["memo", optionalText(body.memo, 200, "메모")]);
  if (body.amount !== undefined) sets.push(["amount", amountOf(body.amount)]);
  if (!sets.length) return row;
  const start = sets.find(([column]) => column === "period_start")?.[1] ?? null;
  const end = sets.find(([column]) => column === "period_end")?.[1] ?? null;
  const [updated] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE payments SET ${sets.map(([column]) => `${column} = ?`).join(", ")}, updated_at = ?
       WHERE id = ? AND voided_at IS NULL AND COALESCE(?, period_start) <= COALESCE(?, period_end)`,
    ).bind(...sets.map(([, value]) => value), now(), id, start, end),
    bumpRevision(env.DB, row.site_id),
  ]);
  if (updated?.meta.changes !== 1) {
    const current = await getPayment(env.DB, id);
    if (current.voided_at) throw new HttpError(409, "취소된 결제는 고칠 수 없습니다");
    throw new HttpError(422, "종료일이 시작일보다 빠릅니다");
  }
  if (await siteExists(env.DB, row.site_id)) await refreshBilling(env, row.site_id);
  return getPayment(env.DB, id);
}

/** Wrongly recorded payment: kept for the record but no longer counts. */
export async function voidPayment(env: Env, id: string, reason: unknown) {
  const row = await getPayment(env.DB, id);
  if (row.voided_at) throw new HttpError(409, "이미 취소된 결제입니다");
  const why = optionalText(reason, 200, "취소 사유");
  if (!why) throw new HttpError(422, "취소 사유를 입력하세요");
  const [voided] = await env.DB.batch([
    env.DB.prepare("UPDATE payments SET voided_at = ?, void_reason = ?, updated_at = ? WHERE id = ? AND voided_at IS NULL").bind(now(), why, now(), id),
    bumpRevision(env.DB, row.site_id),
  ]);
  if (voided?.meta.changes !== 1) throw new HttpError(409, "이미 취소된 결제입니다");
  if (await siteExists(env.DB, row.site_id)) await refreshBilling(env, row.site_id);
  return getPayment(env.DB, id);
}

/** Marks billing inputs as changed (payments, cancellation): in-flight refreshes start over. */
export const bumpRevision = (db: D1Database, siteId: string) =>
  db.prepare("UPDATE subscriptions SET billing_rev = billing_rev + 1 WHERE site_id = ?").bind(siteId);

async function siteExists(db: D1Database, siteId: string) {
  return Boolean(await db.prepare("SELECT 1 AS x FROM subscriptions WHERE site_id = ?").bind(siteId).first());
}

export async function sitePayments(db: D1Database, siteId: string) {
  const { results } = await db.prepare("SELECT * FROM payments WHERE site_id = ? ORDER BY period_start DESC, created_at DESC").bind(siteId).all<PaymentRow>();
  return results;
}

/** Payment history across sites. Dates filter on the payment day (KST). */
/**
 * Payment history across sites. Dates filter on the payment day (KST). Rows carry the site's
 * current customer and whether the site still exists (payments outlive purged sites).
 */
export async function listPayments(db: D1Database, filter: { from?: string | null; to?: string | null; method?: string | null }) {
  const where = ["1 = 1"];
  const binds: unknown[] = [];
  if (filter.from) {
    where.push("p.paid_on >= ?");
    binds.push(dayOf(filter.from, "from"));
  }
  if (filter.to) {
    where.push("p.paid_on <= ?");
    binds.push(dayOf(filter.to, "to"));
  }
  if (filter.method) {
    if (filter.method !== "manual" && filter.method !== "pg") throw new HttpError(422, "method는 manual 또는 pg");
    where.push("p.method = ?");
    binds.push(filter.method);
  }
  const clause = where.join(" AND ");
  const [rows, totals] = await db.batch<(PaymentRow & { customer_name: string | null; site_exists: number }) | Totals>([
    db
      .prepare(
        `SELECT p.*, c.name AS customer_name, (s.id IS NOT NULL) AS site_exists
         FROM payments p LEFT JOIN sites s ON s.id = p.site_id LEFT JOIN customers c ON c.id = s.customer_id
         WHERE ${clause} ORDER BY p.paid_on DESC, p.created_at DESC LIMIT ${HISTORY_LIMIT}`,
      )
      .bind(...binds),
    // Totals over the whole range, whatever the list shows: valid payments, and how many were voided.
    db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN p.voided_at IS NULL THEN 1 ELSE 0 END), 0) AS count,
                COALESCE(SUM(CASE WHEN p.voided_at IS NULL THEN p.amount ELSE 0 END), 0) AS total,
                COALESCE(SUM(CASE WHEN p.voided_at IS NULL THEN 0 ELSE 1 END), 0) AS voided
         FROM payments p WHERE ${clause}`,
      )
      .bind(...binds),
  ]);
  const payments = (rows!.results as (PaymentRow & { customer_name: string | null; site_exists: number })[]).map((p) => ({
    ...p,
    site_exists: Boolean(p.site_exists),
  }));
  const sum = totals!.results[0] as Totals;
  return { payments, count: sum.count, total: sum.total, voided: sum.voided, truncated: payments.length === HISTORY_LIMIT };
}

type Totals = { count: number; total: number; voided: number };

const HISTORY_LIMIT = 1000;

/** Work list for the payments screen: billed but unpaid, overdue, suspended for non-payment. */
export async function billingQueue(db: D1Database, on = today()) {
  const { results } = await db
    .prepare(
      `SELECT sub.site_id, s.slug, s.customer_id, s.suspend_reason, c.name AS customer_name,
              ${BUSINESS_NAME_SQL("s.id", "s.published_version_id")} AS business_name
       FROM subscriptions sub JOIN sites s ON s.id = sub.site_id LEFT JOIN customers c ON c.id = s.customer_id
       WHERE sub.status IN ('awaiting', 'overdue', 'suspended')`,
    )
    .all<{ site_id: string; slug: string; customer_id: string | null; suspend_reason: string | null; customer_name: string | null; business_name: string | null }>();
  const rows = [];
  for (const row of results) rows.push({ ...row, ...(await subscriptionOf(db, row.site_id, on)) });
  // Most urgent first: suspended, then overdue by grace left, then awaiting.
  const rank = { suspended: 0, overdue: 1, awaiting: 2 } as Record<string, number>;
  return rows.sort((a, b) => (rank[a.status] ?? 3) - (rank[b.status] ?? 3) || (a.graceDaysLeft ?? 99) - (b.graceDaysLeft ?? 99));
}
