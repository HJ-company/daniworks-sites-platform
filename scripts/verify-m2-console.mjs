// M2 step 2-9: operator console end to end in a browser (console Worker: built SPA + /api proxy).
// create → edit (form + JSON) → validate → draft → publish → rollback → photos (browser resize)
// → domain → inquiries CSV → stats → suspend/resume. No credential ever reaches the browser.
import { createRequire } from "node:module";
import { API, ROUTER_PORT, chromium, evidence, paySite, routerRequest, uploadShared } from "./lib/verify.mjs";

const sharp = createRequire(new URL("../packages/renderer/package.json", import.meta.url))("sharp");
const CONSOLE = process.env.CONSOLE_URL ?? "http://127.0.0.1:8789";
const ev = evidence("m2-console");
const { check } = ev;
const run = Date.now().toString(36);
const slug = `console-${run}`;
const host = `${slug}.localhost`;

uploadShared();
const browser = await chromium().launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] });
const page = await context.newPage();
const errors = [];
const bodies = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("response", async (res) => {
  if (/\.(js|html)$/.test(new URL(res.url()).pathname) || res.url().endsWith("/")) bodies.push(await res.text().catch(() => ""));
});
const shot = (name) => page.screenshot({ path: `${ev.dir}/${name}.png`, fullPage: true });
const toast = (text) => page.getByText(text).first().waitFor({ timeout: 15000 }).then(() => true).catch(() => false);

// 1. list
await page.goto(CONSOLE, { waitUntil: "networkidle" });
check("사이트 목록 화면", await page.getByRole("heading", { name: "사이트" }).isVisible());
check("브라우저로 내려간 HTML·JS에 관리자 토큰 없음", bodies.length > 0 && !bodies.some((b) => b.includes("dev-admin-token")));

// 2. create from the starter
await page.getByRole("link", { name: "새 사이트" }).click();
await page.locator("input[name=slug]").fill(slug);
await page.locator("input[name=name]").fill("콘솔 시험 학원");
await page.locator("input[name=phone]").fill("010-0000-0000");
await page.getByRole("button", { name: "만들기" }).click();
await page.waitForURL(/\/sites\/[^/]+\/edit$/);
const siteId = page.url().split("/").at(-2);
const editorText = () => page.locator(".cm-content").innerText();
const loaded = await page
  .waitForFunction((s) => document.querySelector(".cm-content")?.textContent?.includes(s), slug, { timeout: 15000 })
  .then(() => true)
  .catch(() => false);
check("시작 설정으로 생성 후 편집 탭, JSON에 slug", loaded && (await editorText()).includes(slug));
await shot("edit");

// 3. edit through the form, validate (error then fixed), save a draft
await page.locator('input[name="business.phone"]').fill("12");
await page.getByRole("button", { name: "검증" }).click();
const invalid = await page.getByTestId("validate-errors").textContent({ timeout: 10000 }).catch(() => "");
check("검증 오류를 경로와 함께 표시", invalid.includes("business.phone"), { invalid });
await page.locator('input[name="business.phone"]').fill("010-1234-0000");
await page.locator('input[name="business.address"]').fill("서울 노원구");
await page.getByRole("button", { name: "검증" }).click();
const fixed = await page.getByTestId("validate-ok").waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
check("수정 후 검증 통과", fixed, { errors: fixed ? null : await page.getByTestId("validate-errors").textContent().catch(() => null) });
await page.getByRole("button", { name: "초안으로 저장" }).click();
check("초안 저장(v2)", await toast("v2 초안을 저장했습니다"));

// 4. publish and roll back from the version table (M4: after a payment)
await paySite(siteId);
await page.getByTestId("tab-overview").click();
await page.getByTestId("version-1").getByRole("button", { name: "게시" }).click();
await toast("v1을 게시했습니다");
await page.getByTestId("version-2").getByRole("button", { name: "게시" }).click();
await toast("v2을 게시했습니다");
const live2 = await routerRequest(host, "/");
check("콘솔에서 게시한 v2가 공개, 주소 반영", live2.status === 200 && live2.headers["x-site-version"] === "2" && live2.body.includes("서울 노원구"));
await page.getByTestId("version-1").getByRole("button", { name: "롤백" }).click();
await toast("v1로 되돌렸습니다");
check("콘솔 롤백 → v1 공개", (await routerRequest(host, "/")).headers["x-site-version"] === "1");
const previewHref = await page.getByTestId("version-2").getByRole("link", { name: "내부 미리보기" }).getAttribute("href");
const preview = await fetch(previewHref.replace(/^https?:\/\/[^/]+/, API));
check("프리뷰 링크는 api 절대 URL이고 열림", previewHref.startsWith("http") && preview.status === 200);
await shot("overview");

// 5. photos: a 12 MP phone-sized original is downsized in the browser before upload
const big = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: "#4a8" } }).jpeg().toBuffer();
await page.getByTestId("tab-photos").click();
await page.getByTestId("photo-input").setInputFiles({ name: "phone.jpg", mimeType: "image/jpeg", buffer: big });
check("12MP 원본도 브라우저에서 줄여 업로드", await toast("1장을 올렸습니다"));
const card = await page.getByTestId("photo-card").first().textContent();
check("업로드 결과 1600×1200", card.includes("1600×1200"), { card });

// 6. domain
await page.getByTestId("tab-domains").click();
await page.locator("input[name=hostname]").fill(`www.console-${run}.co.kr`);
await page.getByRole("button", { name: "연결" }).click();
const domainCard = page.getByTestId(`domain-www.console-${run}.co.kr`);
check("도메인 등록과 CNAME 안내 표시", (await domainCard.textContent({ timeout: 10000 })).includes("connect.dsites.kr"));
await domainCard.getByRole("button", { name: "삭제" }).click();
check("도메인 삭제", await domainCard.waitFor({ state: "detached", timeout: 10000 }).then(() => true).catch(() => false));

// 7. inquiries CSV, stats
await page.getByTestId("tab-inquiries").click();
const csv = await page.request.get(`${CONSOLE}/api/sites/${siteId}/inquiries.csv`);
check("문의 CSV 내려받기(콘솔 프록시)", csv.ok() && (await csv.text()).includes("접수(한국 시간)"));
await page.getByTestId("tab-stats").click();
await page.getByTestId("metric-pageview").waitFor({ timeout: 10000 });
check("통계 카드(전환 + 7종)", (await page.locator('[data-testid^="metric-"]').count()) === 8);

// 8. suspend / resume
await page.getByTestId("tab-overview").click();
await page.getByRole("button", { name: "공개 정지" }).click();
await page.getByRole("dialog").getByRole("button", { name: "정지" }).click();
await toast("공개를 정지했습니다");
check("콘솔 공개 정지 → 503", (await routerRequest(host, "/")).status === 503);
await page.getByRole("button", { name: "공개 재개" }).click();
await toast("공개를 재개했습니다");
check("콘솔 공개 재개 → 200", (await routerRequest(host, "/")).status === 200);

// 9. list shows it; direct API without the console proxy needs the token
await page.goto(CONSOLE, { waitUntil: "networkidle" });
check("목록에 새 사이트", await page.getByTestId(`site-link-${slug}`).waitFor({ timeout: 10000 }).then(() => true).catch(() => false));
check("api 직접 호출은 토큰 없으면 401", (await fetch(`${API}/sites`)).status === 401);
check("콘솔 페이지 오류 없음", !errors.length, { errors });
await shot("list");

await browser.close();
ev.finish({ siteId, slug, router: `http://${host}:${ROUTER_PORT}/` });
