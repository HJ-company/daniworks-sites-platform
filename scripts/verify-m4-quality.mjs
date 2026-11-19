// M4 quality loop, round 1: what the scorecard's first measurements and the operator-day test
// asked for. Public pages paint without a CSS request; the console's first screen gathers the
// day's work; suspensions carry who and why; placeholders say where they are; sites without a
// customer are flagged with a suggestion; drafts and domain guides can be read before copying.
import { api, chromium, consoleLogin, CONSOLE, evidence, paySite, routerRequest, uploadShared } from "./lib/verify.mjs";

const { fieldFixture } = await import("../packages/renderer/src/templates/service-local/fixtures.ts");
const ev = evidence("m4-quality/verify");
const { check } = ev;
const run = Date.now().toString(36);
const digits = String(Date.now()).slice(-8);
uploadShared();

const make = async (name, mutate = () => {}) => {
  const config = { ...structuredClone(fieldFixture), slug: `q${name}-${run}` };
  config.business.name = `품질${name} ${run}`;
  mutate(config);
  const siteId = (await api("POST", "/sites", { config, createdBy: "operator" })).data.siteId;
  return { siteId, config };
};

// 1. public pages: stylesheet inlined, favicon declared, descriptive privacy link
const live = await make("live");
await paySite(live.siteId);
await api("POST", `/sites/${live.siteId}/publish`);
const home = await routerRequest(`${live.config.slug}.localhost`, "/");
check("공개 페이지: CSS를 페이지에 넣고 site.css 요청 없음", home.status === 200 && /<style>\/\*! tailwindcss[^]{1000,}?<\/style>/.test(home.body) && !home.body.includes("site.css"));
check("공개 페이지: favicon 선언(404 콘솔 오류 없음)", home.body.includes('<link rel="icon" href="data:,">'));
check("문의 동의 링크 문구가 무엇인지 말함", home.body.includes("개인정보처리방침 보기") && !/>\s*자세히\s*</.test(home.body));
const draft = (await api("POST", `/sites/${live.siteId}/draft-link`)).data.draftLink.url;
const draftPage = await routerRequest("localhost", new URL(draft).pathname);
check("시안 링크도 CSS를 페이지에", /<style>\/\*! tailwindcss[^]{1000,}?<\/style>/.test(draftPage.body));

// 2. version previews on the api host say they are internal
const versions = (await api("GET", `/sites/${live.siteId}`)).data.versions;
const internal = await fetch(versions[0].preview_url);
check("내부 미리보기에 '내부 검수용' 띠", (await internal.text()).includes("내부 검수용 미리보기"));

// 3. suspension with a reason: who, when, why on the site and in today's list
await api("POST", `/sites/${live.siteId}/suspend`, { reason: "사장님 요청으로 리뉴얼 중" });
let site = (await api("GET", `/sites/${live.siteId}`)).data.site;
check("정지 사유·정지한 사람이 상세에", site.last_suspension?.reason === "사장님 요청으로 리뉴얼 중" && Boolean(site.last_suspension?.actor_name ?? site.last_suspension?.actor_type), site.last_suspension);
let today = (await api("GET", "/today")).data;
check("오늘 할 일: 운영자 정지(사유와 함께)", today.manualSuspensions.some((s) => s.id === live.siteId && s.reason === "사장님 요청으로 리뉴얼 중"));
await api("POST", `/sites/${live.siteId}/resume`);
site = (await api("GET", `/sites/${live.siteId}`)).data.site;
today = (await api("GET", "/today")).data;
check("재개하면 정지 표시가 사라짐", site.last_suspension === null && !today.manualSuspensions.some((s) => s.id === live.siteId));

// 4. placeholders: where they are
const todo = await make("todo", (config) => {
  config.business.address = "(작성 필요) 주소";
});
site = (await api("GET", `/sites/${todo.siteId}`)).data.site;
check("작성 필요 위치를 경로로", site.draft_todos === site.draft_todo_fields.length && site.draft_todo_fields.includes("business.address"), {
  fields: site.draft_todo_fields,
});

// 5. no customer: flagged, with the customer that has the same phone
const phone = `010-${digits.slice(0, 4)}-${digits.slice(4)}`;
const loose = await make("loose", (config) => {
  config.business.phone = phone;
});
const customerId = (await api("POST", "/customers", { name: `품질고객 ${run}`, phone })).data.customer.id;
site = (await api("GET", `/sites/${loose.siteId}`)).data.site;
check("고객 미연결 사이트에 같은 전화번호 고객 제안", site.customer_suggestions.some((c) => c.id === customerId));
today = (await api("GET", "/today")).data;
check("오늘 할 일: 고객 미연결, 시안 링크 없음", today.unlinked.some((s) => s.id === loose.siteId) && today.drafts.some((s) => s.id === loose.siteId && s.draft === "no-link"));

// round 2: the customer's page offers the unlinked sites with the same phone
const loose2 = await make("loose2", (config) => {
  config.business.phone = phone;
});
const detail = (await api("GET", `/customers/${customerId}`)).data;
check("고객 상세: 같은 연락처의 미연결 사이트", detail.unlinkedMatches.some((s) => s.id === loose2.siteId) && detail.unlinkedMatches.some((s) => s.id === loose.siteId));
const billed = await make("billed");
await api("POST", `/sites/${billed.siteId}/subscription/bill`);

// paid for but not published yet: still on the list until it goes public
await paySite(loose.siteId);
today = (await api("GET", "/today")).data;
check("오늘 할 일: 입금됐지만 게시 전이면 '게시 기다림'", today.drafts.some((s) => s.id === loose.siteId && s.draft === "paid"));

// 6. pending custom domain shows up
const domain = `www.q-${run}.co.kr`;
await api("POST", `/sites/${live.siteId}/domains`, { hostname: domain });
today = (await api("GET", "/today")).data;
check("오늘 할 일: 연결 기다리는 도메인", today.domains.some((d) => d.hostname === domain));

// 7. console
const browser = await chromium().launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await consoleLogin(page);
const shot = (name) => page.screenshot({ path: `${ev.dir}/${name}.png`, fullPage: true });
await page.goto(`${CONSOLE}/`, { waitUntil: "networkidle" });
const panel = page.getByTestId("today");
check("첫 화면에 오늘 할 일(정지 외 섹션들)", (await panel.isVisible()) && (await page.getByTestId("today-unlinked").isVisible()) && (await page.getByTestId("today-domains").isVisible()));
check("사이트 목록은 표(데이터 그리드 아님), 쪽 표시 한국어", (await page.getByTestId(`site-link-${live.config.slug}`).isVisible()) &&
  (await page.locator(".MuiDataGrid-root").count()) === 0 && (await page.getByText(/\/ 전체 \d+/).count()) > 0);
check("상단 메뉴에 'AI로 만들기'", await page.getByRole("link", { name: "AI로 만들기" }).isVisible());
await shot("today");

await page.goto(`${CONSOLE}/sites/${loose.siteId}`, { waitUntil: "networkidle" });
check("고객 미연결 경고와 제안", await page.getByTestId("customer-missing").isVisible());
await page.getByTestId(`suggest-${customerId}`).click();
check("제안 고객으로 한 번에 연결", await page.getByTestId("customer-missing").waitFor({ state: "detached", timeout: 10000 }).then(() => true).catch(() => false));
await page.getByRole("button", { name: "시안 링크 만들기" }).click();
await page.getByRole("button", { name: "안내문 보기" }).click();
check("안내문을 복사 전에 볼 수 있음", (await page.getByTestId("draft-message").textContent()).includes("[홈페이지 시안 안내]"));
await shot("draft-message");

await page.goto(`${CONSOLE}/customers/${customerId}`, { waitUntil: "networkidle" });
check("고객 화면에 미연결 사이트와 연결 버튼", await page.getByTestId("unlinked-matches").isVisible());
await page.getByTestId(`link-${loose2.siteId}`).click();
check("고객 화면에서 연결하면 사이트 목록에 들어감", await page.getByTestId("unlinked-matches").waitFor({ state: "detached", timeout: 10000 }).then(() => true).catch(() => false) &&
  (await page.getByRole("link", { name: loose2.config.business.name }).count()) > 0);

await page.goto(`${CONSOLE}/sites/${billed.siteId}`, { waitUntil: "networkidle" });
await page.getByTestId("payment-request").getByRole("button", { name: "안내문 보기" }).click();
const request = await page.getByTestId("payment-request").locator("pre").textContent();
check("청구된 사이트: 입금 요청 안내문(금액·기간·계좌)", request.includes("[홈페이지 이용료 입금 안내]") && request.includes("30,000원") && request.includes("입금 계좌: 로컬은행"), { request });
await page.getByRole("button", { name: "입금 확인" }).click();
await page.getByRole("dialog").getByRole("button", { name: "입금 확인" }).click();
check("입금 확인 알림에 상호와 납부 기간", await page.getByText(new RegExp(`${billed.config.business.name} 입금을 확인했습니다 · .+까지 납부`)).waitFor({ timeout: 10000 }).then(() => true).catch(() => false));
check("입금되면 요청 안내문이 사라짐", await page.getByTestId("payment-request").waitFor({ state: "detached", timeout: 10000 }).then(() => true).catch(() => false));
await shot("paid");

await page.goto(`${CONSOLE}/sites/${todo.siteId}`, { waitUntil: "networkidle" });
check("시안 카드에 작성 필요 위치", (await page.getByTestId("draft-todo-fields").textContent()).includes("business.address"));

await page.goto(`${CONSOLE}/sites/${live.siteId}`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "공개 정지" }).click();
check("정지 사유 없이는 정지 버튼이 꺼져 있음", await page.getByRole("dialog").getByRole("button", { name: "정지" }).isDisabled());
await page.locator("input[name=suspendReason]").fill("점검");
await page.getByRole("dialog").getByRole("button", { name: "정지" }).click();
const notice = page.getByTestId("manual-suspension");
check("콘솔 정지: 사유 입력 → 누가·언제·왜 표시", await notice.waitFor({ timeout: 10000 }).then(async () => (await notice.textContent()).includes("사유: 점검")).catch(() => false));
await shot("manual-suspension");
await page.getByRole("button", { name: "공개 재개" }).click();

await page.goto(`${CONSOLE}/payments?tab=history`, { waitUntil: "networkidle" });
const kst = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 8);
check("결제 내역은 이번 달부터", (await page.getByLabel("입금일 부터").inputValue()) === `${kst}01`);
await browser.close();

ev.finish();
