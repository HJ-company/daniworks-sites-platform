// M4 step 4-B (console): customers, the subscription card, the payments work queue and history,
// in a browser. Publishing is blocked until a deposit is confirmed; editing a payment's period
// moves the site between public and the preparing page.
import { api, chromium, evidence, localD1, routerRequest, uploadShared, consoleLogin, CONSOLE } from "./lib/verify.mjs";

const { fieldFixture } = await import("../packages/renderer/src/templates/service-local/fixtures.ts");
const ev = evidence("m4-billing-console");
const { check } = ev;
const run = Date.now().toString(36);
uploadShared();

const config = { ...structuredClone(fieldFixture), slug: `billc-${run}` };
config.business.name = `결제화면청소 ${run}`;
const host = `${config.slug}.localhost`;
const siteId = (await api("POST", "/sites", { config, createdBy: "operator" })).data.siteId;
const { today } = (await api("GET", "/billing/queue")).data;
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const browser = await chromium().launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
await consoleLogin(page);
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const shot = (name) => page.screenshot({ path: `${ev.dir}/${name}.png`, fullPage: true });
const visible = (locator, timeout = 10000) => locator.first().waitFor({ timeout }).then(() => true).catch(() => false);
const toast = (text) => visible(page.getByText(text), 15000);

// 1. add a customer
await page.goto(`${CONSOLE}/customers`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "고객 추가" }).click();
const dialog = page.getByRole("dialog");
await dialog.locator("input[name=name]").fill(`결제화면 고객 ${run}`);
await dialog.locator("input[name=businessNumber]").fill("12-3");
await dialog.getByRole("button", { name: "저장" }).click();
check("고객 추가: 사업자번호 형식 오류 표시", await visible(dialog.getByTestId("error-alert").filter({ hasText: "사업자등록번호" })));
await dialog.locator("input[name=businessNumber]").fill("1234567890");
await dialog.locator("input[name=contactName]").fill("김사장");
await dialog.getByRole("button", { name: "저장" }).click();
check("고객 추가 후 상세 화면", (await visible(page.getByTestId("customer-title").filter({ hasText: `결제화면 고객 ${run}` }))) &&
  (await visible(page.getByText("123-45-67890"))));
const customerUrl = page.url();

// 2. site overview: trial, publishing blocked, link the customer
await page.goto(`${CONSOLE}/sites/${siteId}`, { waitUntil: "networkidle" });
const card = page.getByTestId("subscription-card");
check("구독 카드: 시안, 게시 막힘 안내, 게시 버튼 비활성", (await visible(card.getByText("시안", { exact: true }))) &&
  (await visible(page.getByTestId("publish-blocked"))) && (await page.getByTestId("version-1").getByRole("button", { name: "게시" }).isDisabled()));
await card.getByLabel("고객(사장님)").click();
await page.getByRole("option", { name: `결제화면 고객 ${run}` }).click();
check("사이트에 고객 연결", await toast("고객을 연결했습니다"));
await card.getByRole("button", { name: "청구하기" }).click();
check("청구 → 입금 대기, 상단 결제 배지", (await toast("청구했습니다")) && (await visible(card.getByText("입금 대기", { exact: true }))) &&
  Number(await page.getByTestId("nav-payments-badge").locator(".MuiBadge-badge").textContent()) >= 1);
await shot("site-awaiting");

// 3. confirm the deposit from the work queue
await page.goto(`${CONSOLE}/payments`, { waitUntil: "networkidle" });
check("확인 필요 목록에 사이트", await visible(page.getByTestId(`pay-${config.slug}`)));
await shot("queue");
await page.getByTestId(`pay-${config.slug}`).click();
const pay = page.getByRole("dialog");
check("입금 확인 창: 청구 금액·다음 기간 기본값", (await pay.locator("input[name=amount]").inputValue()) === "30000" &&
  (await pay.locator("input[name=periodStart]").inputValue()) === today);
await pay.locator("input[name=payerName]").fill("김사장");
await pay.getByRole("button", { name: "입금 확인" }).click();
check("입금 확인 → 목록에서 빠짐", (await toast("입금을 확인했습니다")) &&
  (await page.getByTestId(`pay-${config.slug}`).waitFor({ state: "detached", timeout: 10000 }).then(() => true).catch(() => false)));

// 4. publish now works
await page.goto(`${CONSOLE}/sites/${siteId}`, { waitUntil: "networkidle" });
check("입금 뒤: 활성, 다음 결제일 안내", (await visible(card.getByText("활성", { exact: true }))) && (await card.getByTestId("billing-summary").textContent()).includes("다음 결제일"));
await page.getByTestId("version-1").getByRole("button", { name: "게시" }).click();
check("게시 → 공개", (await toast("v1을 게시했습니다")) && (await routerRequest(host, "/")).status === 200);

// 5. history: edit the period into the past → preparing page and the reason on the overview
await page.goto(`${CONSOLE}/payments?tab=history`, { waitUntil: "networkidle" });
const payment = (await api("GET", `/sites/${siteId}/subscription`)).data.payments[0];
check("결제 내역에 입금, 합계 표시", (await visible(page.getByTestId(`edit-${payment.id}`))) && (await page.getByTestId("payments-total").textContent()).includes("합계"));
await page.getByTestId(`edit-${payment.id}`).click();
const edit = page.getByRole("dialog");
await edit.locator("input[name=periodStart]").fill(addDays(today, -60));
await edit.locator("input[name=periodEnd]").fill(addDays(today, -20));
await edit.locator("input[name=invoiceIssuedOn]").fill(today);
await edit.getByRole("button", { name: "저장" }).click();
check("기간 수정 저장", await toast("결제 기록을 고쳤습니다"));
check("기간이 20일 전에 끝남 → 준비 중 페이지", (await routerRequest(host, "/")).status === 503);
await page.goto(`${CONSOLE}/sites/${siteId}`, { waitUntil: "networkidle" });
check("개요: 중단, 미납 사유, 게시됨·공개 중단 표시", (await visible(card.getByText("중단", { exact: true }))) &&
  (await page.getByTestId("suspend-reason").textContent()).includes("미납") && (await visible(page.getByText("게시됨 · 공개 중단"))) &&
  (await page.getByRole("button", { name: "공개 재개" }).count()) === 0);
await shot("site-suspended");

// 6. void needs a reason
await page.goto(`${CONSOLE}/payments?tab=history`, { waitUntil: "networkidle" });
await page.getByTestId(`edit-${payment.id}`).locator("xpath=..").getByRole("button", { name: "취소" }).click();
const voidDialog = page.getByRole("dialog");
check("결제 취소는 사유 없으면 비활성", await voidDialog.getByRole("button", { name: "결제 취소" }).isDisabled());
await voidDialog.locator("input[name=voidReason]").fill("시험 기록");
await voidDialog.getByRole("button", { name: "결제 취소" }).click();
check("결제 취소 → 내역에 취소됨", (await toast("결제를 취소했습니다")) && (await visible(page.getByText("취소됨 · 시험 기록"))));
await shot("history");

// 7. the customer page shows the site, its public state and payments; invoices are recorded there
await api("POST", `/sites/${siteId}/payments`, { payerName: "김사장" });
await page.goto(customerUrl, { waitUntil: "networkidle" });
check("고객 상세: 사이트·공개 상태·구독 상황·결제 이력(취소 포함)", (await visible(page.getByRole("link", { name: config.business.name }))) &&
  (await visible(page.getByText("운영", { exact: true }))) && (await page.locator("tbody tr").count()) >= 3);
const fresh = (await api("GET", `/sites/${siteId}/subscription`)).data.payments.find((p) => !p.voided_at && !p.invoice_issued_on);
await page.getByTestId(`invoice-${fresh.id}`).click();
await page.getByRole("dialog").locator("input[name=invoiceIssuedOn]").fill(today);
await page.getByRole("dialog").getByRole("button", { name: "저장" }).click();
check("고객 상세에서 바로 세금계산서 발행일 기록", (await toast("결제 기록을 고쳤습니다")) &&
  (await visible(page.getByTestId(`invoice-${fresh.id}`).filter({ hasText: today }))));
await shot("customer");

// 8. history: customer column, search, this month, purged sites shown as such
const goneConfig = { ...structuredClone(fieldFixture), slug: `billc-gone-${run}` };
goneConfig.business.name = `삭제될청소 ${run}`;
const gone = (await api("POST", "/sites", { config: goneConfig, createdBy: "operator" })).data.siteId;
await api("POST", `/sites/${gone}/payments`, { payerName: "삭제" });
await api("POST", `/sites/${gone}/cancel`);
localD1(`UPDATE sites SET cancelled_at = '2000-01-01T00:00:00.000Z' WHERE id = '${gone}'`);
await api("POST", `/sites/${gone}/purge`, { confirmSlug: goneConfig.slug });
await page.goto(`${CONSOLE}/payments?tab=history`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "이번 달" }).click();
await page.getByRole("searchbox", { name: "결제 검색" }).fill(`결제화면 고객 ${run}`);
check("결제 내역: 고객 이름으로 검색, 고객 열", await visible(page.getByRole("gridcell", { name: `결제화면 고객 ${run}` })));
await page.getByRole("searchbox", { name: "결제 검색" }).fill(`삭제될청소 ${run}`);
check("결제 내역: 삭제된 사이트는 링크 없이 (삭제됨)", (await visible(page.getByText(`삭제될청소 ${run} (삭제됨)`))) &&
  (await page.getByRole("link", { name: `삭제될청소 ${run}` }).count()) === 0);
check("검색하면 검색 결과의 건수·합계", (await page.getByTestId("payments-total").textContent()).startsWith("검색 결과"));
await page.getByRole("searchbox", { name: "결제 검색" }).fill("");
await page.getByTestId("payments-total").filter({ hasText: /^입금/ }).waitFor({ timeout: 10000 }).catch(() => undefined);
check("결제 내역 합계 문구에 취소 건 안내", (await page.getByTestId("payments-total").textContent()).includes("취소"));
await page.reload({ waitUntil: "networkidle" });
const kept = { url: page.url(), field: await page.locator('input[type="date"]').first().inputValue() };
check("결제 내역 기간이 주소에 남아 새로고침해도 유지", new URL(kept.url).searchParams.get("from")?.endsWith("-01") && kept.field.endsWith("-01"), kept);

// 9. the site's customer picker: find by owner name, add a new customer in place
const pickConfig = { ...structuredClone(fieldFixture), slug: `billc-pick-${run}` };
const pick = (await api("POST", "/sites", { config: pickConfig, createdBy: "operator" })).data.siteId;
await page.goto(`${CONSOLE}/sites/${pick}`, { waitUntil: "networkidle" });
await card.getByLabel("고객(사장님)").fill("김사장");
check("고객 선택: 사장님 이름으로 찾음", await visible(page.getByRole("option", { name: new RegExp(`결제화면 고객 ${run}`) })));
await card.getByLabel("고객(사장님)").fill(`최민수${run}`);
await page.getByRole("option", { name: `+ 새 고객 추가: 최민수${run}` }).click();
const create = page.getByRole("dialog");
check("새 고객 추가 창: 업체명은 사이트 상호, 입력한 이름은 담당자", (await create.locator("input[name=name]").inputValue()) === pickConfig.business.name &&
  (await create.locator("input[name=contactName]").inputValue()) === `최민수${run}`);
await create.locator("input[name=businessNumber]").fill("123-45-67890");
check("같은 사업자번호 고객이 있으면 경고", await visible(create.getByTestId("duplicate-customer")));
await create.locator("input[name=businessNumber]").fill("");
await create.locator("input[name=name]").fill(`픽커청소 ${run}`);
await create.getByRole("button", { name: "저장" }).click();
check("새 고객을 만들고 바로 사이트에 연결", (await toast("고객을 연결했습니다")) &&
  (await api("GET", `/sites/${pick}`)).data.site.customer_id !== null);

// 10. overdue wording says until when the site stays public
const lateConfig = { ...structuredClone(fieldFixture), slug: `billc-late-${run}` };
const late = (await api("POST", "/sites", { config: lateConfig, createdBy: "operator" })).data.siteId;
await api("POST", `/sites/${late}/payments`, { periodStart: addDays(today, -40), periodEnd: addDays(today, -5) });
await page.goto(`${CONSOLE}/sites/${late}`, { waitUntil: "networkidle" });
const summary = await card.getByTestId("billing-summary").textContent();
check("연체 문구: ○월 ○일(요일)까지 공개, 다음 날부터 중단", /\d+월 \d+일\([일월화수목금토]\)까지 공개, \d+월 \d+일\([일월화수목금토]\)부터 공개 중단/.test(summary), { summary });
await card.getByRole("button", { name: "입금 확인" }).click();
check("입금 창에 기간을 잡은 기준 안내(유예 중 이어서)", (await page.getByTestId("period-rule").textContent()).includes("이어서"));
await page.getByRole("dialog").getByRole("button", { name: "닫기" }).click();
check("콘솔 페이지 오류 없음", !errors.length, { errors });
await browser.close();
ev.finish({ siteId });
