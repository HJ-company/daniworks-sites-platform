// Shared helpers for scripts/verify-*.mjs. Runs on a dev machine or in the Docker `verify` service.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export const API = process.env.API_URL ?? "http://127.0.0.1:8788";
export const ROUTER_PORT = process.env.ROUTER_PORT ?? "8787";
export const TOKEN = process.env.ADMIN_TOKEN ?? "dev-admin-token";

export function evidence(step) {
  const dir = `evidence/${step}`;
  mkdirSync(dir, { recursive: true });
  const results = [];
  return {
    dir,
    results,
    check(name, pass, detail = {}) {
      results.push({ name, pass: Boolean(pass), ...detail });
      console.log(`${pass ? "PASS" : "FAIL"} ${name}${Object.keys(detail).length ? " " + JSON.stringify(detail) : ""}`);
      return Boolean(pass);
    },
    finish(extra = {}) {
      writeFileSync(`${dir}/results.json`, JSON.stringify({ ...extra, results }, null, 2));
      const failed = results.filter((r) => !r.pass).length;
      console.log(`\n${results.length - failed}/${results.length} passed`);
      process.exit(failed ? 1 : 0);
    },
  };
}

export async function api(method, path, body, { auth = true, headers = {} } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...(auth ? { authorization: `Bearer ${TOKEN}` } : {}), "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data, headers: res.headers, text };
}

/** Request to the router with a Host header (Node cannot resolve *.localhost). */
export function routerRequest(host, path = "/", { method = "GET", body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port: ROUTER_PORT, path, method, headers: { host: `${host}:${ROUTER_PORT}`, ...headers } },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (text += c));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: text }));
      },
    );
    req.on("error", reject);
    if (body !== undefined) req.write(typeof body === "string" ? body : JSON.stringify(body));
    req.end();
  });
}

export function uploadShared() {
  execFileSync("node", ["scripts/upload-shared.mjs"], {
    stdio: "inherit",
    env: { ...process.env, API_URL: API, ADMIN_TOKEN: TOKEN },
  });
}

export function chromium() {
  return require("playwright").chromium;
}

export const viewports = { mobile: { width: 390, height: 844 }, desktop: { width: 1280, height: 800 } };

/**
 * Opens a page, scrolls it to trigger lazy images and reports hydration, console errors,
 * failed and external requests. `allowExternal` lists URL prefixes that may be requested.
 */
export async function inspectPage(browser, url, viewport, { screenshot, allowExternal = [] } = {}) {
  const page = await browser.newPage({ viewport });
  const origin = new URL(url).origin;
  const errors = [];
  const failed = [];
  const external = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("requestfailed", (r) => failed.push(r.url()));
  page.on("request", (r) => {
    const u = r.url();
    if (!u.startsWith(origin) && !u.startsWith("data:") && !allowExternal.some((p) => u.startsWith(p))) external.push(u);
  });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 400) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 80));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForLoadState("networkidle");
  const state = await page.evaluate(() => {
    const root = document.getElementById("root");
    return {
      hydrated:
        !!root &&
        Object.keys(root).some((k) => k.startsWith("__reactContainer")) &&
        [...root.querySelectorAll("*")].some((el) => Object.keys(el).some((k) => k.startsWith("__reactFiber"))),
      unloadedImages: [...document.images].filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.src),
    };
  });
  if (screenshot) await page.screenshot({ path: screenshot, fullPage: true });
  return { page, errors, failed, external, ...state };
}

/** Lighthouse (mobile, simulated throttling) with Playwright's Chromium. */
export async function lighthouse(url) {
  const { default: run } = await import("lighthouse");
  const chromeLauncher = await import("chrome-launcher");
  const chrome = await chromeLauncher.launch({
    chromePath: chromium().executablePath(),
    chromeFlags: ["--headless=new", "--no-sandbox", "--disable-gpu"],
  });
  try {
    const result = await run(url, {
      port: chrome.port,
      output: "json",
      logLevel: "error",
      onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
    });
    const lhr = result.lhr;
    const score = (c) => Math.round((lhr.categories[c]?.score ?? 0) * 100);
    return {
      performance: score("performance"),
      accessibility: score("accessibility"),
      bestPractices: score("best-practices"),
      seo: score("seo"),
      lcpMs: Math.round(lhr.audits["largest-contentful-paint"]?.numericValue ?? 0),
      cls: Number((lhr.audits["cumulative-layout-shift"]?.numericValue ?? 0).toFixed(3)),
      tbtMs: Math.round(lhr.audits["total-blocking-time"]?.numericValue ?? 0),
      report: lhr,
    };
  } finally {
    await chrome.kill();
  }
}
