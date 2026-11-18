import { Zip, ZipDeflate, ZipPassThrough } from "fflate";
import { kvBlogKey, syncBlogFeed } from "./blog.js";
import type { Env } from "./env.js";
import { HttpError } from "./http.js";
import { inquiriesCsv, listInquiries } from "./inquiries.js";
import { kvHostKey, kvSiteKey, r2PageKey } from "./keys.js";
import { removeDomain } from "./domains.js";
import { routesOf, syncHostRecordsNow } from "./routes.js";
import { acquireRoutesLease, getSite, releaseRoutesLease, type SiteRow } from "./store.js";
export { ensureNotPurged } from "./purge-guard.js";

const now = () => new Date().toISOString();
export const retentionDays = (env: Env) => Number(env.RETENTION_DAYS ?? 90);

/**
 * Cancellation: public serving stops (410), custom hostnames are deleted at Cloudflare so
 * billing stops, the blog feed stops. Data and files stay until purge (retention period).
 */
export async function cancelSite(env: Env, site: SiteRow) {
  if (site.cancelled_at) throw new HttpError(409, "이미 해지된 사이트입니다");
  const at = now();
  const { results } = await env.DB.prepare("SELECT hostname FROM domains WHERE site_id = ? AND kind = 'custom'")
    .bind(site.id)
    .all<{ hostname: string }>();
  // Everything that must eventually happen is committed together: the cancellation, custom
  // domains marked for removal (the domains cron finishes them even if Cloudflare is down),
  // the blog feed stopped and routing marked for reconciliation.
  await env.DB.batch([
    env.DB.prepare("UPDATE sites SET cancelled_at = ?, status = 'suspended', updated_at = ?, routes_synced_at = NULL WHERE id = ?").bind(
      at,
      at,
      site.id,
    ),
    env.DB.prepare("UPDATE domains SET status = 'removing' WHERE site_id = ? AND kind = 'custom'").bind(site.id),
    env.DB.prepare("DELETE FROM blog_feeds WHERE site_id = ?").bind(site.id),
  ]);
  await syncHostRecordsNow(env, site.id);
  const domains: { hostname: string; removed: boolean; error?: string }[] = [];
  for (const { hostname } of results) {
    try {
      await removeDomain(env, site.id, hostname);
      domains.push({ hostname, removed: true });
    } catch (error) {
      // The row stays `removing`; the domains cron finishes it.
      domains.push({ hostname, removed: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  await env.ROUTES.delete(kvBlogKey(site.id));
  const purgeAfter = new Date(Date.parse(at) + retentionDays(env) * 86_400_000).toISOString();
  return { siteId: site.id, cancelledAt: at, purgeAfter, domains };
}

/** Undo a cancellation within the retention period. Custom domains must be connected again. */
export async function reactivateSite(env: Env, site: SiteRow) {
  if (!site.cancelled_at) throw new HttpError(409, "해지된 사이트가 아닙니다");
  const resumed = await env.DB.prepare(
    "UPDATE sites SET cancelled_at = NULL, status = 'active', updated_at = ?, routes_synced_at = NULL WHERE id = ? AND purging_at IS NULL",
  )
    .bind(now(), site.id)
    .run();
  if (resumed.meta.changes !== 1) throw new HttpError(409, "삭제가 진행 중인 사이트입니다");
  await syncHostRecordsNow(env, site.id);
  // Cancellation stopped the blog feed; the live version decides whether it comes back.
  if (site.published_version_id) {
    const live = await env.DB.prepare("SELECT config FROM site_versions WHERE id = ?").bind(site.published_version_id).first<{ config: string }>();
    if (live) await syncBlogFeed(env, site.id, JSON.parse(live.config) as { business?: { blogUrl?: string } });
  }
  return { siteId: site.id, status: "active" };
}

export async function listCancellations(env: Env) {
  const { results } = await env.DB.prepare("SELECT id, slug, cancelled_at FROM sites WHERE cancelled_at IS NOT NULL ORDER BY cancelled_at")
    .all<{ id: string; slug: string; cancelled_at: string }>();
  const days = retentionDays(env);
  return results.map((row) => {
    const purgeAfter = new Date(Date.parse(row.cancelled_at) + days * 86_400_000).toISOString();
    return { ...row, purgeAfter, purgeable: purgeAfter <= now() };
  });
}

/**
 * Permanent deletion after the retention period. Irreversible, so never run by cron: an
 * operator confirms with the site's slug. Removes R2 files, KV records and every D1 row.
 */
export async function purgeSite(env: Env, site: SiteRow, confirmSlug: unknown) {
  if (confirmSlug !== site.slug) throw new HttpError(422, "확인용 slug가 일치하지 않습니다");
  if (!site.cancelled_at) throw new HttpError(409, "해지된 사이트만 삭제할 수 있습니다");
  const purgeAfter = Date.parse(site.cancelled_at) + retentionDays(env) * 86_400_000;
  if (Date.now() < purgeAfter) {
    throw new HttpError(409, `보관 기간이 끝나지 않았습니다 (${new Date(purgeAfter).toISOString().slice(0, 10)} 이후 삭제 가능)`);
  }
  const { results: domains } = await env.DB.prepare("SELECT hostname, kind, status FROM domains WHERE site_id = ?")
    .bind(site.id)
    .all<{ hostname: string; kind: string; status: string }>();
  // Checked before claiming the purge state: domain cleanup may still need to render, and
  // renders refuse once a purge is claimed.
  if (domains.some((d) => d.kind === "custom")) {
    throw new HttpError(409, "커스텀 도메인 삭제가 끝나지 않았습니다. 잠시 뒤 다시 시도하세요");
  }
  // Take the purge state first (conditional on the cancellation still standing); from here on
  // reactivation refuses, so nothing can resume the site while its data is being deleted.
  const claimed = await env.DB.prepare(
    `UPDATE sites SET purging_at = COALESCE(purging_at, ?)
     WHERE id = ? AND cancelled_at IS NOT NULL AND cancelled_at <= ?
       AND NOT EXISTS (SELECT 1 FROM domains WHERE site_id = ? AND kind = 'custom')`,
  )
    .bind(now(), site.id, new Date(Date.now() - retentionDays(env) * 86_400_000).toISOString(), site.id)
    .run();
  if (claimed.meta.changes !== 1) throw new HttpError(409, "해지가 취소되었거나 보관 기간이 끝나지 않았습니다");
  const sweep = async () => {
    let deleted = 0;
    let cursor: string | undefined;
    do {
      const page = await env.SITES.list({ prefix: `sites/${site.id}/`, cursor });
      if (page.objects.length) await env.SITES.delete(page.objects.map((o) => o.key));
      deleted += page.objects.length;
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    return deleted;
  };
  let objects = await sweep();
  // Routing records and the rows they are built from go under the route-writer lease, held
  // until the domain rows are gone: no reconcile can write a host record back in between.
  const token = await acquireRoutesLease(env.DB, site.id);
  if (!token) throw new HttpError(409, "라우팅을 갱신하는 중입니다. 잠시 뒤 다시 시도하세요(삭제는 이어서 진행됩니다)");
  try {
    for (const domain of domains) await env.ROUTES.delete(kvHostKey(domain.hostname));
    await env.ROUTES.delete(kvSiteKey(site.id));
    await env.ROUTES.delete(kvBlogKey(site.id));
    const tables = ["inquiries", "metrics_daily", "assets", "blog_feeds", "staged_renders", "domains", "site_versions"];
    await env.DB.batch(tables.map((table) => env.DB.prepare(`DELETE FROM ${table} WHERE site_id = ?`).bind(site.id)));
    // Writers that started before the cancellation clean up after themselves (they re-check
    // the site after writing); a last sweep catches anything written in between.
    objects += await sweep();
  } finally {
    await releaseRoutesLease(env.DB, site.id, token);
  }
  // The site row (with purging_at) goes last: until then an interrupted purge can be retried
  // with the same request and finishes the cleanup.
  await env.DB.prepare("DELETE FROM sites WHERE id = ? AND purging_at IS NOT NULL").bind(site.id).run();
  return { siteId: site.id, slug: site.slug, objectsDeleted: objects, purged: true };
}

const toBytes = (text: string) => new TextEncoder().encode(text);

/** `/_shared/...` and `/_media/...` paths referenced by HTML (src, href, srcset). */
function referencedFiles(html: string): string[] {
  const out = new Set<string>();
  for (const match of html.matchAll(/(?:src|href|srcset|imagesrcset)="([^"]+)"/gi)) {
    for (const candidate of match[1]!.split(",")) {
      const path = candidate.trim().split(/\s+/)[0] ?? "";
      if (/^\/_(shared|media)\//.test(path)) out.add(path);
    }
  }
  return [...out];
}

const r2KeyFor = (file: string) =>
  file.startsWith("/_media/")
    ? `sites/${file.split("/")[2]}/media/${file.split("/").slice(3).join("/")}`
    : `shared/${file.slice("/_shared/".length)}`;

/**
 * Everything a customer can take with them: the live site as static files (HTML, the shared
 * assets it uses, uploaded photos) and their data (all versions, inquiries, daily metrics).
 * Streamed: each R2 object flows through the ZIP writer into the response, so memory stays
 * at one chunk however many photos a site has. Root-relative links: serve at a domain root.
 */
export async function exportSite(env: Env, siteId: string): Promise<{ filename: string; body: ReadableStream<Uint8Array> }> {
  const site = await getSite(env.DB, siteId);
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const zip = new Zip((error, chunk, final) => {
    if (error) {
      void writer.abort(error);
      return;
    }
    void writer.write(chunk);
    if (final) void writer.close();
  });
  /** A deflated entry written incrementally, each piece waiting for the download. */
  const openEntry = async (name: string) => {
    const entry = new ZipDeflate(name, { level: 6 });
    zip.add(entry);
    return {
      push: async (bytes: Uint8Array) => {
        await writer.ready;
        entry.push(bytes);
      },
      end: async (bytes = new Uint8Array(0)) => {
        await writer.ready;
        entry.push(bytes, true);
      },
    };
  };
  /** Small files, pushed in 64 KB pieces that wait for the download like R2 objects do. */
  const addBytes = async (name: string, bytes: Uint8Array) => {
    const entry = new ZipDeflate(name, { level: 6 });
    zip.add(entry);
    for (let offset = 0; offset < bytes.length; offset += 65536) {
      await writer.ready;
      entry.push(bytes.subarray(offset, offset + 65536));
    }
    entry.push(new Uint8Array(0), true);
  };
  const addObject = async (name: string, object: R2ObjectBody) => {
    const entry = /\.(jpe?g|png|webp)$/.test(name) ? new ZipPassThrough(name) : new ZipDeflate(name, { level: 6 });
    zip.add(entry);
    const reader = object.body.getReader();
    for (;;) {
      // Backpressure: read the next chunk only when the download can take more. A client that
      // disconnects rejects `ready`, which stops production.
      await writer.ready;
      const { done, value } = await reader.read();
      if (done) break;
      entry.push(value);
    }
    entry.push(new Uint8Array(0), true);
  };

  const added = new Set<string>();
  const produce = async () => {
    if (site.published_version_id) {
      const version = await env.DB.prepare("SELECT id, number, config, render_id FROM site_versions WHERE id = ?")
        .bind(site.published_version_id)
        .first<{ id: string; number: number; config: string; render_id: string | null }>();
      if (version) {
        const assets = new Set<string>();
        for (const route of routesOf(JSON.parse(version.config) as { version?: unknown })) {
          const path = route === "/" ? "index.html" : `${route.slice(1)}/index.html`;
          const object = await env.SITES.get(r2PageKey(site.id, version.id, path, version.render_id));
          if (!object) continue;
          const html = await object.text();
          await addBytes(`site/${path}`, toBytes(html));
          for (const file of referencedFiles(html)) assets.add(file);
        }
        // The client bundle loads chunks dynamically: take the whole _assets folder it lives in.
        const bundle = [...assets].find((p) => p.endsWith("/_assets/client.js"));
        if (bundle) {
          const listed = await env.SITES.list({ prefix: `shared/${bundle.slice("/_shared/".length, -"client.js".length)}` });
          for (const o of listed.objects) assets.add(`/_shared/${o.key.slice("shared/".length)}`);
        }
        for (const file of assets) {
          const object = await env.SITES.get(r2KeyFor(file));
          if (object) await addObject(`site${file}`, object);
          added.add(`site${file}`);
        }
      }
    }
    // Every uploaded photo, including ones only drafts, older versions or an unpublished site
    // use: the exported version data must stay recoverable after deletion.
    let cursor: string | undefined;
    do {
      const page = await env.SITES.list({ prefix: `sites/${site.id}/media/`, cursor });
      for (const o of page.objects) {
        const path = `site/_media/${site.id}/${o.key.slice(`sites/${site.id}/media/`.length)}`;
        if (added.has(path)) continue;
        const object = await env.SITES.get(o.key);
        if (object) await addObject(path, object);
        added.add(path);
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    // Data files are written page by page, so a long history never sits in memory at once.
    const versionsFile = await openEntry("data/versions.json");
    await versionsFile.push(toBytes("[\n"));
    for (let offset = 0, first = true; ; offset += 20) {
      const { results } = await env.DB.prepare(
        "SELECT id, number, config, created_by, note, created_at, first_published_at FROM site_versions WHERE site_id = ? ORDER BY number LIMIT 20 OFFSET ?",
      )
        .bind(site.id, offset)
        .all<{ config: string }>();
      for (const v of results) {
        await versionsFile.push(toBytes(`${first ? "" : ",\n"}${JSON.stringify({ ...v, config: JSON.parse(v.config) }, null, 2)}`));
        first = false;
      }
      if (results.length < 20) break;
    }
    await versionsFile.end(toBytes("\n]\n"));
    await addBytes(
      "data/site.json",
      toBytes(JSON.stringify({ id: site.id, slug: site.slug, status: site.status, cancelled_at: site.cancelled_at, created_at: site.created_at }, null, 2)),
    );
    const inquiriesFile = await openEntry("data/inquiries.csv");
    let before: string | undefined;
    let header = true;
    do {
      const page = await listInquiries(env, site.id, { before, limit: 500 });
      const csv = inquiriesCsv(page.inquiries);
      // inquiriesCsv adds a BOM and header to each page; keep them only once.
      await inquiriesFile.push(toBytes(header ? csv : csv.slice(csv.indexOf("\r\n") + 2)));
      header = false;
      before = page.next ?? undefined;
    } while (before);
    await inquiriesFile.end();
    const metricsFile = await openEntry("data/metrics.csv");
    await metricsFile.push(toBytes("\uFEFFdate,event,count\r\n"));
    for (let offset = 0; ; offset += 1000) {
      const { results } = await env.DB.prepare("SELECT date, event, count FROM metrics_daily WHERE site_id = ? ORDER BY date, event LIMIT 1000 OFFSET ?")
        .bind(site.id, offset)
        .all<{ date: string; event: string; count: number }>();
      if (results.length) await metricsFile.push(toBytes(`${results.map((m) => `${m.date},${m.event},${m.count}`).join("\r\n")}\r\n`));
      if (results.length < 1000) break;
    }
    await metricsFile.end();
    await addBytes(
      "README.txt",
      toBytes(
        [
          `${site.slug} 홈페이지 내보내기 (${now().slice(0, 10)})`,
          "",
          "site/  게시 중인 홈페이지 파일입니다. 웹 서버의 도메인 루트(/)에 그대로 올리면 열립니다.",
          "data/versions.json  모든 버전의 사이트 설정(문구·사진 키·연락처)",
          "data/inquiries.csv  홈페이지 문의 기록 (엑셀에서 열 수 있습니다)",
          "data/metrics.csv  일별 방문·연락 클릭 수",
        ].join("\r\n"),
      ),
    );
    zip.end();
  };
  // Runs while the response streams; a failure aborts the download instead of a truncated zip.
  produce().catch((error) => void writer.abort(error));
  return { filename: `${site.slug}-export.zip`, body: readable };
}
