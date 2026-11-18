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
