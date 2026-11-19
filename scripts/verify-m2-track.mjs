// M2 step 2-6: pageview and click measurement. Browser beacons → router → api RPC → D1 daily
// counters → report API. Bots, previews, bad events and suspended sites are not counted.
import { API, ROUTER_PORT, api, chromium, evidence, routerRequest, uploadShared, paySite } from "./lib/verify.mjs";

const { fieldFixture } = await import("../packages/renderer/src/templates/service-local/fixtures.ts");
const ev = evidence("m2-track");
const { check } = ev;
const run = Date.now().toString(36);
const MOBILE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

uploadShared();
const config = structuredClone(fieldFixture);
config.slug = `track-${run}`;
config.business.mapUrl = "https://naver.me/example";
config.business.bookingUrl = "https://m.booking.naver.com/booking/example";
const host = `${config.slug}.localhost`;
const created = await api("POST", "/sites", { config, createdBy: "operator" });
const siteId = created.data.siteId;
await paySite(siteId);
await api("POST", `/sites/${siteId}/publish`);
const totals = async () => (await api("GET", `/sites/${siteId}/metrics`)).data.totals;
const settle = () => new Promise((r) => setTimeout(r, 800));

const browser = await chromium().launch();
async function open(url, userAgent) {
  const context = await browser.newContext({ userAgent, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  // Keep external destinations offline and swallow popups.
  await context.route(/^https:\/\/(?!.*localhost)/, (route) => route.abort());
  const page = await context.newPage();
  page.on("popup", (popup) => popup.close().catch(() => undefined));
  await page.goto(url, { waitUntil: "networkidle" });
  return { context, page };
}

// 1. a person on a phone: one pageview, then each tracked link once
const person = await open(`http://${host}:${ROUTER_PORT}/`, MOBILE_SAFARI);
const bar = person.page.locator(".sites-contact-bar");
for (const label of ["카톡", "예약", "견적 문의"]) await bar.getByText(label, { exact: true }).click();
// tel: would leave the page; the beacon is sent in capture phase before navigation.
await person.page.evaluate(() => {
  const link = document.querySelector('.sites-contact-bar a[href^="tel:"]');
  link?.addEventListener("click", (e) => e.preventDefault(), { once: true });
  link?.click();
});
await person.page.locator("#info a", { hasText: "지도 보기" }).click();
await settle();
const counted = await totals();
check(
  "사람 방문 1회와 클릭 5종이 각 1씩 집계",
  counted.pageview === 1 && counted.tel === 1 && counted.kakao === 1 && counted.booking === 1 && counted.map === 1 && counted.inquiry_cta === 1,
  counted,
);
await person.context.close();

// 2. not counted: headless browser, preview, bad payloads, GET
const bot = await open(`http://${host}:${ROUTER_PORT}/`, undefined);
await bot.context.close();
const versions = (await api("GET", `/sites/${siteId}`)).data.versions;
const preview = await open(`${API}/preview/${versions[0].preview_token}`, MOBILE_SAFARI);
await preview.page.locator(".sites-contact-bar").getByText("견적 문의", { exact: true }).click();
await preview.context.close();
const beacon = (body, ua = MOBILE_SAFARI) =>
  routerRequest(host, "/api/track", { method: "POST", body, headers: { "content-type": "text/plain", "user-agent": ua } });
const responses = [
  await beacon(JSON.stringify({ event: "inquiry" })), // server-only event
  await beacon(JSON.stringify({ event: "nope" })),
  await beacon("not json"),
  await beacon("x".repeat(2000)),
  await beacon(JSON.stringify({ event: "pageview" }), "Mozilla/5.0 (compatible; Yeti/1.1; +https://naver.me/spd)"),
];
check("잘못된 이벤트·봇 비콘도 204로 답함", responses.every((r) => r.status === 204), { statuses: responses.map((r) => r.status) });
check("GET은 405", (await routerRequest(host, "/api/track")).status === 405);
await settle();
const after = await totals();
check("headless·프리뷰·잘못된 요청은 집계 안 됨", JSON.stringify(after) === JSON.stringify(counted), { after });

// 3. valid beacon counts; suspended site does not
await beacon(JSON.stringify({ event: "pageview", page: "/" }));
await settle();
check("직접 보낸 유효 비콘은 집계", (await totals()).pageview === 2);
await api("POST", `/sites/${siteId}/suspend`);
await beacon(JSON.stringify({ event: "pageview" }));
await settle();
check("정지된 사이트는 집계 안 됨", (await totals()).pageview === 2);
await api("POST", `/sites/${siteId}/resume`);

// 4. report API shape and validation
const report = (await api("GET", `/sites/${siteId}/metrics`)).data;
check("리포트: 기간, 합계, 일별 행", /^\d{4}-\d{2}-\d{2}$/.test(report.from) && report.daily.length >= 6 && report.totals.pageview === 2);
check("날짜 형식 오류는 400", (await api("GET", `/sites/${siteId}/metrics?from=yesterday`)).status === 400);

await browser.close();
ev.finish({ siteId, totals: await totals() });
