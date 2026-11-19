// Staging acceptance on the real zone: the M1 scenario against https://<slug>.<BASE_DOMAIN>,
// plus publish/rollback propagation timing, optionally from several regions via Globalping.
//
// Usage:
//   ADMIN_TOKEN=... node scripts/verify-staging.mjs            # token also read from apps/api/.dev.vars.staging
//   REGIONS=1 node scripts/verify-staging.mjs                  # add multi-region propagation probes
//
// Leaves the test site in place (slug stg-<time>). Staging data is wiped before launch.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const { businessBasicTemplate } = await import(
  "../packages/renderer/node_modules/@dani-builder/site-templates/dist/index.js"
);

const BASE = process.env.BASE_DOMAIN ?? "dsites.kr";
const API = process.env.API_URL ?? `https://api.${BASE}`;
const TOKEN =
  process.env.ADMIN_TOKEN ??
  (existsSync("apps/api/.dev.vars.staging")
    ? readFileSync("apps/api/.dev.vars.staging", "utf8").match(/^ADMIN_TOKEN=(.+)$/m)?.[1]?.trim()
    : undefined);
if (!TOKEN) throw new Error("ADMIN_TOKEN이 필요합니다 (env 또는 apps/api/.dev.vars.staging)");
const REGIONS = process.env.REGIONS === "1";
// Globalping probe locations: one per region the product cares about, plus far-away ones.
const PROBE_LOCATIONS = [
  { magic: "Seoul" },
  { magic: "Tokyo" },
  { magic: "Singapore" },
  { magic: "Frankfurt" },
  { magic: "Virginia" },
];

const out = "evidence/staging";
mkdirSync(out, { recursive: true });
const slug = `stg-${Date.now().toString(36)}`;
const host = `${slug}.${BASE}`;
const siteUrl = `https://${host}/`;

const results = [];
function check(name, pass, detail = {}) {
  results.push({ name, pass: Boolean(pass), ...detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${Object.keys(detail).length ? " " + JSON.stringify(detail) : ""}`);
}
async function api(method, path, body, { auth = true } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...(auth ? { authorization: `Bearer ${TOKEN}` } : {}), "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data, headers: res.headers };
}
async function get(url) {
  const res = await fetch(url, { headers: { "cache-control": "no-cache" } });
  return { status: res.status, headers: res.headers, body: await res.text() };
}
async function live() {
  const res = await get(siteUrl);
  return {
    status: res.status,
    version: res.headers.get("x-site-version"),
    title: res.body.match(/<title>([^<]*)/)?.[1],
    colo: res.headers.get("cf-ray")?.split("-")[1],
  };
}
async function waitFor(predicate, timeoutMs = 120_000) {
  const started = Date.now();
  for (;;) {
    const state = await live();
    if (predicate(state)) return { state, ms: Date.now() - started };
    if (Date.now() - started > timeoutMs) return { state, ms: null };
    await new Promise((r) => setTimeout(r, 1000));
  }
}

// Multi-region: poll Globalping HTTP probes until every region serves `version` (or timeout).
async function globalping(locations) {
  const res = await fetch("https://api.globalping.io/v1/measurements", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "http",
      target: host,
      locations,
      measurementOptions: { protocol: "HTTPS", request: { method: "HEAD", path: "/" } },
    }),
  });
  if (!res.ok) throw new Error(`globalping ${res.status} ${await res.text()}`);
  const { id } = await res.json();
  for (;;) {
    await new Promise((r) => setTimeout(r, 1000));
    const m = await (await fetch(`https://api.globalping.io/v1/measurements/${id}`)).json();
    if (m.status !== "in-progress") return m.results;
  }
}
async function waitRegions(version, startedAt, timeoutMs = 120_000) {
  const seen = new Map(); // region → { ms, colo }
  const labels = PROBE_LOCATIONS.map((l) => l.magic);
  while (seen.size < labels.length && Date.now() - startedAt < timeoutMs) {
    const pending = PROBE_LOCATIONS.filter((l) => !seen.has(l.magic));
    let probes;
    try {
      probes = await globalping(pending);
    } catch (error) {
      console.log(`  globalping 실패: ${error.message}`);
      break;
    }
    const at = Date.now() - startedAt;
    probes.forEach((p, i) => {
      const headers = p.result?.headers ?? {};
      if (String(headers["x-site-version"]) === version) {
        seen.set(pending[i].magic, { ms: at, colo: String(headers["cf-ray"] ?? "").split("-")[1] ?? null });
      }
    });
    if (seen.size < labels.length) await new Promise((r) => setTimeout(r, 5000));
  }
  return Object.fromEntries(labels.map((l) => [l, seen.get(l) ?? { ms: null }]));
}

function seedWithIcon(icon) {
  const seed = structuredClone(businessBasicTemplate.compositions["forest-stay"].seed);
  return JSON.parse(JSON.stringify(seed).replace('"icon":null', JSON.stringify({ icon }).slice(1, -1)));
}
const config = (title, extra = {}) => ({
  slug,
  templateId: "business-basic",
  compositionId: "forest-stay",
  paletteId: "pine",
  meta: { title, description: "스테이징 검증" },
  ...extra,
});
const timings = {};

// 0. health + shared assets
check("API health", (await api("GET", "/health", undefined, { auth: false })).status === 200, { api: API });
execFileSync("node", ["scripts/upload-shared.mjs"], { stdio: "inherit", env: { ...process.env, API_URL: API, ADMIN_TOKEN: TOKEN } });

// 1. auth
check("인증 없는 요청은 401", (await api("POST", "/sites", { config: config("x") }, { auth: false })).status === 401);

// 2. create
let t = Date.now();
const created = await api("POST", "/sites", { config: config("STG v1"), createdBy: "ai" });
timings.createMs = Date.now() - t;
check("사이트 생성 201", created.status === 201 && created.data.hostname === host, { hostname: created.data.hostname, ms: timings.createMs });
const siteId = created.data.siteId;
// M4: nothing is published before a payment.
check("입금 전 게시는 409", (await api("POST", `/sites/${siteId}/publish`)).status === 409);
await api("POST", `/sites/${siteId}/payments`, { payerName: "스테이징 검증" });
const v1 = created.data.versionId;

// 3. preview before publish
const site1 = await api("GET", `/sites/${siteId}`);
const previewUrl = `${API}/preview/${site1.data.versions[0].preview_token}`;
const preview = await get(previewUrl);
check("프리뷰 200 + noindex", preview.status === 200 && preview.headers.get("x-robots-tag")?.includes("noindex") && preview.body.includes("<title>STG v1"));
const prePublish = await live();
check("게시 전 공개 주소는 404", prePublish.status === 404, { colo: prePublish.colo });

// 4. publish v1. The 404 above may be cached at this colo's KV edge for up to 60 s.
t = Date.now();
const pub1 = await api("POST", `/sites/${siteId}/publish`);
timings.publish1Ms = Date.now() - t;
const w1 = await waitFor((s) => s.version === "1");
timings.publish1PropagationMs = w1.ms;
check("v1 게시 후 공개", pub1.status === 200 && w1.state.title === "STG v1", { publishMs: timings.publish1Ms, propagationMs: w1.ms, colo: w1.state.colo });

// 5. edit → draft is not live → publish v2
const v2 = await api("POST", `/sites/${siteId}/versions`, {
  config: config("STG v2", { paletteId: "clay", seed: seedWithIcon("FaPhone") }),
  createdBy: "customer",
  note: "콘솔 AI 수정 요청",
});
check("v2 초안 생성 201", v2.status === 201 && v2.data.number === 2);
check("초안은 공개 주소에 반영되지 않음", (await live()).version === "1");
t = Date.now();
const pub2 = await api("POST", `/sites/${siteId}/publish`);
timings.publish2Ms = Date.now() - t;
const pub2At = Date.now();
const w2 = await waitFor((s) => s.version === "2");
timings.publish2PropagationMs = w2.ms;
check("v2 게시 후 공개", pub2.status === 200 && w2.state.title === "STG v2", { publishMs: timings.publish2Ms, propagationMs: w2.ms, colo: w2.state.colo });
if (REGIONS) {
  timings.publish2Regions = await waitRegions("2", pub2At);
  console.log("  v2 지역별 반영", JSON.stringify(timings.publish2Regions));
}

// 6. rollback
t = Date.now();
const rb = await api("POST", `/sites/${siteId}/rollback`, { versionId: v1 });
timings.rollbackMs = Date.now() - t;
const rbAt = Date.now();
const w3 = await waitFor((s) => s.version === "1");
timings.rollbackPropagationMs = w3.ms;
check("v1로 롤백", rb.status === 200 && w3.state.title === "STG v1", { rollbackMs: timings.rollbackMs, propagationMs: w3.ms, colo: w3.state.colo });
if (REGIONS) {
  timings.rollbackRegions = await waitRegions("1", rbAt);
  console.log("  롤백 지역별 반영", JSON.stringify(timings.rollbackRegions));
}
const v3 = await api("POST", `/sites/${siteId}/versions`, { config: config("STG v3") });
const rbDraft = await api("POST", `/sites/${siteId}/rollback`, { versionId: v3.data.versionId });
check("게시된 적 없는 버전으로 롤백은 409", rbDraft.status === 409);
await api("POST", `/sites/${siteId}/publish`, { versionId: v2.data.versionId });
await waitFor((s) => s.version === "2");

// 7. validation
const before = (await api("GET", `/sites/${siteId}`)).data.versions.length;
const badIcon = await api("POST", `/sites/${siteId}/versions`, { config: config("bad", { seed: seedWithIcon("FaRocket") }) });
check("허용 목록 밖 아이콘은 422", badIcon.status === 422 && JSON.stringify(badIcon.data.details).includes("FaRocket"));
const badSlug = await api("POST", `/sites/${siteId}/versions`, { config: { ...config("bad"), slug: `${slug}-x` } });
check("slug 변경은 422", badSlug.status === 422);
const after = (await api("GET", `/sites/${siteId}`)).data.versions.length;
check("검증 실패는 버전을 만들지 않음", before === after, { versions: after });
check("중복 slug는 409", (await api("POST", "/sites", { config: config("dup") })).status === 409);

// 8. router edges
check("연결 안 된 호스트는 404", (await get(`https://nobody-${Date.now().toString(36)}.${BASE}/`)).status === 404);
const robots = await get(`${siteUrl}robots.txt`);
const sitemap = await get(`${siteUrl}sitemap.xml`);
check("robots.txt·sitemap.xml 200", robots.status === 200 && sitemap.status === 200 && sitemap.body.includes(host));
const page = await get(siteUrl);
// The stylesheet is inlined into the page; the client bundle is the shared, immutable asset.
const js = page.body.match(/src="(\/_shared\/[^"]+\.js)"/)?.[1];
const jsRes = js ? await get(new URL(js, siteUrl).href) : { status: 0, headers: new Headers() };
check("CSS는 페이지에, 공용 JS 200 + immutable", /<style>\/\*! tailwindcss/.test(page.body) && jsRes.status === 200 && jsRes.headers.get("cache-control")?.includes("immutable"), { js });

// 9. browser (optional: needs `playwright` resolvable from the repo)
let chromium;
try {
  ({ chromium } = createRequire(import.meta.url)("playwright"));
} catch {
  console.log("SKIP 브라우저 검사: playwright 없음");
}
if (chromium) {
  const browser = await chromium.launch();
  for (const [vp, viewport] of Object.entries({ mobile: { width: 390, height: 844 }, desktop: { width: 1280, height: 800 } })) {
    const p = await browser.newPage({ viewport });
    const errors = [];
    const failed = [];
    const external = [];
    p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    p.on("pageerror", (e) => errors.push(String(e)));
    p.on("requestfailed", (r) => failed.push(r.url()));
    p.on("request", (r) => !r.url().startsWith(siteUrl.slice(0, -1)) && external.push(r.url()));
    await p.goto(siteUrl, { waitUntil: "networkidle" });
    const hydrated = await p.evaluate(() => {
      const root = document.getElementById("root");
      return !!root && Object.keys(root).some((k) => k.startsWith("__reactContainer"));
    });
    await p.screenshot({ path: `${out}/site-${vp}.png`, fullPage: true });
    check(`브라우저 ${vp}`, hydrated && !errors.length && !failed.length && !external.length, { errors, failed, external });
    await p.close();
  }
  await browser.close();
}

writeFileSync(`${out}/results.json`, JSON.stringify({ at: new Date().toISOString(), api: API, slug, siteId, previewUrl, timings, results }, null, 2));
const failedCount = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failedCount}/${results.length} passed  (${siteUrl})`);
console.log(JSON.stringify(timings, null, 2));
process.exit(failedCount ? 1 : 0);
