/**
 * Console → platform API. Every path is under `/api`, which the console Worker (or the Vite
 * dev proxy) forwards to the api Worker with the admin token added server-side: the browser
 * never holds a credential.
 */
import { useQuery } from "@tanstack/react-query";
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}, attempt = 0): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(`/api${path}`, {
    ...rest,
    headers: { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...rest.headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (res.status === 401 && (data as { login?: string } | null)?.login) {
    // A parallel request may be renewing the session right now: retry with its cookie.
    if (attempt < 2 && !(rest.body instanceof ReadableStream)) {
      await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 300 : 1000));
      return api<T>(path, init, attempt + 1);
    }
    // Session over (logged out elsewhere, refresh refused): back through the login, then here.
    window.location.assign(`/auth/login?return=${encodeURIComponent(window.location.pathname + window.location.search)}`);
  }
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
  billing_status: BillingStatus | null;
  customer_id: string | null;
  customer_name: string | null;
  suspend_reason: "billing" | "manual" | null;
  updated_at: string;
}

export interface SiteRow extends Omit<SiteSummary, "published_number" | "latest_number" | "hostname" | "billing_status" | "customer_name"> {
  published_at: string | null;
  origin_pending: number;
  /** When a cancelled site's data may be deleted. */
  purge_after: string | null;
  /** The customer's draft link, if issued. */
  draft_link: DraftLink | null;
  /** "(작성 필요)" placeholders left in the latest draft. */
  draft_todos: number;
  /** Where the "(작성 필요)" placeholders are, as JSON paths (e.g. `pages[0].sections[2].title`). */
  draft_todo_fields: string[];
  /** Set while an operator (not billing) has the site down. */
  last_suspension: { actor_name: string | null; actor_type: string; reason: string | null; created_at: string } | null;
  /** Without a customer: existing customers with the site's phone or business number. */
  customer_suggestions: { id: string; name: string; contact_name: string | null; phone: string | null }[];
}

export interface DraftLink {
  url: string;
  expiresAt: string;
  expired: boolean;
}

export interface VersionRow {
  id: string;
  number: number;
  created_by: "ai" | "operator" | "customer";
  /** Operator behind the version (AI tool runs carry who ran them); null before M4. */
  author: string | null;
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
  source: "upload" | "url" | "ai";
  prompt: string | null;
  purpose: "background" | "illustration" | "mood" | "work" | null;
  customer_request: { channel: string; requestedAt: string; summary: string; recordedBy?: string | null } | null;
  cost_usd: number | null;
  /** Some version of some site refers to it (cannot be deleted). */
  in_use: boolean;
  created_at: string;
}

export interface GuideSummary {
  slug: string;
  title: string;
  kind: string;
  scope: string;
  summary: string;
  version: number;
  readOnly: boolean;
  updated_at?: string;
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

export type BillingStatus = "trial" | "awaiting" | "active" | "overdue" | "suspended" | "cancelled";
export type Cycle = "monthly" | "yearly";

export interface Subscription {
  siteId: string;
  cycle: Cycle;
  /** KRW supply price (VAT excluded). */
  amount: number;
  status: BillingStatus;
  statusLabel: string;
  billedAt: string | null;
  /** Last paid day that matters today (KST date). */
  paidThrough: string | null;
  latestEnd: string | null;
  nextPaidStart: string | null;
  nextDueOn: string | null;
  graceEndsOn: string | null;
  graceDaysLeft: number | null;
  daysOverdue: number | null;
  canPublish: boolean;
  nextPeriod: { start: string; end: string };
}

export interface Payment {
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
  invoice_issued_on: string | null;
  memo: string | null;
  voided_at: string | null;
  void_reason: string | null;
  created_at: string;
}

export interface QueueRow extends Subscription {
  site_id: string;
  slug: string;
  customer_id: string | null;
  customer_name: string | null;
  business_name: string | null;
  suspend_reason: "billing" | "manual" | null;
}

export interface Customer {
  id: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  business_number: string | null;
  invoice_email: string | null;
  external_ref: string | null;
  memo: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface CustomerSummary extends Customer {
  site_count: number;
  monthly_total: number;
  site_names: string | null;
  attention: number;
}

export interface CustomerDetail {
  customer: Customer;
  sites: {
    id: string;
    slug: string;
    status: "active" | "suspended";
    suspend_reason: "billing" | "manual" | null;
    cancelled_at: string | null;
    published_version_id: string | null;
    business_name: string | null;
    subscription: Subscription;
  }[];
  payments: Payment[];
  /** Sites without a customer whose latest draft has this customer's phone or business number. */
  unlinkedMatches: { id: string; slug: string; business_name: string | null }[];
}

export const won = (amount: number) => `${amount.toLocaleString("ko-KR")}원`;
export const CYCLE_LABEL: Record<Cycle, string> = { monthly: "월", yearly: "연" };

/** The signed-in operator and console settings from the console Worker (`/auth/me`). */
export interface Me {
  name: string | null;
  email: string | null;
  /** Where operators connect Claude/ChatGPT. */
  mcpUrl: string | null;
  /** Deposit account for payment requests to owners (e.g. "국민 000-00-0000 (주)다니웍스"). */
  billingAccount: string | null;
}

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const res = await fetch("/auth/me");
      return res.ok ? ((await res.json()) as Me) : null;
    },
    staleTime: Infinity,
  });
}
