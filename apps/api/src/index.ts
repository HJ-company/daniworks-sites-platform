import { parseSiteConfig, renderSite, SiteConfigError, type SiteConfig } from "@sites/renderer";
import { deleteAsset, listAssets, uploadAsset } from "./assets.js";
import { refreshBlog, refreshDueBlogs } from "./blog.js";
import {
  billingQueue,
  billSite,
  GRACE_DAYS,
  listPayments,
  recordPayment,
  refreshAllBilling,
  refreshBilling,
  requirePublishable,
  sitePayments,
  subscriptionOf,
  today,
  updatePayment,
  updateSubscription,
  voidPayment,
} from "./billing.js";
import { draftLink, issueDraftLink, revokeDraftLink, withDraftBanner } from "./draft-links.js";
import { getGuide, guideVersions, listGuides } from "./guides.js";
import { createCustomer, customerDetail, duplicatesOf, linkSite, listCustomers, updateCustomer } from "./customers.js";
import { placeholderPaths, todayList } from "./today.js";
import { allInquiries, inquiriesCsv, listInquiries, requireEmail } from "./inquiries.js";
import { currentQuarter, kstDay, metricsReport, quarterlyCsv, quarterlyOverview, quarterlyReport } from "./metrics.js";
import { turnstileFrame } from "./turnstile.js";
import type { Env } from "./env.js";
import { actionOf, actorName, audit, authenticate, mcpChallenge, protectedResourceMetadata, type Actor } from "./auth.js";
import { HttpError, json, readJson } from "./http.js";
import { MEDIA_PATH, r2MediaKey, r2SharedKey } from "./keys.js";
import { addDomain, auditOrigins, domainQuota, listDomains, maintainDomains, refreshDomain, removeDomain, type DomainRow } from "./domains.js";
import { templateSeedExport } from "./handoff.js";
import { handleMcp } from "./mcp.js";
import { assetBase, publish, rollback, siteOrigin } from "./publish.js";
import { auditHostRecords, reconcileHostRecords, syncHostRecordsNow } from "./routes.js";
import { cancelSite, exportSite, listCancellations, purgeSite, reactivateSite, retentionDays } from "./lifecycle.js";
import { commitRepublish, republishPlan, stagedPage, stageRepublish } from "./republish.js";
import { addDraft, configFromBody, createSiteFromInput, creator, previewUrl } from "./sites.js";
import { businessName, getSite, listSites, listVersions, setSiteStatus, versionByPreviewToken, type CreatedBy } from "./store.js";

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
    return new Response(withDraftBanner(page.html, "internal"), {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "x-robots-tag": "noindex, nofollow",
        "cache-control": "no-store",
      },
    });
  }

  // RFC 9728: where MCP clients (Claude, ChatGPT) find the authorization server (Authentik).
  if (method === "GET" && (url.pathname === "/.well-known/oauth-protected-resource" || url.pathname === "/.well-known/oauth-protected-resource/mcp")) {
    return json(protectedResourceMetadata(env));
  }

  let actor: Actor;
  try {
    actor = await authenticate(request, env);
  } catch (error) {
    // MCP clients start the OAuth flow from this challenge.
    if (url.pathname === "/mcp" && error instanceof HttpError && error.status === 401) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 401,
        headers: { "content-type": "application/json; charset=utf-8", "www-authenticate": mcpChallenge(env) },
      });
    }
    throw error;
  }

  // MCP tools for AI agents (Streamable HTTP, stateless).
  if (url.pathname === "/mcp") return handleMcp(request, env, actor);
  if (method === "GET" || method === "HEAD") return operatorRoutes(request, env, url, parts, method, actor, { target: null });

  // Every change is recorded with who made it, refused ones included.
  let status = 500;
  let createdSiteId: string | null = null;
  // Details a route adds to its audit row (e.g. a draft link replaced rather than first issued).
  const note: AuditNote = { target: null };
  // Payment corrections belong to the payment's site history.
  const paymentSite =
    parts[0] === "payments" && parts[1]
      ? ((await env.DB.prepare("SELECT site_id FROM payments WHERE id = ?").bind(parts[1]).first<{ site_id: string }>())?.site_id ?? null)
      : null;
  try {
    const response = await operatorRoutes(request, env, url, parts, method, actor, note);
    status = response.status;
    // A new site's id is only known from the answer.
    if (method === "POST" && parts.length === 1 && parts[0] === "sites" && status === 201) {
      createdSiteId = ((await response.clone().json()) as { siteId?: string }).siteId ?? null;
    }
    return response;
  } catch (error) {
    status = error instanceof HttpError ? error.status : error instanceof SiteConfigError ? 422 : 500;
    throw error;
  } finally {
    await audit(env, actor, {
      action: actionOf(method, parts),
      siteId: parts[0] === "sites" && parts[1] ? parts[1] : (paymentSite ?? createdSiteId),
      target: note.target ?? (parts[0] === "payments" || parts[0] === "customers" ? (parts[1] ?? null) : null),
      status,
    });
  }
}

/** What the audit row records about a request's target, filled in by the route that knows. */
interface AuditNote {
  target: string | null;
}

/** Routes for authenticated operators (Authentik `operator` group) and scripts. */
async function operatorRoutes(request: Request, env: Env, url: URL, parts: string[], method: string, actor: Actor, note: AuditNote): Promise<Response> {

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

  // GET /cancellations: cancelled sites with the date each may be purged.
  if (method === "GET" && url.pathname === "/cancellations") return json({ cancellations: await listCancellations(env) });

  // GET /domains/quota: custom hostnames on the zone vs. the 100 included.
  if (method === "GET" && url.pathname === "/domains/quota") return json(await domainQuota(env));

  // Customers: GET/POST /customers, GET/PATCH /customers/:id
  if (parts[0] === "customers") {
    if (parts.length === 1 && method === "GET") return json({ customers: await listCustomers(env.DB) });
    if (parts.length === 1 && method === "POST") return json({ customer: await createCustomer(env.DB, await readJson(request)) }, 201);
    if (parts.length === 2 && method === "GET") return json(await customerDetail(env.DB, parts[1]!));
    if (parts.length === 2 && method === "PATCH") return json({ customer: await updateCustomer(env.DB, parts[1]!, await readJson(request)) });
    throw new HttpError(404, "없는 경로입니다");
  }

  // Authoring guides (read-only here; edited through MCP): GET /guides, /guides/:slug[?version=], /guides/:slug/versions
  if (method === "GET" && parts[0] === "guides") {
    if (parts.length === 1) return json({ guides: await listGuides(env) });
    const slug = decodeURIComponent(parts[1]!);
    if (parts.length === 2) {
      const version = url.searchParams.get("version");
      return json({ guide: await getGuide(env, slug, undefined, version ? Number(version) : undefined) });
    }
    if (parts.length === 3 && parts[2] === "versions") return json({ versions: await guideVersions(env, slug) });
  }

  // GET /today: the operator's to-do list (payments, suspensions, drafts, domains, unlinked sites)
  if (method === "GET" && url.pathname === "/today") return json(await todayList(env));

  // Billing work list and payment history: GET /billing/queue, GET /payments?from=&to=&method=
  if (method === "GET" && url.pathname === "/billing/queue") return json({ today: today(), graceDays: GRACE_DAYS, sites: await billingQueue(env.DB) });
  if (parts[0] === "payments") {
    if (parts.length === 1 && method === "GET") {
      const filter = { from: url.searchParams.get("from"), to: url.searchParams.get("to"), method: url.searchParams.get("method") };
      return json(await listPayments(env.DB, filter));
    }
    // PATCH /payments/:id {periodStart, periodEnd, payerName, invoiceIssuedOn, memo, amount}; POST /payments/:id/void {reason}
    if (parts.length === 2 && method === "PATCH") return json({ payment: await updatePayment(env, parts[1]!, await readJson(request)) });
    if (parts.length === 3 && parts[2] === "void" && method === "POST") {
      const body = await readJson<{ reason?: unknown }>(request);
      return json({ payment: await voidPayment(env, parts[1]!, body.reason) });
    }
    throw new HttpError(404, "없는 경로입니다");
  }

  if (parts[0] !== "sites") throw new HttpError(404, "없는 경로입니다");

  // POST /sites {config, createdBy}
  if (method === "POST" && parts.length === 1) {
    const body = await readJson<{ config?: unknown; starter?: Record<string, unknown>; createdBy?: CreatedBy; customerId?: unknown }>(request);
    return json(await createSiteFromInput(env, configFromBody(body), creator(body.createdBy), body.customerId, actorName(actor)), 201);
  }

  // GET /sites: every site with its published version number and primary hostname.
  if (method === "GET" && parts.length === 1) {
    return json({ sites: await listSites(env.DB, env.BASE_DOMAIN) });
  }
  if (parts.length < 2) throw new HttpError(404, "없는 경로입니다");

  const site = await getSite(env.DB, parts[1]!);

  if (method === "GET" && parts.length === 2) {
    const versions = (await listVersions(env.DB, site.id)) as { preview_token: string }[];
    const purgeAfter = site.cancelled_at ? new Date(Date.parse(site.cancelled_at) + retentionDays(env) * 86_400_000).toISOString() : null;
    const { preview_token: _token, preview_expires_at: _expires, ...rest } = site;
    // Starter copy still to write in the latest draft, and where: the console warns before it goes to the owner.
    const latest = await env.DB.prepare("SELECT config FROM site_versions WHERE site_id = ? ORDER BY number DESC LIMIT 1").bind(site.id).first<{ config: string }>();
    const latestConfig = latest ? (JSON.parse(latest.config) as { business?: { phone?: string; businessNumber?: string } }) : null;
    const todoFields = latestConfig ? placeholderPaths(latestConfig) : [];
    // Who suspended the site, when and why (an operator's suspension is not billing's).
    const lastSuspension =
      site.status === "suspended" && site.suspend_reason === "manual"
        ? await env.DB.prepare(
            "SELECT actor_name, actor_type, target AS reason, created_at FROM audit_log WHERE site_id = ? AND action = 'POST /sites/:id/suspend' AND status = 200 ORDER BY created_at DESC LIMIT 1",
          )
            .bind(site.id)
            .first()
        : null;
    // No customer yet: offer the ones with the same phone or business number as the site.
    const customerSuggestions =
      !site.customer_id && latestConfig?.business
        ? (await duplicatesOf(env.DB, { phone: latestConfig.business.phone, businessNumber: latestConfig.business.businessNumber })).map((c) => ({
            id: c.id,
            name: c.name,
            contact_name: c.contact_name,
            phone: c.phone,
          }))
        : [];
    return json({
      site: {
        ...rest,
        business_name: await businessName(env.DB, site),
        purge_after: purgeAfter,
        draft_link: draftLink(env, site),
        draft_todos: todoFields.length,
        draft_todo_fields: todoFields,
        last_suspension: lastSuspension,
        customer_suggestions: customerSuggestions,
      },
      versions: versions.map((v) => ({ ...v, preview_url: previewUrl(env, v.preview_token) })),
    });
  }

  // PATCH /sites/:id {notifyEmail, customerId}: operational settings outside the versioned config.
  if (method === "PATCH" && parts.length === 2) {
    const body = await readJson<{ notifyEmail?: unknown; customerId?: unknown }>(request);
    if ("notifyEmail" in body) {
      await env.DB.prepare("UPDATE sites SET notify_email = ? WHERE id = ?").bind(requireEmail(body.notifyEmail), site.id).run();
    }
    if ("customerId" in body) await linkSite(env.DB, site.id, body.customerId);
    return json({ site: await getSite(env.DB, site.id) });
  }

  // GET /sites/:id/audit: recent changes to this site and who made them.
  if (method === "GET" && parts.length === 3 && parts[2] === "audit") {
    const { results } = await env.DB.prepare(
      "SELECT actor_type, actor_name, via, action, target, status, created_at FROM audit_log WHERE site_id = ? ORDER BY created_at DESC LIMIT 50",
    )
      .bind(site.id)
      .all();
    return json({ entries: results });
  }

  // Customer draft link: POST issues (or reissues: the old link stops), DELETE revokes.
  if (parts.length === 3 && parts[2] === "draft-link") {
    if (method === "POST") {
      note.target = site.preview_token ? "replaced" : "issued";
      return json({ draftLink: await issueDraftLink(env, site) }, 201);
    }
    if (method === "DELETE") {
      await revokeDraftLink(env, site);
      return json({ draftLink: null });
    }
  }

  // Subscription: GET (with payments), PATCH {cycle, amount}, POST /bill; POST /sites/:id/payments
  if (parts[2] === "subscription") {
    if (parts.length === 3 && method === "GET") {
      return json({ subscription: await subscriptionOf(env.DB, site.id), payments: await sitePayments(env.DB, site.id) });
    }
    if (parts.length === 3 && method === "PATCH") return json({ subscription: await updateSubscription(env, site, await readJson(request)) });
    if (parts.length === 4 && parts[3] === "bill" && method === "POST") return json({ subscription: await billSite(env, site) });
  }
  if (method === "POST" && parts.length === 3 && parts[2] === "payments") {
    return json(await recordPayment(env, site, await readJson(request), actorName(actor)), 201);
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

  // GET /sites/:id/template-seed[?versionId=]: content for the AI homepage importer
  if (method === "GET" && parts.length === 3 && parts[2] === "template-seed") {
    return json(await templateSeedExport(env, site.id, url.searchParams.get("versionId") ?? undefined));
  }

  // Lifecycle: POST /cancel, /reactivate, /purge {confirmSlug}; GET /export.zip
  if (method === "POST" && parts.length === 3 && parts[2] === "cancel") return json(await cancelSite(env, site));
  if (method === "POST" && parts.length === 3 && parts[2] === "reactivate") return json(await reactivateSite(env, site));
  if (method === "POST" && parts.length === 3 && parts[2] === "purge") {
    const body = await readJson<{ confirmSlug?: unknown }>(request);
    return json(await purgeSite(env, site, body.confirmSlug));
  }
  if (method === "GET" && parts.length === 3 && parts[2] === "export.zip") {
    const { filename, body } = await exportSite(env, site.id);
    return new Response(body, {
      headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${filename}"`, "cache-control": "no-store" },
    });
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
    const result = await addDraft(env, site, body.config, creator(body.createdBy), body.note ?? null, actorName(actor));
    return json(result, 201);
  }

  // POST /sites/:id/assets: raw image body, or JSON {url}. GET lists them (with in_use).
  if (parts[2] === "assets" && parts.length === 3) {
    if (method === "POST") return json(await uploadAsset(env, site, request), 201);
    if (method === "GET") return json({ assets: await listAssets(env, site) });
  }
  // DELETE /sites/:id/assets/<file>: an unused photo
  if (parts[2] === "assets" && parts.length === 4 && method === "DELETE") {
    note.target = `key=m:${site.id}/${parts[3]}`;
    return json(await deleteAsset(env, site, `m:${site.id}/${parts[3]}`));
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
    // The operator's reason for a suspension (optional) goes into the audit row.
    if (status === "suspended") {
      const body = await readJson<{ reason?: unknown }>(request).catch(() => ({}) as { reason?: unknown });
      if (typeof body.reason === "string" && body.reason.trim()) note.target = body.reason.trim().slice(0, 100);
    }
    // Going public again follows the same rule as publishing: no exceptions before payment.
    if (status === "active" && site.published_version_id) await requirePublishable(env.DB, site.id);
    await setSiteStatus(env.DB, site.id, status);
    await syncHostRecordsNow(env, site.id);
    // A payment voided after the check above must still take the site down.
    if (status === "active") await refreshBilling(env, site.id);
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
        // Billing moves with the date (KST); hourly is soon enough for a 14-day grace period.
        if (controller.cron === AUDIT_CRON) {
          await refreshAllBilling(env)
            .then((result) => console.log("[billing] refresh", JSON.stringify(result)))
            .catch((error) => console.error("[billing] refresh failed", error));
        }
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
