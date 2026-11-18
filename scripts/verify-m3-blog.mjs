// M3 step 3-1: latest blog posts. Publish caches nothing; the cron (or refresh) fetches the RSS
// into KV and the router fills the section at request time, without republishing.
import { API, ROUTER_PORT, api, chromium, evidence, localD1, routerRequest, uploadShared, viewports } from "./lib/verify.mjs";

const { lessonFixture } = await import("../packages/renderer/src/templates/service-local/fixtures.ts");
const ev = evidence("m3-blog");
const { check } = ev;
const run = Date.now().toString(36);
const settle = async (predicate, tries = 40) => {
  for (let i = 0; i < tries; i++) {
    if (await predicate()) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
};

uploadShared();
const config = structuredClone(lessonFixture);
config.slug = `blog-${run}`;
config.business.blogUrl = "https://blog.naver.com/fixtureblog";
const host = `${config.slug}.localhost`;
const created = await api("POST", "/sites", { config, createdBy: "operator" });
const siteId = created.data.siteId;
await api("POST", `/sites/${siteId}/publish`);

// 1. before the first fetch: the section is there, empty
const before = await routerRequest(host, "/");
check("게시 직후: 블로그 섹션(주소 식별자 포함)은 있고 글은 아직 없음", before.body.includes('data-blog-feed="https://blog.naver.com/fixtureblog"') && !before.body.includes("sites-blog-card"));
check("피드 행이 생기고 수집 대기", localD1(`SELECT fetched_at FROM blog_feeds WHERE site_id = '${siteId}'`)[0]?.fetched_at === null);

// 2. the cron fetches it; the router fills the section
await fetch(`${API}/__scheduled?cron=*/5+*+*+*+*`);
await settle(() => localD1(`SELECT status FROM blog_feeds WHERE site_id = '${siteId}'`)[0]?.status === "ok");
let page;
await settle(async () => (page = await routerRequest(host, "/")).body.includes("sites-blog-card"));
const cards = (page.body.match(/sites-blog-card/g) ?? []).length;
check("cron 수집 후 최신 글 3개가 HTML에 들어감(재게시 없이)", cards === 3 && page.headers["x-site-version"] === "1", { cards });
check("글 링크·날짜·이스케이프(& → &amp;)", page.body.includes('href="https://blog.naver.com/fixtureblog/101"') && page.body.includes("2026.11.19") && page.body.includes("fixtureblog 글 1 &amp; 소식"));
check("블로그 HTML이 바뀌므로 ETag 없음", !page.headers.etag);
check("개인정보처리방침 페이지는 그대로(재작성 없음)", (await routerRequest(host, "/privacy")).body.includes("개인정보처리방침") && !(await routerRequest(host, "/privacy")).body.includes("data-blog-feed"));

// 3. browser: hydration keeps the injected cards; Naver images are requested without a Referer
const browser = await chromium().launch();
const context = await browser.newContext({ viewport: viewports.mobile });
const imageRequests = [];
await context.route("https://blogthumb.pstatic.net/**", async (route) => {
  imageRequests.push(route.request().headers()["referer"] ?? null);
  await route.fulfill({ status: 200, contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="365" height="365"><rect width="100%" height="100%" fill="#8a8"/></svg>' });
});
const tab = await context.newPage();
const errors = [];
tab.on("pageerror", (e) => errors.push(String(e)));
tab.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await tab.goto(`http://${host}:${ROUTER_PORT}/`, { waitUntil: "networkidle" });
await tab.locator("#blog").scrollIntoViewIfNeeded();
await tab.waitForTimeout(800);
const visibleCards = await tab.locator(".sites-blog-card").count();
const hydrated = await tab.evaluate(() => Object.keys(document.getElementById("root") ?? {}).some((k) => k.startsWith("__reactContainer")));
await tab.screenshot({ path: `${ev.dir}/blog-mobile.png`, fullPage: true });
check("하이드레이션 후에도 카드 3개 유지, 오류 없음", hydrated && visibleCards === 3 && !errors.length, { visibleCards, errors });
check("네이버 이미지 요청에 Referer 없음", imageRequests.length >= 1 && imageRequests.every((r) => r === null), { imageRequests });
await browser.close();

// 4. failures keep the previous cache; removing the blog clears it
localD1(`UPDATE blog_feeds SET blog_url = 'https://blog.naver.com/missing' WHERE site_id = '${siteId}'`);
const failed = await api("POST", `/sites/${siteId}/blog/refresh`);
const stillCards = ((await routerRequest(host, "/")).body.match(/sites-blog-card/g) ?? []).length;
// The page and the cache still name the same blog, so a failed fetch keeps its posts.
check("RSS 실패 시 오류 기록, 같은 블로그의 이전 글은 유지", failed.data.status === "error" && stillCards === 3, failed.data);
localD1(`UPDATE blog_feeds SET blog_url = 'https://blog.naver.com/fixtureblog' WHERE site_id = '${siteId}'`);

// Changing the blog drops the previous blog's posts at once (even if the new feed fails).
const otherBlog = structuredClone(config);
otherBlog.business.blogUrl = "https://blog.naver.com/missing";
const vOther = await api("POST", `/sites/${siteId}/versions`, { config: otherBlog });
await api("POST", `/sites/${siteId}/publish`, { versionId: vOther.data.versionId });
await api("POST", `/sites/${siteId}/blog/refresh`);
const switched = await routerRequest(host, "/");
check("블로그 주소를 바꾸면 이전 블로그 글은 즉시 사라짐(새 피드 실패해도)", switched.body.includes("data-blog-feed") && !switched.body.includes("sites-blog-card"));
const noBlog = structuredClone(config);
delete noBlog.business.blogUrl;
const v2 = await api("POST", `/sites/${siteId}/versions`, { config: noBlog });
await api("POST", `/sites/${siteId}/publish`, { versionId: v2.data.versionId });
const after = await routerRequest(host, "/");
check("블로그 주소를 빼고 게시하면 섹션·피드 행·캐시 제거", !after.body.includes("data-blog-feed") && localD1(`SELECT COUNT(*) AS n FROM blog_feeds WHERE site_id = '${siteId}'`)[0].n === 0);
check("블로그 없는 사이트는 새로고침 404", (await api("POST", `/sites/${siteId}/blog/refresh`)).status === 404);

// 5. live smoke (optional): the real Naver RSS parses
if (process.env.LIVE === "1") {
  const { parseNaverRss } = await import("../packages/renderer/src/platform/blog.ts");
  const xml = await (await fetch("https://rss.blog.naver.com/jefes_fc.xml")).text();
  const posts = parseNaverRss(xml);
  check("실제 네이버 RSS 파싱(LIVE)", posts.length === 3 && posts.every((p) => p.link.startsWith("https://blog.naver.com/")), { titles: posts.map((p) => p.title) });
}

ev.finish({ siteId });
