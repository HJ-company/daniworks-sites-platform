export const METRIC_EVENTS = ["pageview", "tel", "kakao", "map", "booking", "inquiry_cta", "inquiry"] as const;
export type MetricEvent = (typeof METRIC_EVENTS)[number];

/** Korean calendar day (UTC+9) for daily counters: reports are read in Korean days. */
export const kstDay = (at: Date) => new Date(at.getTime() + 9 * 3600_000).toISOString().slice(0, 10);

export async function bumpMetric(db: D1Database, siteId: string, event: MetricEvent, at = new Date()) {
  await db
    .prepare(
      "INSERT INTO metrics_daily (site_id, date, event, count) VALUES (?, ?, ?, 1) ON CONFLICT (site_id, date, event) DO UPDATE SET count = count + 1",
    )
    .bind(siteId, kstDay(at), event)
    .run();
}

/** Events visitors' browsers may report; `inquiry` is counted by the server on a stored inquiry. */
const CLIENT_EVENTS = new Set<MetricEvent>(["pageview", "tel", "kakao", "map", "booking", "inquiry_cta"]);

/** Crawlers, link previews, monitors and headless browsers do not count as visits. */
export const BOT_UA =
  /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|kakaotalk-scrap|yeti|daumoa|headless|lighthouse|pagespeed|curl|wget|python|node-fetch|axios|go-http|java\//i;

export interface TrackRequest {
  siteId: string;
  userAgent: string | null;
  body: unknown;
}

/** Records one beacon. Returns what happened, for logs and tests; the router always answers 204. */
export async function recordTrack(db: D1Database, request: TrackRequest): Promise<"counted" | "ignored"> {
  const event = (request.body as { event?: unknown } | null)?.event;
  if (typeof event !== "string" || !CLIENT_EVENTS.has(event as MetricEvent)) return "ignored";
  if (!request.userAgent || BOT_UA.test(request.userAgent)) return "ignored";
  const site = await db.prepare("SELECT status, cancelled_at FROM sites WHERE id = ?")
    .bind(request.siteId)
    .first<{ status: string; cancelled_at: string | null }>();
  if (!site || site.status !== "active" || site.cancelled_at) return "ignored";
  await bumpMetric(db, request.siteId, event as MetricEvent);
  return "counted";
}

/** Totals and daily rows for a KST date range (inclusive), for reports and the console. */
export async function metricsReport(db: D1Database, siteId: string, from: string, to: string) {
  const { results } = await db
    .prepare("SELECT date, event, count FROM metrics_daily WHERE site_id = ? AND date >= ? AND date <= ? ORDER BY date, event")
    .bind(siteId, from, to)
    .all<{ date: string; event: MetricEvent; count: number }>();
  const totals = Object.fromEntries(METRIC_EVENTS.map((event) => [event, 0])) as Record<MetricEvent, number>;
  for (const row of results) totals[row.event] += row.count;
  return { from, to, totals, daily: results };
}

/** `2026-Q4` → Korean calendar dates (inclusive) and the previous quarter's label. */
export function quarterRange(quarter: string) {
  const m = /^(\d{4})-Q([1-4])$/.exec(quarter);
  if (!m) return null;
  const year = Number(m[1]);
  const q = Number(m[2]);
  const pad = (n: number) => String(n).padStart(2, "0");
  const startMonth = (q - 1) * 3 + 1;
  const endMonth = startMonth + 2;
  const lastDay = new Date(Date.UTC(year, endMonth, 0)).getUTCDate();
  const previous = q === 1 ? `${year - 1}-Q4` : `${year}-Q${q - 1}`;
  return {
    quarter,
    from: `${year}-${pad(startMonth)}-01`,
    to: `${year}-${pad(endMonth)}-${pad(lastDay)}`,
    months: [startMonth, startMonth + 1, endMonth].map((month) => `${year}-${pad(month)}`),
    previous,
  };
}

export const currentQuarter = (at = new Date()) => {
  const day = kstDay(at);
  return `${day.slice(0, 4)}-Q${Math.floor((Number(day.slice(5, 7)) - 1) / 3) + 1}`;
};

const emptyTotals = () => Object.fromEntries(METRIC_EVENTS.map((event) => [event, 0])) as Record<MetricEvent, number>;

/**
 * Quarterly report for one site: totals, the previous quarter for comparison, and monthly rows.
 * Calls (tel), Kakao, map and inquiries are the conversions the subscription is judged by.
 */
export async function quarterlyReport(db: D1Database, siteId: string, quarter: string) {
  const range = quarterRange(quarter);
  if (!range) return null;
  const previous = quarterRange(range.previous)!;
  const { results } = await db
    .prepare("SELECT date, event, count FROM metrics_daily WHERE site_id = ? AND date >= ? AND date <= ?")
    .bind(siteId, previous.from, range.to)
    .all<{ date: string; event: MetricEvent; count: number }>();
  const totals = emptyTotals();
  const before = emptyTotals();
  const monthly = Object.fromEntries(range.months.map((month) => [month, emptyTotals()]));
  for (const row of results) {
    if (row.date >= range.from) {
      totals[row.event] += row.count;
      monthly[row.date.slice(0, 7)]![row.event] += row.count;
    } else {
      before[row.event] += row.count;
    }
  }
  const conversions = (t: Record<MetricEvent, number>) => t.tel + t.kakao + t.map + t.booking + t.inquiry;
  return {
    quarter,
    from: range.from,
    to: range.to,
    totals,
    conversions: conversions(totals),
    previous: { quarter: range.previous, totals: before, conversions: conversions(before) },
    monthly: range.months.map((month) => ({ month, ...monthly[month]! })),
  };
}

/** One row per site for a quarter (operator overview, report production). */
export async function quarterlyOverview(db: D1Database, quarter: string, baseDomain: string) {
  const range = quarterRange(quarter);
  if (!range) return null;
  const { results } = await db
    .prepare(
      `SELECT s.id, s.slug, s.status, s.cancelled_at, m.event, COALESCE(SUM(m.count), 0) AS count
       FROM sites s LEFT JOIN metrics_daily m ON m.site_id = s.id AND m.date >= ? AND m.date <= ?
       GROUP BY s.id, m.event ORDER BY s.slug`,
    )
    .bind(range.from, range.to)
    .all<{ id: string; slug: string; status: string; cancelled_at: string | null; event: MetricEvent | null; count: number }>();
  const sites = new Map<string, { id: string; slug: string; hostname: string; status: string; totals: Record<MetricEvent, number> }>();
  for (const row of results) {
    const site =
      sites.get(row.id) ??
      { id: row.id, slug: row.slug, hostname: `${row.slug}.${baseDomain}`, status: row.cancelled_at ? "cancelled" : row.status, totals: emptyTotals() };
    if (row.event) site.totals[row.event] += row.count;
    sites.set(row.id, site);
  }
  return { quarter, from: range.from, to: range.to, sites: [...sites.values()] };
}

const LABELS: Record<MetricEvent, string> = {
  pageview: "방문",
  tel: "전화",
  kakao: "카톡",
  map: "지도",
  booking: "예약",
  inquiry_cta: "문의 버튼",
  inquiry: "문의 접수",
};

/** Excel-friendly CSV (UTF-8 BOM) of a site's quarterly report: one row per month plus total. */
export function quarterlyCsv(report: NonNullable<Awaited<ReturnType<typeof quarterlyReport>>>) {
  const header = ["기간", ...METRIC_EVENTS.map((e) => LABELS[e])].join(",");
  const row = (label: string, t: Record<MetricEvent, number>) => [label, ...METRIC_EVENTS.map((e) => t[e])].join(",");
  const lines = [
    header,
    ...report.monthly.map(({ month, ...t }) => row(month, t as Record<MetricEvent, number>)),
    row(`${report.quarter} 합계`, report.totals),
    row(`${report.previous.quarter} 합계`, report.previous.totals),
  ];
  return `﻿${lines.join("\r\n")}\r\n`;
}
