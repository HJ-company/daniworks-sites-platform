// M4 step 4-A: code aligned with the PRD. Suspended sites show only the business name (503,
// Retry-After, no contact details), and the console fixes from the first product-owner test
// (business names, unpublished state, domain guide, plain-language cancel and suspend dialogs).
import { api, chromium, evidence, localD1, localKv, routerRequest, uploadShared, paySite, consoleLogin, CONSOLE } from "./lib/verify.mjs";


const { fieldFixture } = await import("../packages/renderer/src/templates/service-local/fixtures.ts");
const ev = evidence("m4-alignment");
const { check } = ev;
const run = Date.now().toString(36);

uploadShared();

// 1. suspended page
const config = structuredClone(fieldFixture);
config.slug = `align-${run}`;
config.business.name = "상쾌공간 & 청소 <본점>";
const host = `${config.slug}.localhost`;
const created = await api("POST", "/sites", { config, createdBy: "operator" });
const siteId = created.data.siteId;
await paySite(siteId);
await api("POST", `/sites/${siteId}/publish`);
check("게시 후 호스트 레코드에 업체명", JSON.parse(localKv("get", `host:${host}`)).name === config.business.name);

await api("POST", `/sites/${siteId}/suspend`);
const down = await routerRequest(host, "/");
check("중단: 503 + Retry-After + noindex + 캐시 안 함", down.status === 503 && down.headers["retry-after"] === "86400" && down.body.includes("noindex") && down.headers["cache-control"] === "no-store");
check("중단 페이지: 업체명(이스케이프)과 준비 중 안내", down.body.includes("상쾌공간 &amp; 청소 &lt;본점&gt;") && down.body.includes("준비하고 있습니다") && !down.body.includes("<본점>"));
check(
  "중단 페이지: 연락처·주소·문의 폼·연체 문구 없음",
  !down.body.includes(config.business.phone) && !down.body.includes("tel:") && !down.body.includes("<form") && !/연체|미납|결제|정지/.test(down.body),
);
const sub = await routerRequest(host, "/privacy");
check("중단: 하위 페이지도 같은 안내", sub.status === 503 && sub.body.includes("준비하고 있습니다"));

// A record written before M4 has no name: generic notice, still 503.
const legacy = { ...JSON.parse(localKv("get", `host:${host}`)) };
delete legacy.name;
localKv("put", `host:${host}`, JSON.stringify(legacy));
const generic = await routerRequest(host, "/");
check("업체명 없는 옛 레코드: 일반 안내 503", generic.status === 503 && generic.body.includes("홈페이지 준비 중"));

await api("POST", `/sites/${siteId}/resume`);
check("재개: 다시 200", (await routerRequest(host, "/")).status === 200);

// 2. console fixes from the product owner's first smoke test
const draftConfig = structuredClone(fieldFixture);
draftConfig.slug = `align-draft-${run}`;
draftConfig.business.name = `미공개청소${run}`;
const draftSite = (await api("POST", "/sites", { config: draftConfig, createdBy: "operator" })).data.siteId;
const listed = (await api("GET", "/sites")).data.sites;
check("API 목록·상세에 상호", listed.find((s) => s.id === siteId)?.business_name === config.business.name &&
  (await api("GET", `/sites/${draftSite}`)).data.site.business_name === draftConfig.business.name);

const browser = await chromium().launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] });
const page = await context.newPage();
await consoleLogin(page);
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const shot = (name) => page.screenshot({ path: `${ev.dir}/${name}.png`, fullPage: true });
const visible = (locator) => locator.first().waitFor({ timeout: 10000 }).then(() => true).catch(() => false);

await page.goto(CONSOLE, { waitUntil: "networkidle" });
await page.getByRole("searchbox", { name: "사이트 검색" }).fill(`미공개청소${run}`);
check("목록: 상호로 검색, 상호와 slug 표시", await visible(page.getByTestId(`site-link-${draftConfig.slug}`).filter({ hasText: draftConfig.business.name })) &&
  (await page.getByTestId(`site-link-${config.slug}`).count()) === 0);
await shot("list-search");
await page.getByTestId(`site-link-${draftConfig.slug}`).click();
check("상세 제목은 상호, 한 번도 공개 안 한 사이트는 미공개·정지 버튼 없음",
  (await page.getByTestId("site-title").textContent()) === draftConfig.business.name &&
    (await visible(page.getByText("미공개", { exact: true }))) &&
    (await page.getByRole("button", { name: "공개 정지" }).count()) === 0);

await page.getByRole("button", { name: "해지", exact: true }).click();
const cancelText = await page.getByRole("dialog").textContent();
check("해지 창: 쉬운 말, 1년 보관·취소 가능·이후 삭제 안내, 기술 용어 없음",
  cancelText.includes("1년 동안 보관") && cancelText.includes("해지를 취소") && cancelText.includes("1년이 지나면") && !cancelText.includes("410"));
await shot("cancel-dialog");
await page.getByRole("button", { name: "닫기" }).click();

// Domain guide: record, copy buttons, customer message, Korean error.
const custom = `www.align-${run}.co.kr`;
await api("POST", `/sites/${siteId}/domains`, { hostname: custom });
localD1(`UPDATE domains SET last_error = 'custom hostname does not CNAME to this zone.' WHERE hostname = '${custom}'`);
await page.goto(`${CONSOLE}/sites/${siteId}/domains`, { waitUntil: "networkidle" });
const card = page.getByTestId(`domain-${custom}`);
check("도메인 카드: 이름 칸은 www, 값 connect.dsites.kr, 반영 시간 안내", await visible(card.getByText("connect.dsites.kr")) &&
  (await card.textContent()).includes("www") && (await card.textContent()).includes("길면 하루"));
check("도메인 오류를 한국어로", (await card.getByTestId("domain-error").textContent()).includes("CNAME이 설정되지 않았거나"));
await card.getByRole("button", { name: "사장님께 보낼 안내문 복사" }).click();
const copied = await page.evaluate(() => navigator.clipboard.readText());
check("안내문 복사: 유형·이름·값·루트 포워딩", copied.includes("· 이름(호스트): www") && copied.includes("· 값: connect.dsites.kr") &&
  copied.includes(`align-${run}.co.kr → https://${custom}`), { copied });
check("복사 알림이 글자와 함께 표시", await visible(page.getByText("사장님께 보낼 안내문을 복사했습니다")));
await shot("domain-guide");
await api("DELETE", `/sites/${siteId}/domains/${encodeURIComponent(custom)}`);

// Suspending asks first.
await page.goto(`${CONSOLE}/sites/${siteId}`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "공개 정지" }).click();
check("공개 정지는 확인 창을 거침", await visible(page.getByRole("dialog").getByText("준비 중")) && (await routerRequest(host, "/")).status === 200);
await page.getByRole("dialog").getByRole("button", { name: "닫기" }).click();
check("콘솔 페이지 오류 없음", !errors.length, { errors });
await browser.close();

ev.finish();
