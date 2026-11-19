// M4 step 4-C: customer draft links. One link per site at <PREVIEW_ORIGIN>/preview/<token>
// (served by the router on the bare base domain), always the latest version, 30 days, with a
// draft banner, no inquiries and no tracking. Reissue and revoke stop the old link.
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { API, ROUTER_PORT, TOKEN, api, chromium, evidence, inspectPage, localD1, routerRequest, uploadShared, viewports, consoleLogin, CONSOLE } from "./lib/verify.mjs";

const { fieldFixture } = await import("../packages/renderer/src/templates/service-local/fixtures.ts");
const ev = evidence("m4-draft-links");
const { check } = ev;
const run = Date.now().toString(36);
uploadShared();

const config = { ...structuredClone(fieldFixture), slug: `draft-${run}` };
config.business.name = `시안청소 ${run}`;
const siteId = (await api("POST", "/sites", { config, createdBy: "operator" })).data.siteId;
const draftPath = (url) => new URL(url).pathname;
const open = (url, path = "") => routerRequest("localhost", `${draftPath(url)}${path}`);

// 1. issue
check("처음에는 시안 링크 없음", (await api("GET", `/sites/${siteId}`)).data.site.draft_link === null);
const issued = (await api("POST", `/sites/${siteId}/draft-link`)).data.draftLink;
const days = (Date.parse(issued.expiresAt) - Date.now()) / 86_400_000;
check("발급: 기본 도메인의 /preview/<40자>, 30일", /^http:\/\/localhost:8787\/preview\/[a-f0-9]{40}$/.test(issued.url) && days > 29.9 && days <= 30, issued);
check("상세에 시안 링크, 토큰 원문 필드는 없음", (await api("GET", `/sites/${siteId}`)).data.site.draft_link?.url === issued.url &&
  !("preview_token" in (await api("GET", `/sites/${siteId}`)).data.site));

// 2. served by the router: banner, noindex, no cache, inquiry notice, internal links stay inside
const home = await open(issued.url);
check("라우터가 시안 제공(게시 전·입금 전에도)", home.status === 200 && home.body.includes(config.business.name));
check("시안 배너, noindex(메타·헤더), 캐시 안 함", home.body.includes("시안입니다. 아직 공개되지 않은 페이지입니다.") &&
  home.body.includes('content="noindex, nofollow"') && home.headers["x-robots-tag"] === "noindex, nofollow" && home.headers["cache-control"] === "no-store");
check("문의 폼에 '시안에서는 문의가 전송되지 않습니다'", home.body.includes("시안에서는 문의가 전송되지 않습니다"));
check("사이트 안 링크는 시안 경로 안에서(로고는 시안 첫 화면, 경로 중복 없음)", home.body.includes(`${draftPath(issued.url)}/privacy`) &&
  home.body.includes(`href="${draftPath(issued.url)}/"`) && !home.body.includes(`${draftPath(issued.url)}${draftPath(issued.url)}`));
check("시안 띠 아래로 사이트 머리글을 내림", home.body.includes(".builder-navigation{top:40px!important}"));
const privacy = await open(issued.url, "/privacy");
check("하위 페이지(개인정보처리방침)도 배너와 함께", privacy.status === 200 && privacy.body.includes("시안입니다"));
check("없는 하위 페이지는 안내 404", (await open(issued.url, "/nope")).status === 404);
const asset = home.body.match(/\/_shared\/[^"]+\.js/)?.[0]; // CSS is inlined; the client bundle still comes from /_shared
check("공용 자산을 같은 주소에서 받음", asset && (await routerRequest("localhost", asset)).status === 200, { asset });

// 3. always the latest version
const v2 = structuredClone(config);
v2.content.hero.heading = `두 번째 시안 ${run}`;
await api("POST", `/sites/${siteId}/versions`, { config: v2, createdBy: "operator" });
check("시안을 고치면 같은 링크에 최신 버전", (await open(issued.url)).body.includes(`두 번째 시안 ${run}`));

// 4. in a browser: banner visible, the form does not send, no tracking beacon, hydrated
const browser = await chromium().launch();
const visit = await inspectPage(browser, issued.url, viewports.mobile, { screenshot: `${ev.dir}/draft-mobile.png` });
const beacons = [];
visit.page.on("request", (r) => r.url().includes("/api/") && beacons.push(r.url()));
check("브라우저: 배너 보임, 하이드레이션, 오류 없음", (await visit.page.getByText("시안입니다. 아직 공개되지 않은 페이지입니다.").isVisible()) &&
  visit.hydrated && !visit.errors.length, { errors: visit.errors });
const form = visit.page.locator("form").last();
await form.locator("input[name=name]").fill("시험");
await form.locator("input[name=phone]").fill("010-1234-5678");
await form.locator("textarea").first().fill("시안 문의 시험");
await form.locator("input[name=consent]").check();
check("브라우저: 폼에 미리 전송 안 됨 안내", await visit.page.locator("[data-draft-notice]").isVisible());
await form.getByRole("button", { name: "문의 보내기" }).click();
check("브라우저: 문의 보내기 → 전송 안 됨 안내, 요청 없음", (await visit.page.getByRole("alert").textContent({ timeout: 5000 }).catch(() => "")).includes("시안에서는") &&
  !beacons.some((u) => u.includes("/api/inquiry")));
await visit.page.reload({ waitUntil: "networkidle" });
check("브라우저: 방문 수집 비콘 없음", !beacons.some((u) => u.includes("/api/track")), { beacons });
check("시안 열람은 방문 통계에 안 잡힘", ((await api("GET", `/sites/${siteId}/metrics`)).data.totals.pageview ?? 0) === 0);
await visit.page.close();

// 5. reissue, revoke, expiry, cancellation, bad tokens
const reissued = (await api("POST", `/sites/${siteId}/draft-link`)).data.draftLink;
const old = await open(issued.url);
check("새 링크로 바꾸면 예전 링크는 안내 404, 새 링크는 열림", reissued.url !== issued.url && old.status === 404 && old.body.includes("최신 링크") &&
  (await open(reissued.url)).status === 200);
localD1(`UPDATE sites SET preview_expires_at = '2000-01-01T00:00:00.000Z' WHERE id = '${siteId}'`);
const expired = await open(reissued.url);
check("만료된 링크는 410 안내", expired.status === 410 && expired.body.includes("만료") && (await api("GET", `/sites/${siteId}`)).data.site.draft_link.expired === true);
await api("DELETE", `/sites/${siteId}/draft-link`);
check("링크 막기 → 404, 상세에 링크 없음", (await open(reissued.url)).status === 404 && (await api("GET", `/sites/${siteId}`)).data.site.draft_link === null);
check("형식이 틀린 토큰은 404", (await routerRequest("localhost", "/preview/abc")).status === 404 && (await routerRequest("localhost", "/preview/../x")).status === 404);
const third = (await api("POST", `/sites/${siteId}/draft-link`)).data.draftLink;
await api("POST", `/sites/${siteId}/cancel`);
check("해지된 사이트의 시안은 410", (await open(third.url)).status === 410);
check("해지된 사이트는 링크 발급 409", (await api("POST", `/sites/${siteId}/draft-link`)).status === 409);
check("시안 경로는 기본 도메인에서만(고객 사이트 주소에선 아님)", (await routerRequest(`${config.slug}.localhost`, draftPath(third.url))).status !== 200);

// 6. MCP: site_preview_link creates or returns the link, reissue on request
const client = new Client({ name: "verify-m4-draft", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(`${API}/mcp`), { requestInit: { headers: { authorization: `Bearer ${TOKEN}` } } }));
const call = async (name, args) => {
  const result = await client.callTool({ name, arguments: args });
  return { isError: Boolean(result.isError), data: result.structuredContent ?? JSON.parse(result.content?.[0]?.text ?? "{}") };
};
const mcpConfig = { ...structuredClone(fieldFixture), slug: `draft-mcp-${run}` };
await api("POST", "/sites", { config: mcpConfig, createdBy: "ai" });
const first = await call("site_preview_link", { site: mcpConfig.slug });
const again = await call("site_preview_link", { site: mcpConfig.slug });
const fresh = await call("site_preview_link", { site: mcpConfig.slug, reissue: true });
check("MCP site_preview_link: 없으면 만들고, 다시 부르면 같은 링크, reissue면 새 링크", !first.isError && first.data.url.includes("/preview/") &&
  again.data.url === first.data.url && again.data.reissued === false && fresh.data.url !== first.data.url, { first: first.data, again: again.data });
check("MCP 링크도 라우터에서 열림", (await open(fresh.data.url)).status === 200);
await client.close();

// 7. console card
const consoleConfig = { ...structuredClone(fieldFixture), slug: `draft-ui-${run}` };
consoleConfig.business.name = `시안화면 ${run}`;
const uiSite = (await api("POST", "/sites", { config: consoleConfig, createdBy: "operator" })).data.siteId;
const starter = (await api("POST", "/sites", { starter: { preset: "field", slug: `draft-todo-${run}`, name: "작성중청소", phone: "010-1111-2222" }, createdBy: "operator" })).data.siteId;
check("시작 설정으로 만든 사이트: 채울 문구 개수", (await api("GET", `/sites/${starter}`)).data.site.draft_todos > 0 &&
  (await api("GET", `/sites/${uiSite}`)).data.site.draft_todos === 0);
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] });
const page = await context.newPage();
await consoleLogin(page);
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(`${CONSOLE}/sites/${uiSite}`, { waitUntil: "networkidle" });
const card = page.getByTestId("draft-link-card");
await card.getByRole("button", { name: "시안 링크 만들기" }).click();
const shownUrl = await card.getByTestId("draft-link-url").textContent({ timeout: 10000 });
check("콘솔: 시안 링크 만들기 → 주소와 만료일 표시", /\/preview\/[a-f0-9]{40}$/.test(shownUrl) && (await card.textContent()).includes("까지 열림"));
await card.getByRole("button", { name: "안내문 복사" }).click();
const message = await page.evaluate(() => navigator.clipboard.readText());
check("콘솔: 사장님께 보낼 안내문에 상호·링크·만료일", message.includes(consoleConfig.business.name) && message.includes(shownUrl) && message.includes("까지 열립니다"), { message });
await page.screenshot({ path: `${ev.dir}/console-card.png`, fullPage: true });
await card.getByRole("button", { name: "새 링크로 바꾸기" }).click();
await page.getByRole("dialog").getByRole("button", { name: "바꾸기" }).click();
await page.getByText("시안 링크를 만들었습니다").first().waitFor({ timeout: 10000 }).catch(() => undefined);
await page.waitForTimeout(500);
const replaced = await card.getByTestId("draft-link-url").textContent();
check("콘솔: 새 링크로 바꾸기(확인 창) → 주소 바뀜, 예전 링크 막힘", replaced !== shownUrl && (await open(shownUrl)).status === 404);
check("콘솔: 버전 표의 미리보기는 내부용으로 표시", (await page.getByRole("link", { name: "내부 미리보기" }).count()) > 0);

// The owner asks for a new headline: edit it in the form, save, the same link shows it.
await page.goto(`${CONSOLE}/sites/${uiSite}/edit`, { waitUntil: "networkidle" });
await page.locator('textarea[name="content.hero.heading"]').fill(`주말에도 레슨합니다 ${run}`);
await page.getByRole("button", { name: "초안으로 저장" }).click();
await page.getByText("초안을 저장했습니다").first().waitFor({ timeout: 10000 });
check("편집 폼에서 첫 화면 큰 제목을 바꾸면 같은 시안 링크에 반영", (await open(replaced)).body.includes(`주말에도 레슨합니다 ${run}`));

await page.goto(`${CONSOLE}/sites/${starter}`, { waitUntil: "networkidle" });
check("콘솔: 채우지 않은 문구가 있으면 시안 카드에 경고", (await page.getByTestId("draft-todos").textContent({ timeout: 10000 })).includes("(작성 필요)"));
check("콘솔 페이지 오류 없음", !errors.length, { errors });
await browser.close();

ev.finish({ router: `http://localhost:${ROUTER_PORT}` });
