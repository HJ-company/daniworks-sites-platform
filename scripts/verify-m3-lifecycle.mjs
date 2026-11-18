// M3 step 3-4: cancellation and data export. The exported zip must work as a standalone site
// elsewhere; cancellation stops serving and billing; purge is gated by retention and the slug.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { readFile } from "node:fs/promises";
import { API, TOKEN, api, chromium, evidence, localD1, localKv, routerRequest, uploadShared } from "./lib/verify.mjs";

const { unzipSync } = createRequire(new URL("../apps/api/package.json", import.meta.url))("fflate");
const sharp = createRequire(new URL("../packages/renderer/package.json", import.meta.url))("sharp");
const { fieldFixture } = await import("../packages/renderer/src/templates/service-local/fixtures.ts");
const CF_MOCK = process.env.CF_MOCK_URL ?? "http://127.0.0.1:8790";
const CONSOLE = process.env.CONSOLE_URL ?? "http://127.0.0.1:8789";
const ev = evidence("m3-lifecycle");
const { check } = ev;
const run = Date.now().toString(36);

uploadShared();
const config = { ...structuredClone(fieldFixture), slug: `life-${run}` };
config.business.blogUrl = "https://blog.naver.com/fixtureblog";
const host = `${config.slug}.localhost`;
const custom = `www.life-${run}.co.kr`;
const created = await api("POST", "/sites", { config, createdBy: "operator" });
const siteId = created.data.siteId;

// A real-looking site: an uploaded hero photo, a custom domain, an inquiry, metrics.
const photo = await sharp({ create: { width: 1200, height: 800, channels: 3, background: "#58a" } }).jpeg().toBuffer();
const uploaded = (await fetch(`${API}/sites/${siteId}/assets`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "image/jpeg" }, body: photo }).then((r) => r.json()));
const v2 = structuredClone(config);
v2.content.hero.image = { key: uploaded.key, alt: "현장", width: uploaded.width, height: uploaded.height };
const draft = await api("POST", `/sites/${siteId}/versions`, { config: v2 });
await api("POST", `/sites/${siteId}/publish`, { versionId: draft.data.versionId });
await api("POST", `/sites/${siteId}/domains`, { hostname: custom });
await fetch(`${CF_MOCK}/__mock/${custom}/activate`, { method: "POST" });
await api("POST", `/sites/${siteId}/domains/${custom}/refresh`);
await routerRequest(custom, "/api/inquiry", {
  method: "POST",
  body: JSON.stringify({ name: "인출 시험", phone: "010-3333-4444", message: "보관 확인", consent: true, elapsedMs: 5000, turnstileToken: "XXXX.DUMMY.TOKEN.XXXX" }),
  headers: { "content-type": "application/json", "cf-connecting-ip": "198.51.100.9" },
});
localD1(`INSERT INTO metrics_daily (site_id, date, event, count) VALUES ('${siteId}', '2026-11-01', 'pageview', 7)`);
check("준비: 커스텀 도메인에서 서빙", (await routerRequest(custom, "/")).status === 200);

// A photo used only by a draft must still be exported.
const draftOnly = await sharp({ create: { width: 640, height: 480, channels: 3, background: "#a63" } }).jpeg().toBuffer();
const draftPhoto = await fetch(`${API}/sites/${siteId}/assets`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "image/jpeg" }, body: draftOnly }).then((r) => r.json());

// 1. export
const zipRes = await fetch(`${API}/sites/${siteId}/export.zip`, { headers: { authorization: `Bearer ${TOKEN}` } });
const zip = unzipSync(new Uint8Array(await zipRes.arrayBuffer()));
const names = Object.keys(zip);
const text = (name) => new TextDecoder().decode(zip[name]);
check("zip: 페이지 2개, 클라이언트 번들·청크, CSS", zipRes.ok && names.includes("site/index.html") && names.includes("site/privacy/index.html") &&
  names.some((n) => n.endsWith("/_assets/client.js")) && names.some((n) => n.includes("/_assets/chunks/")) && names.some((n) => n.endsWith("/_assets/site.css")));
check("zip: 업로드 사진과 쓰인 변형만", names.includes(`site/_media/${siteId}/${uploaded.key.split("/")[1]}`) && names.some((n) => n.endsWith(".w800.webp")) &&
  !names.some((n) => n.includes("site-templates/pine-interior.jpg")));
check("zip: 공개 페이지에 안 쓰인 업로드 사진도 포함", names.includes(`site/_media/${siteId}/${draftPhoto.key.split("/")[1]}`));
check("zip: 데이터(버전 2개, 문의, 통계, README)", JSON.parse(text("data/versions.json")).length === 2 && text("data/inquiries.csv").includes("인출 시험") &&
  text("data/metrics.csv").includes("2026-11-01,pageview,7") && text("README.txt").includes("site/"));

// The exported folder works as a site on another server.
const root = mkdtempSync(join(tmpdir(), "export-"));
for (const [name, bytes] of Object.entries(zip)) {
  if (!name.startsWith("site/")) continue;
  const path = join(root, name.slice(5));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
}
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".jpg": "image/jpeg", ".webp": "image/webp", ".png": "image/png" };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  let path = join(root, decodeURIComponent(url.pathname));
  if (url.pathname.endsWith("/")) path = join(path, "index.html");
  try {
    const body = await readFile(path);
    res.writeHead(200, { "content-type": types[extname(path)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(8799, "127.0.0.1", r));
const browser = await chromium().launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const failed = [];
page.on("requestfailed", (r) => failed.push(r.url()));
page.on("response", (r) => r.status() >= 400 && !r.url().includes("/api/track") && failed.push(`${r.status()} ${r.url()}`));
await page.goto("http://127.0.0.1:8799/", { waitUntil: "networkidle" });
const state = await page.evaluate(() => ({
  hydrated: Object.keys(document.getElementById("root") ?? {}).some((k) => k.startsWith("__reactContainer")),
  styled: getComputedStyle(document.body).fontFamily.length > 0 && document.styleSheets.length > 0,
  images: [...document.images].filter((i) => i.complete && i.naturalWidth > 0).length,
}));
await page.screenshot({ path: `${ev.dir}/exported-site.png` });
check("내보낸 폴더를 다른 서버에 올려도 열림(스타일, 사진, 하이드레이션)", state.hydrated && state.styled && state.images >= 1 && !failed.length, { ...state, failed });
server.close();

// 2. cancel
const cancelled = await api("POST", `/sites/${siteId}/cancel`);
check("해지: 커스텀 도메인 Cloudflare에서 삭제", cancelled.status === 200 && cancelled.data.domains[0]?.removed === true);
check("해지: 기본 주소 410", (await routerRequest(host, "/")).status === 410);
check("해지: 커스텀 도메인 더 이상 서빙 안 함", (await routerRequest(custom, "/")).status === 404);
check("해지: 문의 받지 않음", (await routerRequest(host, "/api/inquiry", { method: "POST", body: "{}", headers: { "content-type": "application/json" } })).status === 404);
check("해지 상태에서 게시·정지 해제 거부(409)", (await api("POST", `/sites/${siteId}/publish`)).status === 409 && (await api("POST", `/sites/${siteId}/resume`)).status === 409);
check("두 번 해지는 409", (await api("POST", `/sites/${siteId}/cancel`)).status === 409);
const quotaBefore = (await api("GET", "/domains/quota")).data.used;
check("해지된 사이트에 사진 업로드·재게시 스테이지 거부(409)",
  (await fetch(`${API}/sites/${siteId}/assets`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "image/jpeg" }, body: photo })).status === 409 &&
  (await api("POST", `/sites/${siteId}/republish/stage`)).status === 409);
check("해지된 사이트에 도메인 연결 거부, Cloudflare 호스트네임 안 남음", (await api("POST", `/sites/${siteId}/domains`, { hostname: `x.life-${run}.co.kr` })).status === 409 &&
  (await api("GET", "/domains/quota")).data.used === quotaBefore);
const due = (await api("GET", "/cancellations")).data.cancellations.find((c) => c.id === siteId);
check("해지 목록: 보관 기한(90일)과 아직 삭제 불가", due && !due.purgeable && Date.parse(due.purgeAfter) - Date.parse(due.cancelled_at) === 90 * 86_400_000);
check("보관 기간 전 완전 삭제는 409", (await api("POST", `/sites/${siteId}/purge`, { confirmSlug: config.slug })).status === 409);
check("데이터는 보관됨(문의·내보내기)", (await api("GET", `/sites/${siteId}/inquiries`)).data.inquiries.length === 1 &&
  (await fetch(`${API}/sites/${siteId}/export.zip`, { headers: { authorization: `Bearer ${TOKEN}` } })).ok);

// 3. reactivate, then cancel again and purge after retention
check("해지하면 블로그 피드 중단", localD1(`SELECT COUNT(*) AS n FROM blog_feeds WHERE site_id = '${siteId}'`)[0].n === 0);
check("해지 취소 → 다시 200", (await api("POST", `/sites/${siteId}/reactivate`)).status === 200 && (await routerRequest(host, "/")).status === 200);
check("해지 취소하면 블로그 피드 복구", localD1(`SELECT blog_url FROM blog_feeds WHERE site_id = '${siteId}'`)[0]?.blog_url === "https://blog.naver.com/fixtureblog");

// Cancellation during a Cloudflare outage: domains stay marked and the cron finishes them.
const outageDomain = `www.life-out-${run}.co.kr`;
await api("POST", `/sites/${siteId}/domains`, { hostname: outageDomain });
await fetch(`${CF_MOCK}/__mock/${outageDomain}/activate`, { method: "POST" });
await api("POST", `/sites/${siteId}/domains/${outageDomain}/refresh`);
await fetch(`${CF_MOCK}/__mock/outage?on=1`, { method: "POST" });
const duringOutage = await api("POST", `/sites/${siteId}/cancel`);
check("Cloudflare 장애 중 해지: 해지는 되고 도메인은 removing으로 남음", duringOutage.status === 200 && duringOutage.data.domains[0]?.removed === false &&
  localD1(`SELECT status FROM domains WHERE hostname = '${outageDomain}'`)[0]?.status === "removing" && (await routerRequest(host, "/")).status === 410);
await fetch(`${CF_MOCK}/__mock/outage?on=0`, { method: "POST" });
await fetch(`${API}/__scheduled?cron=*/5+*+*+*+*`);
let finished = false;
for (let i = 0; i < 40 && !finished; i++) {
  finished = localD1(`SELECT COUNT(*) AS n FROM domains WHERE hostname = '${outageDomain}'`)[0].n === 0;
  if (!finished) await new Promise((r) => setTimeout(r, 250));
}
check("Cloudflare 복구 후 cron이 도메인 삭제 마무리", finished);
await api("POST", `/sites/${siteId}/reactivate`);
await api("POST", `/sites/${siteId}/cancel`);
localD1(`UPDATE sites SET cancelled_at = '2000-01-01T00:00:00.000Z' WHERE id = '${siteId}'`);
// A custom domain still being removed blocks purge without claiming it (cleanup stays possible).
localD1(`INSERT INTO domains (hostname, site_id, kind, status, created_at) VALUES ('pending-${run}.example.com', '${siteId}', 'custom', 'removing', '2026-01-01')`);
const blocked = await api("POST", `/sites/${siteId}/purge`, { confirmSlug: config.slug });
check("삭제 대기 도메인이 있으면 409, 삭제 상태도 잡지 않음", blocked.status === 409 && localD1(`SELECT purging_at FROM sites WHERE id = '${siteId}'`)[0].purging_at === null);
localD1(`DELETE FROM domains WHERE hostname = 'pending-${run}.example.com'`);
check("확인 slug가 다르면 422", (await api("POST", `/sites/${siteId}/purge`, { confirmSlug: "wrong" })).status === 422);
// Purge state wins over reactivation.
localD1(`UPDATE sites SET purging_at = '2026-01-01T00:00:00.000Z' WHERE id = '${siteId}'`);
check("삭제가 시작된 사이트는 해지 취소 거부(409)", (await api("POST", `/sites/${siteId}/reactivate`)).status === 409);
// An interrupted purge (child rows gone, site row left) resumes with the same request.
localD1(`DELETE FROM inquiries WHERE site_id = '${siteId}'`);
const purged = await api("POST", `/sites/${siteId}/purge`, { confirmSlug: config.slug });
const left = ["inquiries", "metrics_daily", "assets", "domains", "site_versions", "sites"].map(
  (t) => localD1(`SELECT COUNT(*) AS n FROM ${t} WHERE ${t === "sites" ? "id" : "site_id"} = '${siteId}'`)[0].n,
);
check("완전 삭제: R2 파일·D1 행 모두 삭제", purged.status === 200 && purged.data.objectsDeleted > 0 && left.every((n) => n === 0), { left, objects: purged.data.objectsDeleted });
check("완전 삭제: KV 정리, 주소 404, API 404", localKv("get", `host:${host}`) === "" && localKv("get", `site:${siteId}`) === "" &&
  (await routerRequest(host, "/")).status === 404 && (await api("GET", `/sites/${siteId}`)).status === 404);

// 4. console: cancel needs the slug typed
const other = await api("POST", "/sites", { config: { ...structuredClone(fieldFixture), slug: `life2-${run}` }, createdBy: "operator" });
const tab = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await tab.goto(`${CONSOLE}/sites/${other.data.siteId}`, { waitUntil: "networkidle" });
await tab.getByRole("button", { name: "해지", exact: true }).click();
const confirm = tab.getByRole("dialog").getByRole("button", { name: "해지" });
const disabledFirst = await confirm.isDisabled();
await tab.locator("input[name=confirmSlug]").fill(`life2-${run}`);
await confirm.click();
await tab.getByText("해지했습니다").first().waitFor({ timeout: 10000 });
check("콘솔 해지: slug를 입력해야 버튼 활성, 해지 후 410", disabledFirst && (await routerRequest(`life2-${run}.localhost`, "/")).status === 410);
await browser.close();

ev.finish({ siteId });
