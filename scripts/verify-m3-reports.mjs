// M3 step 3-2: quarterly reports. Seeded daily counters across two quarters → site report
// (totals, previous quarter, monthly), CSV, all-sites overview, and the console screens.
import { API, TOKEN, api, chromium, evidence, localD1, uploadShared, paySite } from "./lib/verify.mjs";

const { fieldFixture } = await import("../packages/renderer/src/templates/service-local/fixtures.ts");
const CONSOLE = process.env.CONSOLE_URL ?? "http://127.0.0.1:8789";
const ev = evidence("m3-reports");
const { check } = ev;
const run = Date.now().toString(36);

uploadShared();
const created = await api("POST", "/sites", { config: { ...structuredClone(fieldFixture), slug: `rep-${run}` }, createdBy: "operator" });
const siteId = created.data.siteId;
await paySite(siteId);

// Q3 2026: 10 visits + 2 calls; Q4 2026: Oct 30 visits + 3 calls + 1 kakao, Dec 20 visits + 2 inquiries
const seed = [
  ["2026-08-15", "pageview", 10], ["2026-09-30", "tel", 2],
  ["2026-10-01", "pageview", 30], ["2026-10-31", "tel", 3], ["2026-10-15", "kakao", 1],
  ["2026-12-31", "pageview", 20], ["2026-12-01", "inquiry", 2],
  ["2027-01-01", "pageview", 99],
];
localD1(
  `INSERT INTO metrics_daily (site_id, date, event, count) VALUES ${seed.map(([d, e, n]) => `('${siteId}', '${d}', '${e}', ${n})`).join(", ")}`,
);

const report = (await api("GET", `/sites/${siteId}/reports/quarterly?quarter=2026-Q4`)).data;
check("분기 합계(경계일 포함, 다음 분기 제외)", report.totals.pageview === 50 && report.totals.tel === 3 && report.totals.kakao === 1 && report.totals.inquiry === 2, report.totals);
check("전환 = 전화+카톡+지도+예약+문의", report.conversions === 6 && report.previous.conversions === 2);
check("직전 분기(Q3) 비교", report.previous.quarter === "2026-Q3" && report.previous.totals.pageview === 10 && report.previous.totals.tel === 2);
check("월별 3행", report.monthly.length === 3 && report.monthly[0].month === "2026-10" && report.monthly[0].pageview === 30 && report.monthly[1].pageview === 0 && report.monthly[2].inquiry === 2);
check("잘못된 분기는 400", (await api("GET", `/sites/${siteId}/reports/quarterly?quarter=2026-Q9`)).status === 400);

const csvRes = await fetch(`${API}/sites/${siteId}/reports/quarterly.csv?quarter=2026-Q4`, { headers: { authorization: `Bearer ${TOKEN}` } });
const csvBytes = new Uint8Array(await csvRes.arrayBuffer());
const csv = new TextDecoder("utf-8", { ignoreBOM: true }).decode(csvBytes).replace(/^﻿/, "");
const lines = csv.trim().split("\r\n");
check("CSV: BOM, 헤더+월 3+합계 2", csvBytes[0] === 0xef && lines.length === 6 && lines[0].startsWith("기간,방문,전화") && lines[4].startsWith("2026-Q4 합계,50,3,1"), { lines });

const overview = (await api("GET", "/reports/quarterly?quarter=2026-Q4")).data;
const mine = overview.sites.find((s) => s.id === siteId);
check("전체 사이트 개요에 이 사이트 합계", mine?.totals.pageview === 50 && mine.totals.inquiry === 2 && overview.sites.length >= 1);

// console
const browser = await chromium().launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(`${CONSOLE}/sites/${siteId}/stats`, { waitUntil: "networkidle" });
await page.getByTestId("quarter").click().catch(() => undefined);
await page.getByRole("option", { name: "2026-Q4" }).click().catch(() => undefined);
await page.getByTestId("metric-conversions").getByText("6").waitFor({ timeout: 10000 }).catch(() => undefined);
const conv = await page.getByTestId("metric-conversions").textContent();
const monthly = await page.getByTestId("monthly").textContent();
await page.screenshot({ path: `${ev.dir}/stats.png`, fullPage: true });
check("콘솔 통계: 분기 선택, 전환 6·직전 대비, 월별 표", conv.includes("6") && conv.includes("+200%") && monthly.includes("2026-12"), { conv });
await page.goto(`${CONSOLE}/reports`, { waitUntil: "networkidle" });
check("콘솔 분기 리포트 화면에 사이트 행", await page.getByRole("link", { name: `rep-${run}` }).waitFor({ timeout: 10000 }).then(() => true).catch(() => false));
// Drill-down keeps a historical quarter.
await page.goto(`${CONSOLE}/reports?quarter=2026-Q3`, { waitUntil: "networkidle" });
await page.getByRole("link", { name: `rep-${run}` }).click();
await page.waitForURL(/\/stats\?quarter=2026-Q3$/);
await page.getByTestId("metric-conversions").waitFor();
const q3 = await page.getByTestId("metric-conversions").textContent();
check("과거 분기에서 사이트로 들어가도 같은 분기(Q3 전환 2)", page.url().endsWith("quarter=2026-Q3") && q3.includes("2"), { q3, url: page.url() });
await browser.close();

ev.finish({ siteId });
