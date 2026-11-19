// M4 step 4-B: customers, per-site subscriptions and manually confirmed payments. Status follows
// the paid periods: 시안 → 입금 대기 → 활성 → 연체(14일 공개 유지) → 중단(준비 중 페이지);
// a payment resumes a site the billing suspended, never one the operator suspended.
import { API, TOKEN, api, evidence, localD1, routerRequest, uploadShared } from "./lib/verify.mjs";

const { fieldFixture } = await import("../packages/renderer/src/templates/service-local/fixtures.ts");
const ev = evidence("m4-billing");
const { check } = ev;
const run = Date.now().toString(36);

uploadShared();
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const { today } = (await api("GET", "/billing/queue")).data;

// 1. customer
const badCustomer = await api("POST", "/customers", { name: "", businessNumber: "12-34" });
check("고객 검증: 업체명 필수, 사업자번호 형식", badCustomer.status === 422 && badCustomer.data.details.some((d) => d.includes("사업자등록번호")));
const customer = (await api("POST", "/customers", {
  name: `상쾌공간 ${run}`,
  contactName: "김철수",
  phone: "010-0000-0001",
  businessNumber: "1234567890",
  invoiceEmail: "tax@example.test",
  externalRef: "https://notion.so/lead-1",
})).data.customer;
check("고객 생성: 사업자번호 하이픈 정리", customer?.business_number === "123-45-67890");

// 2. site starts as a trial subscription linked to the customer
const config = { ...structuredClone(fieldFixture), slug: `bill-${run}` };
const host = `${config.slug}.localhost`;
const created = await api("POST", "/sites", { config, createdBy: "operator", customerId: customer.id });
const siteId = created.data.siteId;
const sub = async () => (await api("GET", `/sites/${siteId}/subscription`)).data;
let s = await sub();
check("새 사이트: 구독 시안, 월 30,000원, 게시 불가 표시", s.subscription.status === "trial" && s.subscription.cycle === "monthly" &&
  s.subscription.amount === 30000 && s.subscription.canPublish === false, s.subscription);
check("고객에 사이트 연결", (await api("GET", `/customers/${customer.id}`)).data.sites.some((x) => x.id === siteId));

const yearly = (await api("PATCH", `/sites/${siteId}/subscription`, { cycle: "yearly" })).data.subscription;
const nextYear = `${Number(today.slice(0, 4)) + 1}${today.slice(4)}`;
check("연 단위로 바꾸면 기본 360,000원, 기간 1년", yearly.amount === 360000 && yearly.nextPeriod.end === addDays(nextYear, -1), yearly.nextPeriod);
const custom = (await api("PATCH", `/sites/${siteId}/subscription`, { cycle: "monthly", amount: "33,000" })).data.subscription;
check("금액 직접 지정(쉼표 허용)", custom.cycle === "monthly" && custom.amount === 33000);
check("잘못된 주기·금액 422", (await api("PATCH", `/sites/${siteId}/subscription`, { cycle: "weekly" })).status === 422 &&
  (await api("PATCH", `/sites/${siteId}/subscription`, { amount: -1 })).status === 422);

const trialPublish = await api("POST", `/sites/${siteId}/publish`);
check("시안 상태 게시는 409(입금 안내)", trialPublish.status === 409 && trialPublish.data.error.includes("입금"));
const billed = (await api("POST", `/sites/${siteId}/subscription/bill`)).data.subscription;
const queue = async () => (await api("GET", "/billing/queue")).data.sites.find((x) => x.site_id === siteId);
check("청구 → 입금 대기, 작업 목록에 표시", billed.status === "awaiting" && (await queue())?.status === "awaiting");

// 3. payment with the default period
const paid = await api("POST", `/sites/${siteId}/payments`, { payerName: "김철수", paidOn: today });
const payment = paid.data.payment;
check("입금 확인 → 활성, 기본 기간 오늘부터 한 달", paid.status === 201 && paid.data.subscription.status === "active" &&
  payment.period_start === today && payment.amount === 33000 && payment.site_slug === config.slug && payment.business_name === config.business.name &&
  !(await queue()), payment);
check("입금 날짜·기간 형식 검증", (await api("POST", `/sites/${siteId}/payments`, { paidOn: "2026-02-30" })).status === 422 &&
  (await api("POST", `/sites/${siteId}/payments`, { periodStart: today, periodEnd: addDays(today, -1) })).status === 422);
await api("POST", `/sites/${siteId}/publish`);
check("활성 사이트 공개", (await routerRequest(host, "/")).status === 200);

// 4. the operator edits the covered period
const extended = (await api("PATCH", `/payments/${payment.id}`, { periodEnd: addDays(today, 60), invoiceIssuedOn: today })).data.payment;
s = await sub();
check("기간 순서가 뒤집히는 수정은 422", (await api("PATCH", `/payments/${payment.id}`, { periodStart: addDays(today, 90) })).status === 422);
const memoOnly = (await api("PATCH", `/payments/${payment.id}`, { memo: "계좌 입금" })).data.payment;
check("일부 필드만 수정하면 나머지는 유지", memoOnly.memo === "계좌 입금" && memoOnly.period_end === addDays(today, 60) && memoOnly.invoice_issued_on === today);
check("결제 기간 연장 → 다음 결제일 반영, 계산서 발행일 기록", extended.period_end === addDays(today, 60) && s.subscription.paidThrough === addDays(today, 60) &&
  s.subscription.nextDueOn === addDays(today, 61) && extended.invoice_issued_on === today);

await api("PATCH", `/payments/${payment.id}`, { periodStart: addDays(today, -40), periodEnd: addDays(today, -3) });
s = await sub();
let q = await queue();
check("기간이 끝난 지 3일: 연체, 유예 11일 남음, 공개 유지", s.subscription.status === "overdue" && q?.graceDaysLeft === 11 && q?.daysOverdue === 3 &&
  (await routerRequest(host, "/")).status === 200, q);

await api("PATCH", `/payments/${payment.id}`, { periodEnd: addDays(today, -15) });
s = await sub();
const site = (await api("GET", `/sites/${siteId}`)).data.site;
const down = await routerRequest(host, "/");
check("유예 14일 지남: 중단, 준비 중 페이지(503), 사유 결제", s.subscription.status === "suspended" && site.status === "suspended" &&
  site.suspend_reason === "billing" && down.status === 503 && down.body.includes("준비하고 있습니다"));
check("미납 중단 사이트는 공개 재개·게시 거부", (await api("POST", `/sites/${siteId}/resume`)).status === 409 &&
  (await api("POST", `/sites/${siteId}/publish`)).status === 409);
check("중단 사이트도 작업 목록에", (await queue())?.status === "suspended");

const late = await api("POST", `/sites/${siteId}/payments`, { payerName: "김철수" });
check("중단 뒤 입금: 오늘부터 새 기간, 바로 재공개", late.data.subscription.status === "active" && late.data.payment.period_start === today &&
  late.data.site === "resumed" && (await routerRequest(host, "/")).status === 200);

// 5. voiding
check("결제 취소는 사유 필수", (await api("POST", `/payments/${late.data.payment.id}/void`, {})).status === 422);
const voided = (await api("POST", `/payments/${late.data.payment.id}/void`, { reason: "다른 사이트 입금을 잘못 매칭" })).data.payment;
s = await sub();
check("결제 취소 → 다시 중단(준비 중)", voided.voided_at && s.subscription.status === "suspended" && (await routerRequest(host, "/")).status === 503);
check("취소된 결제는 수정 불가", (await api("PATCH", `/payments/${voided.id}`, { memo: "x" })).status === 409);

// 5b. voiding the only payment of a live site takes it down; a future period does not count yet
const solo = (await api("POST", "/sites", { config: { ...structuredClone(fieldFixture), slug: `bill-solo-${run}` }, createdBy: "operator" })).data.siteId;
const soloPay = (await api("POST", `/sites/${solo}/payments`, {})).data.payment;
await api("POST", `/sites/${solo}/publish`);
await api("POST", `/payments/${soloPay.id}/void`, { reason: "입금 확인 착오" });
const soloSite = (await api("GET", `/sites/${solo}`)).data.site;
check("유일한 결제를 취소하면 공개 중단(입금 대기)", (await api("GET", `/sites/${solo}/subscription`)).data.subscription.status === "awaiting" &&
  soloSite.status === "suspended" && soloSite.suspend_reason === "billing" && (await routerRequest(`bill-solo-${run}.localhost`, "/")).status === 503);
const future = (await api("POST", `/sites/${solo}/payments`, { periodStart: addDays(today, 10), periodEnd: addDays(today, 40) })).data;
check("시작일이 미래인 결제는 아직 공개하지 않음", future.subscription.status === "awaiting" && future.subscription.latestEnd === addDays(today, 40) &&
  (await api("POST", `/sites/${solo}/resume`)).status === 409);
await api("PATCH", `/payments/${future.payment.id}`, { periodStart: today });
check("기간 시작일을 오늘로 고치면 바로 재공개", (await routerRequest(`bill-solo-${run}.localhost`, "/")).status === 200);

const [twinA, twinB] = await Promise.all([api("POST", `/sites/${solo}/payments`, {}), api("POST", `/sites/${solo}/payments`, {})]);
check("동시에 두 번 입금 확인: 기간이 겹치지 않고 이어짐", twinA.status === 201 && twinB.status === 201 &&
  twinA.data.payment.period_start !== twinB.data.payment.period_start &&
  [twinA, twinB].map((t) => t.data.payment).sort((a, b) => a.period_start.localeCompare(b.period_start))
    .every((p, i, all) => i === 0 || p.period_start === addDays(all[i - 1].period_end, 1)));

const startOnly = (await api("POST", `/sites/${solo}/payments`, { periodStart: addDays(today, 200) })).data.payment;
check("시작일만 주면 그 날부터 한 주기", startOnly.period_start === addDays(today, 200) && startOnly.period_end > addDays(today, 226) && startOnly.period_end < addDays(today, 232));
await api("POST", `/payments/${startOnly.id}/void`, { reason: "시험" });

// 6. a manual suspension is not lifted by a payment
await api("POST", `/sites/${siteId}/payments`, {});
await api("POST", `/sites/${siteId}/suspend`);
const manual = (await api("GET", `/sites/${siteId}`)).data.site;
await api("POST", `/sites/${siteId}/payments`, {});
check("운영자 정지는 입금으로 풀리지 않음", manual.suspend_reason === "manual" && (await api("GET", `/sites/${siteId}`)).data.site.status === "suspended");
await api("POST", `/sites/${siteId}/resume`);
check("운영자 재개", (await routerRequest(host, "/")).status === 200);

// 7. the hourly cron moves statuses with the date
localD1(`UPDATE payments SET period_end = '${addDays(today, -20)}', period_start = '${addDays(today, -50)}' WHERE site_id = '${siteId}' AND voided_at IS NULL`);
await fetch(`${API}/__scheduled?cron=17+*+*+*+*`);
let cronStatus;
for (let i = 0; i < 40; i++) {
  cronStatus = localD1(`SELECT status FROM subscriptions WHERE site_id = '${siteId}'`)[0]?.status;
  if (cronStatus === "suspended") break;
  await new Promise((r) => setTimeout(r, 250));
}
check("시간별 cron: 기한 지난 구독을 중단하고 공개를 멈춤", cronStatus === "suspended" && (await routerRequest(host, "/")).status === 503);

// 8. lists
const customerView = (await api("GET", `/customers/${customer.id}`)).data;
check("고객 상세: 사이트별 구독 상태·결제 이력", customerView.sites[0]?.subscription.statusLabel === "중단" && customerView.payments.length === 4);
const listed = (await api("GET", "/customers")).data.customers.find((c) => c.id === customer.id);
check("고객 목록: 사이트 수, 월 청구 합계, 확인 필요 표시", listed?.site_count === 1 && listed.monthly_total === 33000 && listed.attention === 1, listed);
const history = (await api("GET", `/payments?from=${today}&to=${today}`)).data.payments.filter((p) => p.site_id === siteId);
check("결제 내역: 입금일 필터, 취소 건 포함 표시", history.length === 4 && history.some((p) => p.voided_at));
const range = (await api("GET", `/payments?from=${today}&to=${today}`)).data;
check("결제 내역 합계는 서버 집계(취소 제외)", range.count === range.payments.filter((p) => !p.voided_at).length &&
  range.total === range.payments.filter((p) => !p.voided_at).reduce((n, p) => n + p.amount, 0) && range.truncated === false);
check("결제 내역 필터 형식 검증", (await api("GET", "/payments?from=yesterday")).status === 422);
const siteList = (await api("GET", "/sites")).data.sites.find((x) => x.id === siteId);
check("사이트 목록에 구독 상태·고객명", siteList?.billing_status === "suspended" && siteList.customer_name === customer.name);

// 9. cancellation and purge: payments are accounting records and stay
await api("POST", `/sites/${siteId}/cancel`);
check("해지 → 구독 해지", (await sub()).subscription.status === "cancelled" && !(await queue()));
check("해지된 사이트는 입금 기록 불가", (await api("POST", `/sites/${siteId}/payments`, {})).status === 409);
localD1(`UPDATE sites SET cancelled_at = '2000-01-01T00:00:00.000Z' WHERE id = '${siteId}'`);
const purged = await api("POST", `/sites/${siteId}/purge`, { confirmSlug: config.slug });
check("완전 삭제 뒤에도 결제 기록은 남음(slug·상호 보존)", purged.status === 200 &&
  localD1(`SELECT COUNT(*) AS n FROM payments WHERE site_id = '${siteId}'`)[0].n === 4 &&
  localD1(`SELECT COUNT(*) AS n FROM subscriptions WHERE site_id = '${siteId}'`)[0].n === 0 &&
  (await api("GET", `/payments?from=${today}`)).data.payments.some((p) => p.site_id === siteId && p.site_slug === config.slug));
check("인증 없는 결제·고객 API는 401", (await fetch(`${API}/payments`)).status === 401 && (await fetch(`${API}/customers`, { headers: { authorization: `Bearer x${TOKEN}` } })).status === 401);

ev.finish();
