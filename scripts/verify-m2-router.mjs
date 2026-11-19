// M2 step 2-4: router reads one KV record per host (status, pointer, redirect); M1 records
// (bare siteId) still work; suspended sites answer 503, resumed sites serve again.
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { API, api, evidence, localD1, localKv, routerRequest, uploadShared, paySite } from "./lib/verify.mjs";

const { fieldFixture } = await import("../packages/renderer/src/templates/service-local/fixtures.ts");
const ev = evidence("m2-router");
const { check } = ev;
const run = Date.now().toString(36);

uploadShared();
const config = { ...structuredClone(fieldFixture), slug: `router-${run}` };
const host = `${config.slug}.localhost`;
const created = await api("POST", "/sites", { config, createdBy: "operator" });
const siteId = created.data.siteId;
await paySite(siteId);

const before = JSON.parse(localKv("get", `host:${host}`));
check("생성 직후 호스트 레코드: 상태 active, 포인터 없음", before.siteId === siteId && before.status === "active" && before.pointer === null, before);
const unpublished = await routerRequest(host, "/");
check("게시 전 404", unpublished.status === 404 && unpublished.body.includes("아직 공개되지 않은"));

const pub = await api("POST", `/sites/${siteId}/publish`);
const record = JSON.parse(localKv("get", `host:${host}`));
check("게시 후 호스트 레코드에 포인터·페이지 목록", record.pointer?.versionId === pub.data.versionId && record.pointer.pages.join() === "/,/privacy", record);
check("게시 후 200", (await routerRequest(host, "/")).status === 200);

// suspend / resume
const suspended = await api("POST", `/sites/${siteId}/suspend`);
const down = await routerRequest(host, "/");
check("정지: 503 + Retry-After + noindex", suspended.status === 200 && down.status === 503 && down.headers["retry-after"] === "86400" && down.body.includes("noindex"));
check("정지 중에도 레코드에 포인터 유지", JSON.parse(localKv("get", `host:${host}`)).pointer?.versionId === pub.data.versionId);
await api("POST", `/sites/${siteId}/resume`);
check("재개: 다시 200", (await routerRequest(host, "/")).status === 200);

// publish and suspend at the same time: the host record must end equal to D1, never active
const draft = await api("POST", `/sites/${siteId}/versions`, { config, createdBy: "operator" });
await Promise.all([
  api("POST", `/sites/${siteId}/publish`, { versionId: draft.data.versionId }),
  api("POST", `/sites/${siteId}/suspend`),
]);
const d1 = (await api("GET", `/sites/${siteId}`)).data.site;
const final = JSON.parse(localKv("get", `host:${host}`));
check(
  "게시·정지 동시 요청 후 호스트 레코드 = D1 (상태·게시 버전)",
  final.status === d1.status && final.pointer?.versionId === d1.published_version_id && d1.status === "suspended",
  { d1: { status: d1.status, published: d1.published_version_id }, kv: { status: final.status, pointer: final.pointer?.versionId } },
);
await api("POST", `/sites/${siteId}/resume`);

// A KV write lost after D1 committed: the cron re-syncs from D1.
await api("POST", `/sites/${siteId}/suspend`);
const stale = { ...JSON.parse(localKv("get", `host:${host}`)), status: "active" };
localKv("put", `host:${host}`, JSON.stringify(stale));
localD1(`UPDATE sites SET routes_synced_at = NULL WHERE id = '${siteId}'`);
const cron = await fetch(`${API}/__scheduled?cron=*/5+*+*+*+*`);
let healed;
for (let i = 0; i < 20; i++) {
  healed = JSON.parse(localKv("get", `host:${host}`));
  if (healed.status === "suspended") break;
  await new Promise((r) => setTimeout(r, 250));
}
const synced = localD1(`SELECT routes_synced_at, updated_at FROM sites WHERE id = '${siteId}'`)[0];
check("cron 재조정: 틀린 KV 레코드를 D1 상태(정지)로 복구, 동기화 표시 갱신", cron.ok && healed.status === "suspended" && synced.routes_synced_at === synced.updated_at, {
  kv: healed.status,
  synced,
});
await api("POST", `/sites/${siteId}/resume`);

// Hourly audit: a wrong KV record with an intact "synced" marker is found and repaired.
localKv("put", `host:${host}`, JSON.stringify({ ...JSON.parse(localKv("get", `host:${host}`)), status: "suspended" }));
const marker = localD1(`SELECT routes_synced_at FROM sites WHERE id = '${siteId}'`)[0].routes_synced_at;
await new Promise((r) => setTimeout(r, 1500));
await fetch(`${API}/__scheduled?cron=17+*+*+*+*`);
let audited;
for (let i = 0; i < 20; i++) {
  audited = JSON.parse(localKv("get", `host:${host}`));
  if (audited.status === "active") break;
  await new Promise((r) => setTimeout(r, 250));
}
check("매시간 점검: 동기화 표시가 있어도 KV가 틀리면 찾아서 복구", Boolean(marker) && audited.status === "active", { marker, kv: audited.status });

// M1-format record: bare siteId under host:, pointer under site:
const legacyHost = `legacy-${run}.localhost`;
localKv("put", `host:${legacyHost}`, siteId);
// A write from another process reaches the running workerd shortly after; poll briefly.
let legacy;
for (let i = 0; i < 20; i++) {
  legacy = await routerRequest(legacyHost, "/");
  if (legacy.status === 200) break;
  await new Promise((r) => setTimeout(r, 250));
}
check("M1 형식 레코드(문자열 siteId)도 서빙", legacy.status === 200 && legacy.headers["x-site-version"] === String(final.pointer.number), {
  version: legacy.headers["x-site-version"],
});

// M1 R2 layout: a pointer without renderId reads sites/<id>/<version>/index.html
{
  const legacyId = `legacy-${run}`;
  const html = "<!doctype html><title>M1 레이아웃</title>";
  execFileSync("pnpm", ["exec", "wrangler", "r2", "object", "put", `daniworks-sites/sites/${legacyId}/v1/index.html`, "--pipe", "--local", "--persist-to", "/state", "--content-type", "text/html"], {
    cwd: "apps/router",
    input: html,
    stdio: ["pipe", "ignore", "pipe"],
  });
  const legacyR2Host = `m1layout-${run}.localhost`;
  localKv("put", `host:${legacyR2Host}`, JSON.stringify({ siteId: legacyId, status: "active", pointer: { versionId: "v1", number: 1, publishedAt: "2026-01-01T00:00:00Z" }, redirectTo: null }));
  let res;
  for (let i = 0; i < 20; i++) {
    res = await routerRequest(legacyR2Host, "/");
    if (res.status === 200) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  check("renderId 없는 M1 포인터는 예전 R2 경로를 서빙", res.status === 200 && res.body.includes("M1 레이아웃"));
}

// methods
check("POST /는 405", (await routerRequest(host, "/", { method: "POST", body: "" })).status === 405);

// Upgrade path: a database migrated to 0002 with a published site gets published_at backfilled by 0003.
{
  const dir = mkdtempSync(join(tmpdir(), "d1-upgrade-"));
  const d1 = (args) =>
    execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", "DB", "--local", "--persist-to", dir, ...args], {
      cwd: "apps/api",
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  d1(["--file", "migrations/0001_init.sql"]);
  d1(["--file", "migrations/0002_m2_first_customer.sql"]);
  d1([
    "--command",
    "INSERT INTO sites (id, slug, template_id, published_version_id, created_at, updated_at) VALUES ('s1','old','service-local','v1','2026-01-01','2026-01-02');" +
      "INSERT INTO site_versions (id, site_id, number, config, created_by, preview_token, first_published_at, created_at) VALUES ('v1','s1',1,'{}','operator','t1','2026-01-01T10:00:00Z','2026-01-01');",
  ]);
  d1(["--file", "migrations/0003_sites_published_at.sql"]);
  const out = d1(["--command", "SELECT published_at FROM sites WHERE id = 's1'", "--json"]);
  const value = JSON.parse(out)[0].results[0].published_at;
  check("0002까지 적용된 DB에 0003: 게시된 사이트 published_at 채움", value === "2026-01-01T10:00:00Z", { value });
}

ev.finish({ siteId });
