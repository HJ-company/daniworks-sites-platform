import { renderSite, type SiteConfig } from "@sites/renderer";
import type { Env } from "./env.js";
import { HttpError } from "./http.js";
import { assetBase, siteOrigin } from "./publish.js";
import { getSite, latestVersion, type SiteRow } from "./store.js";

/**
 * Draft links (M4 4-C): what the customer gets in KakaoTalk before the site is public.
 * One link per site, always the latest version, so revising the draft keeps the link.
 * Served by the router at `<PREVIEW_ORIGIN>/preview/<token>[/privacy]` through PublicApi.
 */
export const DRAFT_LINK_DAYS = 30;

const now = () => new Date().toISOString();
const newToken = () => crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "").slice(0, 8);

/** Where draft links live: `https://dsites.kr` (staging/production), the router locally. */
export const draftOrigin = (env: Env) => env.PREVIEW_ORIGIN ?? `${env.PUBLIC_SCHEME ?? "https"}://${env.BASE_DOMAIN}`;

export function draftLink(env: Env, site: Pick<SiteRow, "preview_token" | "preview_expires_at">) {
  if (!site.preview_token || !site.preview_expires_at) return null;
  return {
    url: `${draftOrigin(env)}/preview/${site.preview_token}`,
    expiresAt: site.preview_expires_at,
    expired: site.preview_expires_at <= now(),
  };
}

/** New link (the old one stops working). */
export async function issueDraftLink(env: Env, site: SiteRow) {
  if (site.cancelled_at) throw new HttpError(409, "해지된 사이트입니다");
  const token = newToken();
  const expiresAt = new Date(Date.now() + DRAFT_LINK_DAYS * 86_400_000).toISOString();
  await env.DB.prepare("UPDATE sites SET preview_token = ?, preview_expires_at = ?, updated_at = ? WHERE id = ?")
    .bind(token, expiresAt, now(), site.id)
    .run();
  return draftLink(env, { preview_token: token, preview_expires_at: expiresAt })!;
}

export async function revokeDraftLink(env: Env, site: SiteRow) {
  await env.DB.prepare("UPDATE sites SET preview_token = NULL, preview_expires_at = NULL, updated_at = ? WHERE id = ?").bind(now(), site.id).run();
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Plain notice for links that do not (or no longer) work. */
function notice(status: number, title: string, body: string) {
  return {
    status,
    html:
      `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
      `<meta name="robots" content="noindex"><title>${escapeHtml(title)}</title>` +
      `<body style="margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,-apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;background:#f6f7f9;color:#1f2329">` +
      `<main style="text-align:center;padding:32px 24px;max-width:420px"><h1 style="font-size:20px;margin:0 0 12px">${escapeHtml(title)}</h1>` +
      `<p style="font-size:15px;margin:0;color:#5b616e;line-height:1.6">${escapeHtml(body)}</p></main></body></html>`,
  };
}

/**
 * Fixed bar at the top of every draft page, 40px tall. Inserted outside the React root so
 * hydration is unaffected; a spacer keeps content clear of it and the site's sticky header
 * (`.builder-navigation`, top: 0) is moved below it so neither covers the other.
 */
const BANNER =
  `<style>.builder-navigation{top:40px!important}</style>` +
  `<div role="status" style="position:fixed;top:0;left:0;right:0;z-index:2147483647;height:40px;box-sizing:border-box;display:flex;align-items:center;justify-content:center;` +
  `background:#1f2329;color:#fff;font:600 14px/1 system-ui,-apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;padding:0 12px;white-space:nowrap;overflow:hidden">` +
  `시안입니다. 아직 공개되지 않은 페이지입니다.</div><div aria-hidden="true" style="height:40px"></div>`;

export function withDraftBanner(html: string) {
  return html.replace(/<body([^>]*)>/i, (match) => `${match}${BANNER}`);
}

export interface DraftPage {
  status: number;
  html: string;
}

/** The router's request for `/preview/<token>[/<page>]`. */
export async function renderDraft(env: Env, token: string, route: string): Promise<DraftPage> {
  if (!/^[a-f0-9]{40}$/.test(token)) return notice(404, "시안 링크를 찾을 수 없습니다", "주소를 다시 확인하거나 담당자에게 링크를 요청해 주세요.");
  const row = await env.DB.prepare("SELECT id FROM sites WHERE preview_token = ?").bind(token).first<{ id: string }>();
  if (!row) return notice(404, "시안 링크를 찾을 수 없습니다", "새 링크로 바뀌었을 수 있습니다. 담당자에게 최신 링크를 요청해 주세요.");
  const site = await getSite(env.DB, row.id);
  if (site.cancelled_at) return notice(410, "더 이상 볼 수 없는 시안입니다", "담당자에게 문의해 주세요.");
  if (!site.preview_expires_at || site.preview_expires_at <= now()) {
    return notice(410, "시안 링크가 만료되었습니다", "링크는 30일 동안 열립니다. 담당자에게 새 링크를 요청해 주세요.");
  }
  const version = await latestVersion(env.DB, site.id);
  const { pages } = await renderSite(JSON.parse(version.config) as SiteConfig, {
    assetBase: assetBase(),
    origin: await siteOrigin(env, site),
    preview: true,
    turnstileFrame: null,
    linkPrefix: `/preview/${token}`,
  });
  const page = pages.find((entry) => entry.route === route);
  if (!page) return notice(404, "없는 페이지입니다", "시안의 첫 화면으로 돌아가 주세요.");
  return { status: 200, html: withDraftBanner(page.html) };
}
