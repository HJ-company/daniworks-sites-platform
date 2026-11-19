// Seeds demo data for product-owner smoke tests (screens only, no code). Idempotent per slug:
// existing sites are reused. Docker: docker compose run --rm verify node scripts/seed-smoke.mjs
// Prints what the tester gets. Grows with each M4 stage.
import { api, paySite, uploadShared } from "./lib/verify.mjs";

const { fieldFixture, lessonFixture } = await import("../packages/renderer/src/templates/service-local/fixtures.ts");

uploadShared();

const { data: list } = await api("GET", "/sites");
const existing = new Map((list.sites ?? []).map((s) => [s.slug, s]));
const { data: customerList } = await api("GET", "/customers");
const { today } = (await api("GET", "/billing/queue")).data;
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

async function ensureCustomer(body) {
  const found = (customerList.customers ?? []).find((c) => c.name === body.name);
  if (found) return found.id;
  return (await api("POST", "/customers", body)).data.customer.id;
}

async function ensureSite(slug, base, mutate = () => {}, customerId) {
  if (existing.has(slug)) return { id: existing.get(slug).id, fresh: false };
  const config = structuredClone(base);
  config.slug = slug;
  mutate(config);
  // The page title follows the business name, as an agent would write it.
  config.meta.title = `${config.business.name} | ${config.meta.title.split("|").slice(1).join("|").trim() || "홈페이지"}`;
  const created = await api("POST", "/sites", { config, createdBy: "operator", customerId });
  if (created.status !== 201) throw new Error(`create ${slug}: ${created.status} ${JSON.stringify(created.data)}`);
  return { id: created.data.siteId, fresh: true };
}

const kim = await ensureCustomer({ name: "김철수(상쾌공간)", contactName: "김철수", phone: "010-0000-0001", businessNumber: "1234567890" });
const park = await ensureCustomer({ name: "박영희(도봉 풋볼)", contactName: "박영희", phone: "010-0000-0002" });

// Open and paid; suspended by the operator; never published.
const open = await ensureSite("smoke-academy", lessonFixture, (c) => (c.business.name = "도봉 풋볼 아카데미"), park);
if (open.fresh) await paySite(open.id);
await api("POST", `/sites/${open.id}/publish`);

const manual = await ensureSite("smoke-clean", fieldFixture, (c) => (c.business.name = "상쾌공간 입주청소"), kim);
if (manual.fresh) {
  await paySite(manual.id);
  await api("POST", `/sites/${manual.id}/publish`);
  await api("POST", `/sites/${manual.id}/suspend`);
}

await ensureSite("smoke-draft", fieldFixture, (c) => (c.business.name = "반짝 이사청소"));

// Billing: billed and waiting, overdue in grace (ended 5 days ago), suspended (ended 20 days ago).
const awaiting = await ensureSite("smoke-awaiting", fieldFixture, (c) => (c.business.name = "상쾌공간 2호점"), kim);
if (awaiting.fresh) await api("POST", `/sites/${awaiting.id}/subscription/bill`);

const late = await ensureSite("smoke-overdue", lessonFixture, (c) => (c.business.name = "노원 피아노 교습소"));
if (late.fresh) {
  await paySite(late.id);
  await api("POST", `/sites/${late.id}/publish`);
  const [first] = (await api("GET", `/sites/${late.id}/subscription`)).data.payments;
  await api("PATCH", `/payments/${first.id}`, { periodStart: addDays(today, -35), periodEnd: addDays(today, -5) });
}

const gone = await ensureSite("smoke-unpaid", fieldFixture, (c) => (c.business.name = "깔끔 사무실 청소"));
if (gone.fresh) {
  await paySite(gone.id);
  await api("POST", `/sites/${gone.id}/publish`);
  const [first] = (await api("GET", `/sites/${gone.id}/subscription`)).data.payments;
  await api("PATCH", `/payments/${first.id}`, { periodStart: addDays(today, -50), periodEnd: addDays(today, -20) });
}

console.log(
  JSON.stringify(
    {
      console: "http://127.0.0.1:8789",
      sites: {
        "도봉 풋볼 아카데미 (공개, 납부)": "http://smoke-academy.localhost:8787",
        "상쾌공간 입주청소 (운영자가 정지)": "http://smoke-clean.localhost:8787",
        "반짝 이사청소 (게시 안 함)": "smoke-draft",
        "상쾌공간 2호점 (청구, 입금 대기)": "smoke-awaiting",
        "노원 피아노 교습소 (5일 연체, 공개 유지)": "http://smoke-overdue.localhost:8787",
        "깔끔 사무실 청소 (20일 연체, 공개 중단)": "http://smoke-unpaid.localhost:8787",
      },
    },
    null,
    2,
  ),
);
