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
/** M4: nothing is published before a payment. Records one so a test site may go public. */
export async function paySite(siteId) {
  const paid = await api("POST", `/sites/${siteId}/payments`, { payerName: "검증" });
  if (paid.status !== 201) throw new Error(`payment for ${siteId}: ${paid.status} ${JSON.stringify(paid.data)}`);
  return paid.data;
}

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

/**
 * Lighthouse (mobile, simulated throttling), median of `runs` by performance score as
 * Lighthouse recommends: single runs vary with host CPU load (TBT especially).
 */
export async function lighthouse(url, runs = 3) {
  const all = [];
  for (let i = 0; i < runs; i++) all.push(await lighthouseOnce(url));
  const ok = all.filter((r) => !r.error).sort((a, b) => a.performance - b.performance);
  const median = ok[Math.floor(ok.length / 2)] ?? all[0];
  return { ...median, runs: all.map((r) => r.error ?? r.performance) };
}

async function lighthouseOnce(url) {
  const { default: run } = await import("lighthouse");
  const chromeLauncher = await import("chrome-launcher");
  const chrome = await chromeLauncher.launch({
    chromePath: chromium().executablePath(),
    chromeFlags: ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
  });
  try {
    const result = await run(url, {
      port: chrome.port,
      output: "json",
      logLevel: "error",
      onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
    });
    const lhr = result.lhr;
    if (lhr.runtimeError) return { error: lhr.runtimeError.code, performance: 0, report: lhr };
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

/** Reads or writes the router's local KV namespace (Docker: shared /state volume). */
export function localKv(action, key, value) {
  const args = ["exec", "wrangler", "kv", "key", action, key, ...(value !== undefined ? [value] : []), "--binding", "ROUTES", "--local", "--persist-to", process.env.STATE_DIR ?? "/state"];
  if (action === "get") args.push("--text");
  try {
    const out = execFileSync("pnpm", args, { cwd: "apps/router", encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    // wrangler prints this and exits 0 for a missing key.
    return action === "get" && out === "Value not found" ? "" : out;
  } catch (error) {
    // A missing key exits non-zero; reads report it as empty.
    if (action === "get" && /not found/i.test(String(error.stderr ?? error.stdout ?? ""))) return "";
    throw error;
  }
}

/** Runs SQL against the API's local D1 (Docker: shared /state volume). Returns result rows. */
export function localD1(sql) {
  const out = execFileSync(
    "pnpm",
    ["exec", "wrangler", "d1", "execute", "DB", "--local", "--persist-to", process.env.STATE_DIR ?? "/state", "--command", sql, "--json"],
    { cwd: "apps/api", encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return JSON.parse(out)[0]?.results ?? [];
}
