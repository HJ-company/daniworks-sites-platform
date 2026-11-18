// M2 step 2-8: custom domains through the Cloudflare for SaaS API (cf-mock in Docker).
// register → instructions → pending (not served) → activation by cron → custom host serves,
// subdomain 301s, canonical moves → removal restores the subdomain; failure and quota paths.
import { API, ROUTER_PORT, api, chromium, evidence, localD1, localKv, routerRequest, uploadShared } from "./lib/verify.mjs";

const { fieldFixture } = await import("../packages/renderer/src/templates/service-local/fixtures.ts");
const CF_MOCK = process.env.CF_MOCK_URL ?? "http://127.0.0.1:8790";
const ev = evidence("m2-domains");
const { check } = ev;
const run = Date.now().toString(36);
const mock = (host, action) => fetch(`${CF_MOCK}/__mock/${host}/${action}`, { method: "POST" });
const cron = () => fetch(`${API}/__scheduled?cron=*/5+*+*+*+*`);
const settle = async (predicate, tries = 40) => {
  for (let i = 0; i < tries; i++) {
    if (await predicate()) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
};

uploadShared();
const config = { ...structuredClone(fieldFixture), slug: `dom-${run}` };
const sub = `${config.slug}.localhost`;
const custom = `www.verify-${run}.co.kr`;
const created = await api("POST", "/sites", { config, createdBy: "operator" });
const siteId = created.data.siteId;
await api("POST", `/sites/${siteId}/publish`);
// A second published version, so rollback after the domain change can be checked.
const v2 = await api("POST", `/sites/${siteId}/versions`, { config: { ...config, meta: { ...config.meta, title: "두 번째 버전" } } });
await api("POST", `/sites/${siteId}/publish`, { versionId: v2.data.versionId });
const quota0 = (await api("GET", "/domains/quota")).data;

// 1. register
const added = await api("POST", `/sites/${siteId}/domains`, { hostname: `https://WWW.verify-${run}.co.kr/` });
check(
  "등록: 201 pending, CNAME 안내(fallback 대상), www라 루트 아님",
  added.status === 201 && added.data.hostname === custom && added.data.status === "pending" &&
    added.data.instructions.cname.value === "fallback.dsites.kr" && added.data.instructions.apex === false &&
    added.data.instructions.optionalTxt?.name === `_cf-custom-hostname.${custom}`,
  added.data,
);
const apex = await api("POST", `/sites/${siteId}/domains`, { hostname: `verify-${run}.co.kr` });
check("루트 도메인은 apex 표시와 www+포워딩 안내", apex.status === 201 && apex.data.instructions.apex === true && apex.data.instructions.note.includes("포워딩"));
check("같은 도메인 중복 409", (await api("POST", `/sites/${siteId}/domains`, { hostname: custom })).status === 409);
const other = await api("POST", "/sites", { config: { ...structuredClone(fieldFixture), slug: `dom2-${run}` }, createdBy: "operator" });
check("다른 사이트가 쓰는 도메인 409", (await api("POST", `/sites/${other.data.siteId}/domains`, { hostname: custom })).status === 409);
check("형식 오류 422", (await api("POST", `/sites/${siteId}/domains`, { hostname: "not a domain" })).status === 422);
check("플랫폼 도메인 422", (await api("POST", `/sites/${siteId}/domains`, { hostname: "x.dsites.kr" })).status === 422 &&
  (await api("POST", `/sites/${siteId}/domains`, { hostname: `x.${config.slug}.localhost` })).status === 422);
const quota1 = (await api("GET", "/domains/quota")).data;
check("quota: 호스트네임 2개 증가, 포함 100개", Number.isInteger(quota0.used) && quota1.used === quota0.used + 2 && quota1.included === 100, { quota0, quota1 });

// 2. pending: not served, subdomain unaffected
check("검증 전 커스텀 도메인은 404", (await routerRequest(custom, "/")).status === 404);
check("검증 전 서브도메인은 그대로 200", (await routerRequest(sub, "/")).status === 200);

// 3. activation by the cron
await mock(custom, "activate");
await cron();
const active = await settle(async () => (await api("GET", `/sites/${siteId}/domains`)).data.domains.find((d) => d.hostname === custom)?.status === "active");
check("cron이 활성화를 반영", active);
let home;
await settle(async () => (home = await routerRequest(custom, "/")).status === 200);
check("커스텀 도메인 200, canonical이 커스텀 도메인", home.status === 200 && home.body.includes(`<link rel="canonical" href="http://${custom}/">`));
const redirect = await routerRequest(sub, "/privacy?x=1");
check("서브도메인은 경로를 유지해 301", redirect.status === 301 && redirect.headers.location === `http://${custom}/privacy?x=1`, { location: redirect.headers.location });
check("KV: 커스텀 레코드는 redirect 없음, 서브도메인은 커스텀으로", JSON.parse(localKv("get", `host:${custom}`)).redirectTo === null && JSON.parse(localKv("get", `host:${sub}`)).redirectTo === custom);
check("사이트 목록의 대표 호스트가 커스텀 도메인", (await api("GET", "/sites")).data.sites.find((s) => s.id === siteId)?.hostname === custom);

// 4. a browser on the custom hostname
const browser = await chromium().launch({ args: [`--host-resolver-rules=MAP ${custom} 127.0.0.1`] });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const response = await page.goto(`http://${custom}:${ROUTER_PORT}/`, { waitUntil: "networkidle" });
const hydrated = await page.evaluate(() => Object.keys(document.getElementById("root") ?? {}).some((k) => k.startsWith("__reactContainer")));
check("브라우저: 커스텀 도메인에서 열리고 하이드레이션", response?.status() === 200 && hydrated && !errors.length, { errors });
await browser.close();

// 4a. rollback to a version rendered before the domain change re-renders its origin
const rolled = await api("POST", `/sites/${siteId}/rollback`, { versionId: created.data.versionId });
const rolledHome = await routerRequest(custom, "/");
check("도메인 변경 전 버전으로 롤백해도 canonical은 현재 도메인", rolled.status === 200 && rolledHome.headers["x-site-version"] === "1" && rolledHome.body.includes(`<link rel="canonical" href="http://${custom}/">`));
await api("POST", `/sites/${siteId}/publish`, { versionId: v2.data.versionId });

// 4b. resilience: an interrupted origin re-render is retried by the cron
localD1(`UPDATE sites SET origin_pending = 1 WHERE id = '${siteId}'`);
localD1(`UPDATE site_versions SET rendered_origin = 'stale' WHERE site_id = '${siteId}'`);
await cron();
const retried = await settle(async () => localD1(`SELECT origin_pending FROM sites WHERE id = '${siteId}'`)[0].origin_pending === 0);
const rerendered = localD1(`SELECT rendered_origin FROM site_versions WHERE id = (SELECT published_version_id FROM sites WHERE id = '${siteId}')`)[0];
check("중단된 재렌더는 cron이 다시 해서 origin_pending 0", retried && rerendered.rendered_origin.includes(custom), rerendered);

// 5. a failing hostname never serves
await mock(apex.data.hostname, "fail");
const refreshed = await api("POST", `/sites/${siteId}/domains/${apex.data.hostname}/refresh`);
check("검증 실패는 failed, 서빙 안 함", refreshed.data.status === "failed" && (await routerRequest(apex.data.hostname, "/")).status === 404);

// 5b. an active hostname that Cloudflare later moves falls back to the subdomain (cron)
const extra = `shop-${run}.example.com`;
await api("POST", `/sites/${other.data.siteId}/publish`);
await api("POST", `/sites/${other.data.siteId}/domains`, { hostname: extra });
await mock(extra, "activate");
await api("POST", `/sites/${other.data.siteId}/domains/${extra}/refresh`);
await mock(extra, "fail");
localD1(`UPDATE domains SET checked_at = '2000-01-01T00:00:00.000Z' WHERE hostname = '${extra}'`);
await cron();
const fellBack = await settle(async () => (await routerRequest(`dom2-${run}.localhost`, "/")).status === 200);
check("활성 도메인이 나중에 실패하면 cron이 찾아 서브도메인으로 복귀", fellBack && (await routerRequest(extra, "/")).status === 404);

// 5b'. a hostname deleted at Cloudflare outside the API is treated as failed
const gone = `gone-${run}.example.com`;
await api("POST", `/sites/${other.data.siteId}/domains`, { hostname: gone });
await mock(gone, "activate");
await api("POST", `/sites/${other.data.siteId}/domains/${gone}/refresh`);
const redirectingBefore = (await routerRequest(`dom2-${run}.localhost`, "/")).status === 301;
await mock(gone, "delete");
const refreshedGone = await api("POST", `/sites/${other.data.siteId}/domains/${gone}/refresh`);
check("Cloudflare에서 지워진 호스트네임(404)은 failed, 서브도메인 복귀", redirectingBefore && refreshedGone.data.status === "failed" && (await routerRequest(`dom2-${run}.localhost`, "/")).status === 200);
await api("DELETE", `/sites/${other.data.siteId}/domains/${gone}`);

// 5d. a once-active domain that went back to pending is polled past the 14-day window
const old = `old-${run}.example.com`;
await api("POST", `/sites/${other.data.siteId}/domains`, { hostname: old });
await mock(old, "activate");
await api("POST", `/sites/${other.data.siteId}/domains/${old}/refresh`);
await mock(old, "pending");
await api("POST", `/sites/${other.data.siteId}/domains/${old}/refresh`);
localD1(`UPDATE domains SET created_at = '2000-01-01T00:00:00.000Z', checked_at = '2000-01-01T00:00:00.000Z' WHERE hostname = '${old}'`);
await mock(old, "activate");
await cron();
const recovered = await settle(async () => localD1(`SELECT status FROM domains WHERE hostname = '${old}'`)[0]?.status === "active");
check("한 번 활성이던 도메인은 오래돼도 계속 확인해 자동 복구", recovered);
await api("DELETE", `/sites/${other.data.siteId}/domains/${old}`);

// 5e. a refresh never revives a row being removed
localD1(`UPDATE domains SET status = 'removing' WHERE hostname = '${custom}'`);
const fenced = await api("POST", `/sites/${siteId}/domains/${custom}/refresh`);
check("removing 행은 새로고침으로 되살아나지 않음", fenced.data.status === "removing" && localD1(`SELECT status FROM domains WHERE hostname = '${custom}'`)[0].status === "removing");
localD1(`UPDATE domains SET status = 'active' WHERE hostname = '${custom}'`);

// 5f. the hourly origin audit flags a live version rendered for another origin
localD1(`UPDATE site_versions SET rendered_origin = 'stale' WHERE id = (SELECT published_version_id FROM sites WHERE id = '${siteId}')`);
await fetch(`${API}/__scheduled?cron=17+*+*+*+*`);
const healedOrigin = await settle(async () =>
  localD1(`SELECT v.rendered_origin AS o FROM sites s JOIN site_versions v ON v.id = s.published_version_id WHERE s.id = '${siteId}'`)[0].o.includes(custom),
);
check("매시간 origin 점검이 틀린 렌더를 찾아 다시 렌더", healedOrigin);

// 5g. an orphan host record (no domain row) is removed by the hourly audit
const orphan = `orphan-${run}.example.com`;
localKv("put", `host:${orphan}`, JSON.stringify({ siteId: other.data.siteId, status: "active", pointer: null, redirectTo: null }));
await fetch(`${API}/__scheduled?cron=17+*+*+*+*`);
const orphanGone = await settle(async () => localKv("get", `host:${orphan}`) === "");
check("도메인 행 없는 고아 KV 레코드는 매시간 점검이 삭제", orphanGone);

// 5h. removal during a Cloudflare outage: routing falls back at once via the cron, removal
// completes when Cloudflare is back
const outageHost = `outage-${run}.example.com`;
await api("POST", `/sites/${other.data.siteId}/domains`, { hostname: outageHost });
await mock(outageHost, "activate");
await api("POST", `/sites/${other.data.siteId}/domains/${outageHost}/refresh`);
const sub2 = `dom2-${run}.localhost`;
const redirectedFirst = (await routerRequest(sub2, "/")).status === 301;
await fetch(`${CF_MOCK}/__mock/outage?on=1`, { method: "POST" });
const failedRemoval = await api("DELETE", `/sites/${other.data.siteId}/domains/${outageHost}`);
await cron();
const fallback = await settle(async () => (await routerRequest(sub2, "/")).status === 200);
check("Cloudflare 장애 중 삭제: 요청은 실패해도 cron이 서브도메인으로 즉시 복귀", redirectedFirst && failedRemoval.status >= 500 && fallback && (await routerRequest(outageHost, "/")).status === 404);
await fetch(`${CF_MOCK}/__mock/outage?on=0`, { method: "POST" });
await cron();
const completed = await settle(async () => localD1(`SELECT COUNT(*) AS n FROM domains WHERE hostname = '${outageHost}'`)[0].n === 0);
check("Cloudflare 복구 후 cron이 삭제 마무리", completed);

// 5c. a removal interrupted after the row was marked finishes on the next cron
localD1(`UPDATE domains SET status = 'removing' WHERE hostname = '${extra}'`);
await cron();
const finished = await settle(async () => localD1(`SELECT COUNT(*) AS n FROM domains WHERE hostname = '${extra}'`)[0].n === 0);
check("중단된 삭제는 cron이 마무리(행·KV 정리)", finished && localKv("get", `host:${extra}`).length === 0);

// 6. removal restores the subdomain and stops billing
const removed = await api("DELETE", `/sites/${siteId}/domains/${custom}`);
await api("DELETE", `/sites/${siteId}/domains/${apex.data.hostname}`);
const quota2 = (await api("GET", "/domains/quota")).data;
let back;
await settle(async () => (back = await routerRequest(sub, "/")).status === 200);
check("삭제: 커스텀 404, 서브도메인 다시 200·canonical 복귀", removed.status === 200 && (await routerRequest(custom, "/")).status === 404 && back.status === 200 && back.body.includes(`href="http://${sub}/"`));
check("삭제하면 Cloudflare 호스트네임도 삭제(quota 원복)", Number.isInteger(quota2.used) && quota2.used === quota0.used, quota2);
check("없는 도메인 삭제 404", (await api("DELETE", `/sites/${siteId}/domains/${custom}`)).status === 404);

ev.finish({ siteId, custom });
