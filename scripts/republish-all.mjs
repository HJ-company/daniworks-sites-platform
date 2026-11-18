// Operator command: republish every live site with the current renderer and assets, switching
// a site only when its new render looks the same as what is live.
//
//   API_URL=https://api.dsites.kr ADMIN_TOKEN=... node scripts/republish-all.mjs [--apply]
//     [--all] [--only=slug,slug] [--threshold=0.0001]
//
// Without --apply it stages and compares only (nothing served changes). Sites over the
// threshold are listed with their diff images for a person to look at.
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const sharp = createRequire(new URL("../packages/renderer/package.json", import.meta.url))("sharp");

const API = process.env.API_URL ?? "http://127.0.0.1:8788";
const TOKEN = process.env.ADMIN_TOKEN ?? "dev-admin-token";
/** Local Docker: live sites are http://<slug>.localhost on the router port. */
const LIVE_PORT = process.env.LIVE_PORT;
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")).map(([k, v]) => [k, v ?? true]));
// Identical renders differ by exactly 0 pixels (measured); one changed heading is ~0.26% of a
// full page, a changed word far less. Any visible change should go to a person.
const threshold = Number(args.threshold ?? 0.0001);
const only = typeof args.only === "string" ? args.only.split(",") : null;
const out = `evidence/republish/${new Date().toISOString().replace(/[:.]/g, "-")}`;
mkdirSync(out, { recursive: true });

async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${data?.error ?? ""}`);
  return data;
}

const liveUrl = (url) => (LIVE_PORT ? url.replace(/^(https?:\/\/[^/]+)\//, `$1:${LIVE_PORT}/`) : url);

/** Hides what legitimately differs between two renders of the same version. */
const STABILIZE = `*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }
[data-blog-feed] { display: none !important; }`; /* filled only on live pages, at request time */

async function shot(context, url, viewport) {
  const page = await context.newPage();
  await page.setViewportSize(viewport);
  await page.goto(url, { waitUntil: "networkidle" });
  await page.addStyleTag({ content: STABILIZE });
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 500) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 50));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForLoadState("networkidle");
  const png = await page.screenshot({ fullPage: true });
  await page.close();
  return png;
}

/** Share of pixels that differ noticeably; a size change counts as fully different. */
async function diff(a, b, name) {
  const [ma, mb] = await Promise.all([a, b].map((png) => sharp(png).metadata()));
  const width = Math.max(ma.width, mb.width);
  const height = Math.max(ma.height, mb.height);
  const sized = ma.width !== mb.width || ma.height !== mb.height;
  // Different sizes (layout change): pad both onto the same canvas so the diff image still shows where.
  const raw = (png, m) =>
    sharp(png)
      .ensureAlpha()
      .extend({ right: width - m.width, bottom: height - m.height, background: { r: 255, g: 0, b: 255, alpha: 1 } })
      .raw()
      .toBuffer({ resolveWithObject: true });
  const [ra, rb] = await Promise.all([raw(a, ma), raw(b, mb)]);
  const mask = Buffer.alloc(width * height * 4);
  let changed = 0;
  for (let i = 0; i < ra.data.length; i += 4) {
    const d = Math.max(Math.abs(ra.data[i] - rb.data[i]), Math.abs(ra.data[i + 1] - rb.data[i + 1]), Math.abs(ra.data[i + 2] - rb.data[i + 2]));
    if (d > 24) {
      changed++;
      mask[i] = 255;
      mask[i + 3] = 255;
    } else {
      mask[i] = mask[i + 1] = mask[i + 2] = ra.data[i] >> 2;
      mask[i + 3] = 255;
    }
  }
  // A size change is never "the same", however few pixels differ.
  const ratio = sized ? Math.max(changed / (width * height), 1) : changed / (width * height);
  if (ratio > threshold) await sharp(mask, { raw: { width, height, channels: 4 } }).png().toFile(`${out}/${name}-diff.png`);
  return sized ? { ratio, reason: `size ${ma.width}x${ma.height} → ${mb.width}x${mb.height}` } : { ratio };
}

const plan = await api("GET", "/republish/plan");
const targets = plan.sites.filter((s) => (args.all || s.outdated) && (!only || only.includes(s.slug)));
console.log(`asset ${plan.renderVersion}: ${plan.outdated}/${plan.total} outdated, ${targets.length} to check${args.apply ? " (apply)" : ""}`);

const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
const liveContext = await browser.newContext();
// The admin token goes only on the staged HTML requests themselves, never on subresources
// (blog images and other third-party hosts must not see it).
const stagedContext = await browser.newContext();
await stagedContext.route(`${API}/staged/**`, (route) =>
  route.continue({ headers: { ...route.request().headers(), authorization: `Bearer ${TOKEN}` } }),
);
const leaks = [];
for (const context of [liveContext, stagedContext]) {
  context.on("request", (request) => {
    if (request.headers().authorization && !request.url().startsWith(`${API}/staged/`)) leaks.push(request.url());
  });
}
const report = [];
for (const site of targets) {
  const entry = { slug: site.slug, siteId: site.siteId, from: site.assetVersion, to: plan.renderVersion };
  try {
    const staged = await api("POST", `/sites/${site.siteId}/republish/stage`);
    entry.renderId = staged.renderId;
    const diffs = {};
    // Every rendered route (home, privacy) at both widths.
    for (const route of staged.routes ?? ["/"]) {
      const rel = route === "/" ? "" : route.slice(1);
      for (const [vp, viewport] of Object.entries({ mobile: { width: 390, height: 844 }, desktop: { width: 1280, height: 800 } })) {
        const key = `${rel || "home"}-${vp}`;
        const live = await shot(liveContext, `${liveUrl(site.liveUrl)}${rel}`, viewport);
        const next = await shot(stagedContext, `${API}${staged.stagedPath}${rel}`, viewport);
        diffs[key] = await diff(live, next, `${site.slug}-${key}`);
        if (diffs[key].ratio > threshold) {
          writeFileSync(`${out}/${site.slug}-${key}-live.png`, live);
          writeFileSync(`${out}/${site.slug}-${key}-staged.png`, next);
        }
      }
    }
    entry.diffs = diffs;
    entry.same = Object.values(diffs).every((d) => d.ratio <= threshold);
    if (entry.same && args.apply) {
      await api("POST", `/sites/${site.siteId}/republish/commit`, { renderId: staged.renderId });
      entry.result = "applied";
    } else {
      entry.result = entry.same ? "same (not applied)" : "review";
    }
  } catch (error) {
    entry.result = "error";
    entry.error = String(error.message ?? error);
  }
  report.push(entry);
  console.log(`${entry.result.padEnd(18)} ${site.slug} ${entry.diffs ? Object.entries(entry.diffs).map(([k, v]) => `${k} ${(v.ratio * 100).toFixed(2)}%`).join(" ") : entry.error ?? ""}`);
}
await browser.close();
writeFileSync(`${out}/report.json`, JSON.stringify({ renderVersion: plan.renderVersion, threshold, apply: Boolean(args.apply), tokenLeaks: leaks, report }, null, 2));
if (leaks.length) console.error(`admin token sent outside the staged endpoint: ${leaks.join(", ")}`);
const review = report.filter((r) => r.result === "review" || r.result === "error");
console.log(`\n${report.filter((r) => r.result === "applied").length} applied, ${review.length} need review → ${out}/report.json`);
process.exit(review.some((r) => r.result === "error") || leaks.length ? 1 : 0);
