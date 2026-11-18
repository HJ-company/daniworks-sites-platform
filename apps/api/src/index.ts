import { parseSiteConfig, renderSite, SiteConfigError, type SiteConfig } from "@sites/renderer";
import { listAssets, uploadAsset } from "./assets.js";
import { refreshBlog, refreshDueBlogs } from "./blog.js";
import { allInquiries, inquiriesCsv, listInquiries, requireEmail } from "./inquiries.js";
import { currentQuarter, kstDay, metricsReport, quarterlyCsv, quarterlyOverview, quarterlyReport } from "./metrics.js";
import { turnstileFrame } from "./turnstile.js";
import type { Env } from "./env.js";
import { HttpError, json, readJson, requireAdmin } from "./http.js";
import { MEDIA_PATH, r2MediaKey, r2SharedKey } from "./keys.js";
import { addDomain, auditOrigins, domainQuota, listDomains, maintainDomains, refreshDomain, removeDomain, type DomainRow } from "./domains.js";
import { handleMcp } from "./mcp.js";
import { assetBase, publish, rollback, siteOrigin } from "./publish.js";
import { auditHostRecords, reconcileHostRecords, syncHostRecordsNow } from "./routes.js";
import { commitRepublish, republishPlan, stagedPage, stageRepublish } from "./republish.js";
import { addDraft, configFromBody, createSiteFromInput, creator, previewUrl } from "./sites.js";
import { getSite, listSites, listVersions, setSiteStatus, versionByPreviewToken, type CreatedBy } from "./store.js";

/** Must match wrangler.toml [triggers]: the hourly audit; the 5-minute cron only reconciles. */
const AUDIT_CRON = "17 * * * *";

async function serveImmutable(env: Env, key: string) {
  const object = await env.SITES.get(key);
  if (!object) return new Response("not found", { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("cache-control", "public, max-age=31536000, immutable");
  return new Response(object.body, { headers });
}

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const method = request.method;

  if (method === "GET" && url.pathname === "/health") return json({ ok: true });

  // Shared assets are public and immutable; previews load them from here.
  if (method === "GET" && parts[0] === "_shared") return serveImmutable(env, r2SharedKey(parts.slice(1).join("/")));
  // Uploaded photos (public, content-addressed) so previews show them before publishing.
  const media = method === "GET" ? MEDIA_PATH.exec(url.pathname) : null;
  if (media) return serveImmutable(env, r2MediaKey(media[1]!, media[2]!));

  // Turnstile widget frame embedded by public sites (see turnstile.ts).
  if (method === "GET" && url.pathname === "/turnstile-frame") {
    if (!env.TURNSTILE_SITE_KEY) return new Response("turnstile not configured", { status: 404 });
    const parent = url.searchParams.get("parent") ?? "";
    if (!/^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(parent)) return new Response("bad parent", { status: 400 });
    return new Response(turnstileFrame(env.TURNSTILE_SITE_KEY, parent), {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" },
    });
  }

  // Preview: anyone with the token can view a version. Never indexed. /preview/<token>[/privacy]
  if (method === "GET" && parts[0] === "preview" && (parts.length === 2 || parts.length === 3)) {
    const version = await versionByPreviewToken(env.DB, parts[1]!);
    const site = await getSite(env.DB, version.site_id);
    const { pages } = await renderSite(JSON.parse(version.config) as SiteConfig, {
      assetBase: assetBase(),
      origin: await siteOrigin(env, site),
      preview: true,
      turnstileFrame: null,
      // Site links are root-relative (`/#inquiry`, `/privacy`); keep them inside this preview.
      linkPrefix: `/preview/${parts[1]}`,
    });
    const route = parts[2] ? `/${parts[2]}` : "/";
    const page = pages.find((entry) => entry.route === route);
    if (!page) throw new HttpError(404, "없는 페이지입니다");
    return new Response(page.html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "x-robots-tag": "noindex, nofollow",
        "cache-control": "no-store",
      },
    });
  }

  requireAdmin(request, env.ADMIN_TOKEN);

  // MCP tools for AI agents (Streamable HTTP, stateless). Same admin token.
  if (url.pathname === "/mcp") return handleMcp(request, env);

  // PUT /admin/shared/<version>/<path>: upload one shared asset file.
  if (method === "PUT" && parts[0] === "admin" && parts[1] === "shared" && parts.length > 3) {
    const key = r2SharedKey(parts.slice(2).join("/"));
    await env.SITES.put(key, request.body, {
      httpMetadata: { contentType: request.headers.get("content-type") ?? "application/octet-stream" },
    });
    return json({ key }, 201);
  }

  // POST /validate {config}: errors without saving (console editor, scripts).
  if (method === "POST" && url.pathname === "/validate") {
    const body = await readJson<{ config?: unknown }>(request);
    const result = parseSiteConfig(body.config);
    return json(result.ok ? { valid: true, errors: [], config: result.config } : { valid: false, errors: result.errors });
  }

  // GET /reports/quarterly?quarter=2026-Q4: every site's totals for the quarter.
  if (method === "GET" && url.pathname === "/reports/quarterly") {
    const report = await quarterlyOverview(env.DB, url.searchParams.get("quarter") ?? currentQuarter(), env.BASE_DOMAIN);
    if (!report) throw new HttpError(400, "quarter는 YYYY-Q1~Q4");
    return json(report);
  }

  // Full republish: GET /republish/plan; staged HTML at GET /staged/:siteId/:renderId[/privacy]
  if (method === "GET" && url.pathname === "/republish/plan") return json(await republishPlan(env));
  if (method === "GET" && parts[0] === "staged" && (parts.length === 3 || parts.length === 4)) {
    return stagedPage(env, parts[1]!, parts[2]!, parts[3] ?? "");
  }

  // GET /domains/quota: custom hostnames on the zone vs. the 100 included.
  if (method === "GET" && url.pathname === "/domains/quota") return json(await domainQuota(env));

  if (parts[0] !== "sites") throw new HttpError(404, "없는 경로입니다");

  // POST /sites {config, createdBy}
  if (method === "POST" && parts.length === 1) {
    const body = await readJson<{ config?: unknown; starter?: Record<string, unknown>; createdBy?: CreatedBy }>(request);
    return json(await createSiteFromInput(env, configFromBody(body), creator(body.createdBy)), 201);
  }

  // GET /sites: every site with its published version number and primary hostname.
  if (method === "GET" && parts.length === 1) {
    return json({ sites: await listSites(env.DB, env.BASE_DOMAIN) });
  }
  if (parts.length < 2) throw new HttpError(404, "없는 경로입니다");

  const site = await getSite(env.DB, parts[1]!);

  if (method === "GET" && parts.length === 2) {
    const versions = (await listVersions(env.DB, site.id)) as { preview_token: string }[];
    return json({ site, versions: versions.map((v) => ({ ...v, preview_url: previewUrl(env, v.preview_token) })) });
  }

  // PATCH /sites/:id {notifyEmail}: operational settings outside the versioned config.
  if (method === "PATCH" && parts.length === 2) {
    const body = await readJson<{ notifyEmail?: unknown }>(request);
    if ("notifyEmail" in body) {
      await env.DB.prepare("UPDATE sites SET notify_email = ? WHERE id = ?").bind(requireEmail(body.notifyEmail), site.id).run();
    }
    return json({ site: await getSite(env.DB, site.id) });
  }

  // Custom domains: GET list, POST {hostname}, POST /:host/refresh, DELETE /:host
  if (parts[2] === "domains") {
    if (method === "GET" && parts.length === 3) return json({ domains: await listDomains(env, site.id) });
    if (method === "POST" && parts.length === 3) {
      const body = await readJson<{ hostname?: unknown }>(request);
      return json(await addDomain(env, site, body.hostname), 201);
    }
    const hostname = decodeURIComponent(parts[3] ?? "");
    if (method === "POST" && parts[4] === "refresh" && parts.length === 5) {
      const row = await env.DB.prepare("SELECT * FROM domains WHERE hostname = ? AND site_id = ? AND kind = 'custom'")
        .bind(hostname, site.id)
        .first<DomainRow>();
      if (!row) throw new HttpError(404, "연결된 커스텀 도메인이 아닙니다");
      return json({ hostname, status: await refreshDomain(env, row) });
    }
    if (method === "DELETE" && parts.length === 4) return json(await removeDomain(env, site.id, hostname));
  }

  // POST /sites/:id/republish/stage | /republish/commit {renderId}
  if (method === "POST" && parts[2] === "republish" && parts.length === 4) {
    if (parts[3] === "stage") return json(await stageRepublish(env, site.id), 201);
    if (parts[3] === "commit") {
      const body = await readJson<{ renderId?: string }>(request);
      if (!body.renderId) throw new HttpError(400, "renderId가 필요합니다");
      return json(await commitRepublish(env, site.id, body.renderId));
    }
  }

  // POST /sites/:id/blog/refresh: fetch the blog RSS now (normally every 3 hours by cron)
  if (method === "POST" && parts[2] === "blog" && parts[3] === "refresh" && parts.length === 4) {
    return json(await refreshBlog(env, site.id));
  }

  // GET /sites/:id/reports/quarterly[.csv]?quarter=2026-Q4 (default: current quarter, KST)
  if (method === "GET" && (parts[2] === "reports") && (parts[3] === "quarterly" || parts[3] === "quarterly.csv") && parts.length === 4) {
    const report = await quarterlyReport(env.DB, site.id, url.searchParams.get("quarter") ?? currentQuarter());
    if (!report) throw new HttpError(400, "quarter는 YYYY-Q1~Q4");
    if (parts[3] === "quarterly") return json(report);
    return new Response(quarterlyCsv(report), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="report-${site.slug}-${report.quarter}.csv"`,
      },
    });
  }

  // GET /sites/:id/metrics?from=YYYY-MM-DD&to=YYYY-MM-DD (Korean dates, inclusive; default last 30 days)
  if (method === "GET" && parts[2] === "metrics" && parts.length === 3) {
    const today = kstDay(new Date());
    const from = url.searchParams.get("from") ?? kstDay(new Date(Date.now() - 29 * 86_400_000));
    const to = url.searchParams.get("to") ?? today;
    if (![from, to].every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))) throw new HttpError(400, "from·to는 YYYY-MM-DD");
    return json(await metricsReport(env.DB, site.id, from, to));
  }

  // GET /sites/:id/inquiries[.csv]?from=&to= (ISO dates)
  if (method === "GET" && (parts[2] === "inquiries" || parts[2] === "inquiries.csv") && parts.length === 3) {
    const range = { from: url.searchParams.get("from") ?? undefined, to: url.searchParams.get("to") ?? undefined };
    if (parts[2] === "inquiries") {
      return json(
        await listInquiries(env, site.id, {
          ...range,
          before: url.searchParams.get("before") ?? undefined,
          limit: Number(url.searchParams.get("limit") ?? 200),
        }),
      );
    }
    return new Response(inquiriesCsv(await allInquiries(env, site.id, range)), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="inquiries-${site.slug}.csv"`,
      },
    });
  }

  // GET /sites/:id/versions/:versionId (or "latest"): one version with its config
  if (method === "GET" && parts[2] === "versions" && parts.length === 4) {
    const row = await env.DB.prepare(
      parts[3] === "latest"
        ? "SELECT * FROM site_versions WHERE site_id = ? ORDER BY number DESC LIMIT 1"
        : "SELECT * FROM site_versions WHERE site_id = ? AND id = ?",
    )
      .bind(...(parts[3] === "latest" ? [site.id] : [site.id, parts[3]]))
      .first<{ config: string }>();
    if (!row) throw new HttpError(404, "버전이 없습니다");
    const { config, ...version } = row;
    return json({ version, config: JSON.parse(config) });
  }

  // POST /sites/:id/versions {config, createdBy, note}: new draft version
  if (method === "POST" && parts[2] === "versions") {
    const body = await readJson<{ config: unknown; createdBy?: CreatedBy; note?: string }>(request);
    const result = await addDraft(env, site, body.config, creator(body.createdBy), body.note ?? null);
    return json(result, 201);
  }

  // POST /sites/:id/assets: raw image body, or JSON {url}. GET lists them.
  if (parts[2] === "assets" && parts.length === 3) {
    if (method === "POST") return json(await uploadAsset(env, site, request), 201);
    if (method === "GET") return json({ assets: await listAssets(env, site) });
  }

  // POST /sites/:id/publish {versionId?}: latest version when omitted
  if (method === "POST" && parts[2] === "publish") {
    const body = await readJson<{ versionId?: string }>(request).catch(() => ({}) as { versionId?: string });
    return json(await publish(env, site, body.versionId));
  }

  // POST /sites/:id/suspend | /resume: stop or restart public serving (non-payment, requests).
  if (method === "POST" && (parts[2] === "suspend" || parts[2] === "resume") && parts.length === 3) {
    if (site.cancelled_at) throw new HttpError(409, "해지된 사이트입니다");
    const status = parts[2] === "suspend" ? "suspended" : "active";
    await setSiteStatus(env.DB, site.id, status);
    await syncHostRecordsNow(env, site.id);
    return json({ siteId: site.id, status });
  }

  // POST /sites/:id/rollback {versionId}
  if (method === "POST" && parts[2] === "rollback") {
    const body = await readJson<{ versionId: string }>(request);
    if (!body.versionId) throw new HttpError(400, "versionId가 필요합니다");
    return json(await rollback(env, site, body.versionId));
  }

  throw new HttpError(404, "없는 경로입니다");
}

export { PublicApi } from "./public.js";

export default {
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      (async () => {
        // Audits only mark work; maintenance and reconcile then do it in the same run.
        if (controller.cron === AUDIT_CRON) {
          console.log("[routes] audit", JSON.stringify(await auditHostRecords(env)));
          console.log("[domains] origin audit", JSON.stringify(await auditOrigins(env)));
        }
        console.log("[domains] maintain", JSON.stringify(await maintainDomains(env)));
        console.log("[blog] refresh", JSON.stringify(await refreshDueBlogs(env)));
        console.log("[routes] reconcile", JSON.stringify(await reconcileHostRecords(env)));
      })(),
    );
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handle(request, env);
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message, details: error.details }, error.status);
      if (error instanceof SiteConfigError) return json({ error: "설정 검증 실패", details: error.errors }, 422);
      console.error(error);
      return json({ error: "서버 오류" }, 500);
    }
  },
};
