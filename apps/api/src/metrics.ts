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
