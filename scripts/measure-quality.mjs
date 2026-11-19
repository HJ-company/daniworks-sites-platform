// Scorecard measurements for the M4 improvement loop (evidence/m4-quality/scorecard.md).
// Docker: docker compose run --rm verify node scripts/measure-quality.mjs [round]
// Public sites: Lighthouse mobile (median of 3) for both presets and a customer draft link.
// Console: first-view JS transferred (gzip), time to a usable list, and main screens' load times.
import { writeFileSync, mkdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { CONSOLE, api, chromium, consoleLogin, lighthouse, paySite, uploadShared } from "./lib/verify.mjs";

const { fieldFixture, lessonFixture } = await import("../packages/renderer/src/templates/service-local/fixtures.ts");
const round = process.argv[2] ?? "baseline";
const run = Date.now().toString(36);
uploadShared();

// Public sites, fresh renders with the current renderer.
const sites = {};
for (const [name, fixture] of Object.entries({ lesson: lessonFixture, field: fieldFixture })) {
  const config = { ...structuredClone(fixture), slug: `q-${name}-${run}` };
  const siteId = (await api("POST", "/sites", { config, createdBy: "operator" })).data.siteId;
  await paySite(siteId);
  await api("POST", `/sites/${siteId}/publish`);
  sites[name] = { siteId, url: `http://${config.slug}.localhost:8787/` };
}
const draft = (await api("POST", `/sites/${sites.lesson.siteId}/draft-link`)).data.draftLink.url;

const metrics = { round, at: new Date().toISOString(), public: {}, console: {} };
for (const [name, { url }] of Object.entries({ ...sites, draft: { url: draft } })) {
  const { report, ...score } = await lighthouse(url);
  const failed = Object.values(report.categories)
    .flatMap((c) => c.auditRefs.filter((r) => r.weight > 0).map((r) => report.audits[r.id]))
    .filter((a) => a.score !== null && a.score < 0.9)
    .map((a) => a.id);
  metrics.public[name] = { ...score, failed };
  console.log(name, JSON.stringify(metrics.public[name]));
}

// Console: what the first screen downloads, and how long the main screens take.
const browser = await chromium().launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
await consoleLogin(page);
const cdp = await context.newCDPSession(page);
await cdp.send("Network.enable");
await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
// Scripts the first view loads, sized as production serves them (gzip): local wrangler does not compress.
const scripts = new Set();
cdp.on("Network.responseReceived", (e) => {
  if (e.type === "Script") scripts.add(e.response.url);
});
const t0 = Date.now();
await page.goto(`${CONSOLE}/`, { waitUntil: "domcontentloaded" });
await page.getByTestId(`site-link-q-lesson-${run}`).waitFor({ timeout: 20000 });
const listReadyMs = Date.now() - t0;
await page.waitForLoadState("networkidle");
let gzipBytes = 0;
for (const url of scripts) gzipBytes += gzipSync(Buffer.from(await (await fetch(url)).arrayBuffer())).length;
metrics.console.firstView = { scripts: scripts.size, jsGzipKb: Math.round(gzipBytes / 1024), listReadyMs };
await cdp.send("Network.setCacheDisabled", { cacheDisabled: false });

const screens = {
  site: `/sites/${sites.lesson.siteId}`,
  edit: `/sites/${sites.lesson.siteId}/edit`,
  photos: `/sites/${sites.lesson.siteId}/photos`,
  payments: "/payments?tab=history",
  customers: "/customers",
  guides: "/guides/industry-service-local",
};
const ready = { site: "subscription-card", edit: "json-section", photos: "photo-input", payments: "payments-total", customers: "customer-link-", guides: "guide-version" };
metrics.console.screensMs = {};
for (const [name, path] of Object.entries(screens)) {
  const start = Date.now();
  await page.goto(`${CONSOLE}${path}`, { waitUntil: "domcontentloaded" });
  const id = ready[name];
  const shown = await (id.endsWith("-") ? page.locator(`[data-testid^="${id}"]`).first() : page.getByTestId(id))
    .waitFor({ state: "attached", timeout: 20000 })
    .then(() => true)
    .catch(() => false);
  // A screen that never became ready is a failure, not a 20-second timing.
  metrics.console.screensMs[name] = shown ? Date.now() - start : "not ready";
}
console.log("console", JSON.stringify(metrics.console));
await browser.close();

mkdirSync("evidence/m4-quality", { recursive: true });
writeFileSync(`evidence/m4-quality/metrics-${round}.json`, JSON.stringify(metrics, null, 2));
