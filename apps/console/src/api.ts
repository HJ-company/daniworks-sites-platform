/**
 * Console → platform API. Every path is under `/api`, which the console Worker (or the Vite
 * dev proxy) forwards to the api Worker with the admin token added server-side: the browser
 * never holds a credential.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(`/api${path}`, {
    ...rest,
    headers: { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...rest.headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const body = data as { error?: string; details?: unknown } | null;
    throw new ApiError(res.status, body?.error ?? `HTTP ${res.status}`, body?.details);
  }
  return data as T;
}

export interface SiteSummary {
  id: string;
  slug: string;
  template_id: string;
  status: "active" | "suspended";
  cancelled_at: string | null;
  published_version_id: string | null;
  published_number: number | null;
  latest_number: number | null;
  notify_email: string | null;
  hostname: string;
  /** From the live version's config (else the latest draft's). */
  business_name: string | null;
  updated_at: string;
}

export interface SiteRow extends Omit<SiteSummary, "published_number" | "latest_number" | "hostname"> {
  published_at: string | null;
  origin_pending: number;
  /** When a cancelled site's data may be deleted. */
  purge_after: string | null;
}

export interface VersionRow {
  id: string;
  number: number;
  created_by: "ai" | "operator" | "customer";
  note: string | null;
  preview_token: string;
  /** Absolute api URL: previews load their own assets from the api origin. */
  preview_url: string;
  rendered_at: string | null;
  first_published_at: string | null;
  created_at: string;
}

export interface DomainRow {
  hostname: string;
  kind: "subdomain" | "custom";
  status: string;
  ssl_status: string | null;
  last_error: string | null;
  checked_at: string | null;
  verification_records: {
    cname: { type: string; name: string; value: string };
    /** Registrar host field (`www`, `www.shop`, `@`); null if unknown, missing before M4. */
    host?: string | null;
    /** Registered domain (`example.co.kr`); null if unknown, missing before M4. */
    zone?: string | null;
    optionalTxt: { type: string; name: string; value: string } | null;
    apex: boolean;
    note: string | null;
  } | null;
}

export interface Inquiry {
  id: string;
  name: string;
  phone: string;
  message: string;
  page: string | null;
  notify_status: string;
  created_at: string;
}

export interface Asset {
  key: string;
  url: string;
  width: number;
  height: number;
  bytes: number;
  original_name: string | null;
  created_at: string;
}

export type MetricEvent = "pageview" | "tel" | "kakao" | "map" | "booking" | "inquiry_cta" | "inquiry";
export interface MetricsReport {
  from: string;
  to: string;
  totals: Record<MetricEvent, number>;
  daily: { date: string; event: MetricEvent; count: number }[];
}

export const kst = (iso: string | null) =>
  iso ? new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().replace("T", " ").slice(0, 16) : "-";

export interface QuarterlyReport {
  quarter: string;
  from: string;
  to: string;
  totals: Record<MetricEvent, number>;
  conversions: number;
  previous: { quarter: string; totals: Record<MetricEvent, number>; conversions: number };
  monthly: ({ month: string } & Record<MetricEvent, number>)[];
}

export interface QuarterlyOverview {
  quarter: string;
  from: string;
  to: string;
  sites: { id: string; slug: string; hostname: string; status: string; totals: Record<MetricEvent, number> }[];
}

export const METRIC_LABELS: Record<MetricEvent, string> = {
  pageview: "방문",
  tel: "전화",
  kakao: "카톡",
  map: "지도",
  booking: "예약",
  inquiry_cta: "문의 버튼",
  inquiry: "문의 접수",
};
export const METRIC_ORDER: MetricEvent[] = ["pageview", "tel", "kakao", "map", "booking", "inquiry_cta", "inquiry"];
