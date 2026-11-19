// Seeds demo data for product-owner smoke tests (screens only, no code). Idempotent per slug:
// existing sites are reused. Docker: docker compose run --rm verify node scripts/seed-smoke.mjs
// Prints the URLs the tester gets. Grows with each M4 stage.
import { api, paySite, uploadShared } from "./lib/verify.mjs";

const { fieldFixture, lessonFixture } = await import("../packages/renderer/src/templates/service-local/fixtures.ts");

uploadShared();

const { data: list } = await api("GET", "/sites");
const existing = new Map((list.sites ?? []).map((s) => [s.slug, s]));

async function ensureSite(slug, base, mutate = () => {}) {
  if (existing.has(slug)) return existing.get(slug).id;
  const config = structuredClone(base);
  config.slug = slug;
  mutate(config);
  const created = await api("POST", "/sites", { config, createdBy: "operator" });
  if (created.status !== 201) throw new Error(`create ${slug}: ${created.status} ${JSON.stringify(created.data)}`);
  return created.data.siteId;
}

// An open site, a suspended (overdue) site and a draft that was never published.
const paidSite = async (id) => {
  if ((await api("GET", `/sites/${id}/subscription`)).data.subscription?.status === "trial") await paySite(id);
};
const open = await ensureSite("smoke-academy", lessonFixture, (c) => (c.business.name = "도봉 풋볼 아카데미"));
await paidSite(open);
await api("POST", `/sites/${open}/publish`);

const overdue = await ensureSite("smoke-clean", fieldFixture, (c) => (c.business.name = "상쾌공간 입주청소"));
await paidSite(overdue);
await api("POST", `/sites/${overdue}/publish`);
await api("POST", `/sites/${overdue}/suspend`);

await ensureSite("smoke-draft", fieldFixture, (c) => (c.business.name = "반짝 이사청소"));

console.log(
  JSON.stringify(
    {
      console: "http://127.0.0.1:8789",
      sites: {
        open: "http://smoke-academy.localhost:8787",
        suspended: "http://smoke-clean.localhost:8787",
        draftOnly: "smoke-draft (게시 안 함)",
      },
    },
    null,
    2,
  ),
);
