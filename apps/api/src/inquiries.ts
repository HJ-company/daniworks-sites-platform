import { formatIssues, inquirySubmissionSchema } from "@sites/schema";
import type { Env } from "./env.js";
import { escapeHtml, HttpError } from "./http.js";
import { sendMail } from "./mail.js";
import { sha256Hex } from "./hash.js";
import { bumpMetric } from "./metrics.js";
import { verifyTurnstile } from "./turnstile.js";

export const LIMITS = {
  /** Per visitor (hashed IP) within 10 minutes. */
  perClient: 5,
  /** Per site per day. */
  perSiteDay: 100,
  /** Faster than this is a bot. */
  minElapsedMs: 2000,
};

export interface InquiryRequest {
  siteId: string;
  hostname: string;
  ip: string | null;
  body: unknown;
}

export interface InquiryResponse {
  status: number;
  body: { ok: boolean; id?: string; error?: string; details?: string[] };
}

const kst = (iso: string) =>
  new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().replace("T", " ").slice(0, 16);

/** 02 (Seoul), 050x (safe numbers), then three-digit prefixes (mobile 01x, regions 0xx). */
export const displayPhone = (digits: string) =>
  digits.replace(/^(02|050\d|0\d{2})(\d{3,4})(\d{4})$/, "$1-$2-$3");

async function siteName(env: Env, siteId: string) {
  const row = await env.DB.prepare(
    "SELECT s.slug, v.config FROM sites s LEFT JOIN site_versions v ON v.id = s.published_version_id WHERE s.id = ?",
  )
    .bind(siteId)
    .first<{ slug: string; config: string | null }>();
  const config = row?.config ? (JSON.parse(row.config) as { business?: { name?: string }; meta?: { title?: string } }) : null;
  return config?.business?.name ?? config?.meta?.title ?? row?.slug ?? siteId;
}

/**
 * Handles a visitor inquiry routed from the public router (via RPC, never from the internet):
 * validation, spam checks (honeypot, timing, Turnstile, rate limits), storage, then mail.
 */
export async function submitInquiry(
  env: Env,
  request: InquiryRequest,
  waitUntil: (promise: Promise<unknown>) => void,
): Promise<InquiryResponse> {
  const parsed = inquirySubmissionSchema.safeParse(request.body);
  if (!parsed.success) {
    return { status: 422, body: { ok: false, error: "입력 내용을 확인해 주세요", details: formatIssues(parsed.error) } };
  }
  const input = parsed.data;
  // Bots: answer like a success so they learn nothing, store nothing.
  if (input.website || (input.elapsedMs !== undefined && input.elapsedMs < LIMITS.minElapsedMs)) {
    return { status: 200, body: { ok: true } };
  }

  const site = await env.DB.prepare("SELECT id, status, cancelled_at, notify_email FROM sites WHERE id = ?")
    .bind(request.siteId)
    .first<{ id: string; status: string; cancelled_at: string | null; notify_email: string | null }>();
  if (!site || site.status !== "active" || site.cancelled_at) {
    return { status: 404, body: { ok: false, error: "문의를 받을 수 없는 사이트입니다" } };
  }

  const turnstile = await verifyTurnstile(env.TURNSTILE_SECRET, input.turnstileToken, request.ip);
  if (!turnstile.ok) {
    return { status: 403, body: { ok: false, error: "스팸 방지 확인에 실패했습니다. 다시 시도해 주세요." } };
  }

  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const clientHash = request.ip ? await sha256Hex(new TextEncoder().encode(`${env.HASH_PEPPER ?? "dsites"}:${day}:${request.ip}`), 32) : null;
  const windowStart = new Date(now.getTime() - 10 * 60_000).toISOString();
  const dayStart = `${day}T00:00:00.000Z`;
  const id = crypto.randomUUID();
  const createdAt = now.toISOString();
  const notify = site.notify_email ? "pending" : "skipped";
  // Limit checks and insert in one statement: D1 runs statements one at a time, so concurrent
  // submissions cannot all pass the counts before any of them is stored.
  const inserted = await env.DB.prepare(
    `INSERT INTO inquiries (id, site_id, name, phone, message, page, client_hash, notify_status, created_at)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
     WHERE (? IS NULL OR (SELECT COUNT(*) FROM inquiries WHERE client_hash = ? AND created_at >= ?) < ?)
       AND (SELECT COUNT(*) FROM inquiries WHERE site_id = ? AND created_at >= ?) < ?
       AND EXISTS (SELECT 1 FROM sites WHERE id = ? AND cancelled_at IS NULL AND purging_at IS NULL)`,
  )
    .bind(
      id, site.id, input.name, input.phone, input.message, input.page ?? null, clientHash, notify, createdAt,
      clientHash, clientHash, windowStart, LIMITS.perClient,
      site.id, dayStart, LIMITS.perSiteDay,
      site.id,
    )
    .run();
  if (inserted.meta.changes !== 1) {
    const siteFull =
      ((await env.DB.prepare("SELECT COUNT(*) AS n FROM inquiries WHERE site_id = ? AND created_at >= ?")
        .bind(site.id, dayStart)
        .first<{ n: number }>())?.n ?? 0) >= LIMITS.perSiteDay;
    return {
      status: 429,
      body: {
        ok: false,
        error: siteFull ? "오늘은 더 이상 문의를 받을 수 없습니다. 전화로 연락해 주세요." : "잠시 뒤 다시 시도해 주세요",
      },
    };
  }
  await bumpMetric(env.DB, site.id, "inquiry", now);

  if (site.notify_email) {
    waitUntil(notifyOwner(env, site.id, site.notify_email, { id, ...input, createdAt, hostname: request.hostname }));
  }
  return { status: 201, body: { ok: true, id } };
}

async function notifyOwner(
  env: Env,
  siteId: string,
  to: string,
  inquiry: { id: string; name: string; phone: string; message: string; page?: string; createdAt: string; hostname: string },
) {
  const name = await siteName(env, siteId);
  const phone = displayPhone(inquiry.phone);
  const lines = [
    `${name} 홈페이지로 새 문의가 들어왔습니다.`,
    "",
    `이름: ${inquiry.name}`,
    `연락처: ${phone}`,
    `접수: ${kst(inquiry.createdAt)} (한국 시간)`,
    "",
    inquiry.message,
    "",
    `보낸 곳: https://${inquiry.hostname}${inquiry.page ?? "/"}`,
  ];
  try {
    const result = await sendMail(env, {
      to,
      subject: `[${name}] 홈페이지 문의 - ${inquiry.name}`,
      text: lines.join("\n"),
      html: `<p>${escapeHtml(lines[0]!)}</p><table cellpadding="4"><tr><th align="left">이름</th><td>${escapeHtml(inquiry.name)}</td></tr><tr><th align="left">연락처</th><td><a href="tel:${inquiry.phone}">${escapeHtml(phone)}</a></td></tr><tr><th align="left">접수</th><td>${escapeHtml(kst(inquiry.createdAt))} (한국 시간)</td></tr></table><p style="white-space:pre-line">${escapeHtml(inquiry.message)}</p><p style="color:#666">보낸 곳: ${escapeHtml(`https://${inquiry.hostname}${inquiry.page ?? "/"}`)}</p>`,
    });
    await env.DB.prepare("UPDATE inquiries SET notify_status = ? WHERE id = ?")
      .bind(result.skipped ? "skipped" : "sent", inquiry.id)
      .run();
  } catch (error) {
    console.error("[inquiry] notify failed", inquiry.id, error);
    await env.DB.prepare("UPDATE inquiries SET notify_status = 'failed', notify_error = ? WHERE id = ?")
      .bind(String(error).slice(0, 500), inquiry.id)
      .run();
  }
}

export interface InquiryRow {
  id: string;
  name: string;
  phone: string;
  message: string;
  page: string | null;
  notify_status: string;
  created_at: string;
}

export interface InquiryPage {
  inquiries: InquiryRow[];
  /** Pass as `before` for the next (older) page; null when there is none. */
  next: string | null;
}

/** Newest first, keyset-paginated on (created_at, id) so pages never skip or repeat rows. */
export async function listInquiries(
  env: Env,
  siteId: string,
  { from, to, before, limit = 200 }: { from?: string; to?: string; before?: string; limit?: number },
): Promise<InquiryPage> {
  const size = Math.min(Math.max(Number.isFinite(limit) ? limit : 200, 1), 1000);
  const [beforeAt, beforeId] = before ? before.split("|") : [null, null];
  const { results } = await env.DB.prepare(
    `SELECT id, name, phone, message, page, notify_status, created_at FROM inquiries
     WHERE site_id = ? AND created_at >= ? AND created_at < ?
       AND (? IS NULL OR created_at < ? OR (created_at = ? AND id < ?))
     ORDER BY created_at DESC, id DESC LIMIT ?`,
  )
    .bind(siteId, from ?? "0000", to ?? "9999", beforeAt, beforeAt, beforeAt, beforeId, size + 1)
    .all<InquiryRow>();
  const page = results.slice(0, size);
  const last = page.at(-1);
  return { inquiries: page, next: results.length > size && last ? `${last.created_at}|${last.id}` : null };
}

/** Every matching inquiry, page by page (CSV export never truncates). */
export async function allInquiries(env: Env, siteId: string, range: { from?: string; to?: string }) {
  const rows: InquiryRow[] = [];
  let before: string | undefined;
  for (;;) {
    const page = await listInquiries(env, siteId, { ...range, before, limit: 1000 });
    rows.push(...page.inquiries);
    if (!page.next) return rows;
    before = page.next;
  }
}

/** Excel-friendly CSV (UTF-8 BOM, CRLF). */
export function inquiriesCsv(rows: InquiryRow[]) {
  const cell = (value: string | null) => {
    const text = value ?? "";
    // Neutralize spreadsheet formulas from visitor input.
    const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const header = ["접수(한국 시간)", "이름", "연락처", "문의 내용", "페이지", "알림"].map(cell).join(",");
  const lines = rows.map((row) =>
    [kst(row.created_at), row.name, displayPhone(row.phone), row.message, row.page, row.notify_status].map(cell).join(","),
  );
  return `﻿${[header, ...lines].join("\r\n")}\r\n`;
}

export function requireEmail(value: unknown): string | null {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value) || value.length > 200) {
    throw new HttpError(422, "알림 이메일 형식이 아닙니다");
  }
  return value.trim();
}
