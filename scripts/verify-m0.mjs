// M0 acceptance: sample sites rendered by the Worker display and hydrate cleanly.
// Usage: start `pnpm dev` (wrangler dev on :8787), then `pnpm verify:m0`.
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const base = process.env.M0_BASE ?? "http://127.0.0.1:8787";
const sites = ["sample", "logistics", "ceramics"];
const viewports = { mobile: { width: 390, height: 844 }, desktop: { width: 1280, height: 800 } };
const out = "evidence/m0";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const results = [];
for (const site of sites) {
  for (const [vpName, viewport] of Object.entries(viewports)) {
    const page = await browser.newPage({ viewport });
    const consoleErrors = [];
    const failed = [];
    const requests = [];
    page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
    page.on("pageerror", (e) => consoleErrors.push(String(e)));
    page.on("requestfailed", (r) => failed.push(`${r.url()} ${r.failure()?.errorText}`));
    page.on("request", (r) => requests.push(r.url()));
    const response = await page.goto(`${base}/${site}`, { waitUntil: "networkidle" });
    const hydrated = await page.evaluate(() => {
      const root = document.getElementById("root");
      const container = !!root && Object.keys(root).some((k) => k.startsWith("__reactContainer"));
      const fibers = [...(root?.querySelectorAll("*") ?? [])].some((el) =>
        Object.keys(el).some((k) => k.startsWith("__reactFiber")),
      );
      return container && fibers;
    });
    // Lazy images load only near the viewport: walk the page, then return to the top.
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 400) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 100));
      }
      window.scrollTo(0, 0);
    });
    await page.waitForLoadState("networkidle");
    const unloadedImages = await page.evaluate(() =>
      [...document.images].filter((img) => !img.complete || img.naturalWidth === 0).map((img) => img.src),
    );
    // Interactivity after hydration: the mobile menu toggle is JS-driven.
    let menuToggles = null;
    if (vpName === "mobile") {
      const toggle = page.locator(".builder-navigation__toggle").first();
      if (await toggle.isVisible()) {
        await toggle.click();
        menuToggles = (await toggle.getAttribute("aria-expanded")) === "true";
      }
    }
    const external = requests.filter((u) => !u.startsWith(base));
    if (menuToggles) await page.locator(".builder-navigation__toggle").first().click();
    await page.screenshot({ path: `${out}/${site}-${vpName}.png`, fullPage: true });
    const result = {
      site,
      viewport: vpName,
      status: response?.status(),
      serverTiming: response?.headers()["server-timing"],
      hydrated,
      consoleErrors,
      failed,
      external,
      unloadedImages,
      menuToggles,
    };
    result.pass =
      result.status === 200 && hydrated && !consoleErrors.length && !failed.length && !external.length &&
      !unloadedImages.length &&
      menuToggles !== false;
    results.push(result);
    console.log(`${result.pass ? "PASS" : "FAIL"} ${site} ${vpName} ${result.serverTiming ?? ""}`);
    if (!result.pass) console.log(JSON.stringify(result, null, 2));
    await page.close();
  }
}
await browser.close();
writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 2));
process.exit(results.every((r) => r.pass) ? 0 : 1);
