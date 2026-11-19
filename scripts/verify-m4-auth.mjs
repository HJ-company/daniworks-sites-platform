// M4 step 4-D: Authentik login for the console (OIDC code + PKCE in the console Worker) and
// OAuth for MCP (RFC 9728 discovery → authorize → token → tools), operator group required, and
// an audit trail naming who did what. Locally Authentik is docker/oidc-mock.mjs on :8791.
import { createHash, randomBytes } from "node:crypto";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { API, CONSOLE, TOKEN, api, chromium, consoleLogin, evidence, uploadShared } from "./lib/verify.mjs";

const { fieldFixture } = await import("../packages/renderer/src/templates/service-local/fixtures.ts");
const OIDC = process.env.OIDC_URL ?? "http://127.0.0.1:8791";
const ev = evidence("m4-auth");
const { check } = ev;
const run = Date.now().toString(36);
uploadShared();

const b64url = (buf) => Buffer.from(buf).toString("base64url");

/** What an MCP client (Claude, ChatGPT) does: discover, authorize with PKCE, exchange the code. */
async function mcpToken(user, { clientSecret = "dev-mcp-secret" } = {}) {
  const challenge401 = await fetch(`${API}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  const metadataUrl = /resource_metadata="([^"]+)"/.exec(challenge401.headers.get("www-authenticate") ?? "")?.[1];
  const resource = await (await fetch(metadataUrl)).json();
  const issuer = resource.authorization_servers[0];
  const server = await (await fetch(`${issuer}/.well-known/oauth-authorization-server`)).json();
  const verifier = b64url(randomBytes(32));
  const redirectUri = "http://localhost:6274/oauth/callback";
  const authorize = await fetch(server.authorization_endpoint, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      response_type: "code",
      client_id: "dsites-mcp",
      redirect_uri: redirectUri,
      state: "s1",
      scope: "openid profile email offline_access",
      code_challenge: b64url(createHash("sha256").update(verifier).digest()),
      code_challenge_method: "S256",
      resource: resource.resource,
      user,
    }),
  });
  const code = new URL(authorize.headers.get("location")).searchParams.get("code");
  const token = await fetch(server.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${Buffer.from(`dsites-mcp:${clientSecret}`).toString("base64")}` },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: verifier }),
  });
  return { status: token.status, body: await token.json(), challenge401, resource, server };
}

// 1. MCP OAuth discovery and a tool call as a person
const kim = await mcpToken("kim");
check("MCP: 토큰 없으면 401 + WWW-Authenticate(resource_metadata)", kim.challenge401.status === 401 &&
  /Bearer resource_metadata="[^"]+\/\.well-known\/oauth-protected-resource\/mcp"/.test(kim.challenge401.headers.get("www-authenticate")));
check("MCP: 보호 자원 메타데이터 → Authentik(목업) 인가 서버", kim.resource.resource === `${API}/mcp` && kim.resource.authorization_servers[0] === OIDC);
check("MCP: 인가 서버 메타데이터(PKCE S256)", kim.server.code_challenge_methods_supported?.includes("S256") && kim.server.token_endpoint.startsWith(OIDC));
check("MCP: 코드 + PKCE로 토큰 발급(aud=dsites-mcp, groups)", kim.status === 200 && kim.body.access_token &&
  (() => {
    const claims = JSON.parse(Buffer.from(kim.body.access_token.split(".")[1], "base64url").toString());
    return claims.aud === "dsites-mcp" && claims.groups.includes("operator") && claims.iss === OIDC;
  })());
check("MCP: 잘못된 클라이언트 비밀은 토큰 거부", (await mcpToken("kim", { clientSecret: "wrong" })).status === 401);

const config = { ...structuredClone(fieldFixture), slug: `auth-${run}` };
config.business.name = `인증청소 ${run}`;
const siteId = (await api("POST", "/sites", { config, createdBy: "operator" })).data.siteId;
const client = new Client({ name: "verify-m4-auth", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(`${API}/mcp`), { requestInit: { headers: { authorization: `Bearer ${kim.body.access_token}` } } }));
const tools = (await client.listTools()).tools.map((t) => t.name);
const link = await client.callTool({ name: "site_preview_link", arguments: { site: config.slug } });
check("MCP: 운영자 토큰으로 도구 목록·호출", tools.includes("site_publish") && !link.isError);
const refused = await client.callTool({ name: "site_publish", arguments: { site: config.slug } });
const invalid = await client.callTool({ name: "site_rollback", arguments: { site: config.slug } }).catch((error) => ({ isError: true, error }));
await client.close();
check("사이트 생성도 그 사이트의 작업 기록에(스크립트 생성)", (await api("GET", `/sites/${siteId}/audit`)).data.entries.some((e) => e.action === "POST /sites" && e.actor_type === "script"));
check("MCP: 입력 검증에 걸린 호출도 거부로 기록", invalid.isError &&
  (await api("GET", `/sites/${siteId}/audit`)).data.entries.some((e) => e.action === "MCP site_rollback" && e.status === 422));
check("MCP: 입금 전 게시는 도구 오류, 작업 기록에 거부로 남음", refused.isError &&
  (await api("GET", `/sites/${siteId}/audit`)).data.entries.some((e) => e.action === "MCP site_publish" && e.status === 422 && e.actor_name === "김운영"));
const audit = async () => (await api("GET", `/sites/${siteId}/audit`)).data.entries;

// 2. refused tokens
const guest = await mcpToken("guest");
const guestMcp = await fetch(`${API}/mcp`, { method: "POST", headers: { authorization: `Bearer ${guest.body.access_token}`, "content-type": "application/json" }, body: "{}" });
const guestApi = await fetch(`${API}/sites`, { headers: { authorization: `Bearer ${guest.body.access_token}` } });
check("operator 그룹이 아니면 403(MCP·API)", guestMcp.status === 403 && guestApi.status === 403 && (await guestApi.json()).error.includes("운영자 권한"));
const [h, p] = kim.body.access_token.split(".");
const forged = `${h}.${b64url(JSON.stringify({ ...JSON.parse(Buffer.from(p, "base64url").toString()), name: "가짜" }))}.${kim.body.access_token.split(".")[2]}`;
check("서명이 맞지 않는 토큰은 401", (await fetch(`${API}/sites`, { headers: { authorization: `Bearer ${forged}` } })).status === 401);
check("모르는 발급자·형식의 토큰은 401", (await fetch(`${API}/sites`, { headers: { authorization: "Bearer not-a-jwt" } })).status === 401);
await fetch(`${OIDC}/__mock/ttl?seconds=1`, { method: "POST" });
const short = await mcpToken("kim");
await fetch(`${OIDC}/__mock/ttl?seconds=900`, { method: "POST" });
await new Promise((r) => setTimeout(r, 2500));
check("만료된 토큰은 401", (await fetch(`${API}/sites`, { headers: { authorization: `Bearer ${short.body.access_token}` } })).status === 401);
check("스크립트 고정 토큰은 계속 동작", (await fetch(`${API}/sites`, { headers: { authorization: `Bearer ${TOKEN}` } })).status === 200);

// 3. console login
const browser = await chromium().launch();
const anon = await browser.newPage();
await anon.goto(CONSOLE, { waitUntil: "domcontentloaded" });
const loginUrl = new URL(anon.url());
check("콘솔: 로그인 전에는 Authentik으로(코드 + PKCE S256, 콘솔 클라이언트)", loginUrl.origin === OIDC && loginUrl.pathname === "/authorize" &&
  loginUrl.searchParams.get("client_id") === "dsites-console" && loginUrl.searchParams.get("code_challenge_method") === "S256" &&
  loginUrl.searchParams.get("redirect_uri") === `${CONSOLE}/auth/callback`);
const apiAnon = await fetch(`${CONSOLE}/api/sites`);
check("콘솔 /api: 로그인 없으면 401(로그인 안내)", apiAnon.status === 401 && (await apiAnon.json()).login === "/auth/login");
await anon.locator('button[value="guest"]').click();
await anon.waitForLoadState("domcontentloaded");
check("콘솔: operator가 아니면 권한 없음 안내(세션 없음)", (await anon.content()).includes("운영자 권한이 없습니다") &&
  !(await anon.context().cookies()).some((c) => c.name === "dsites_session"));
await anon.close();

const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await consoleLogin(page, "kim");
await page.goto(`${CONSOLE}/sites/${siteId}`, { waitUntil: "networkidle" });
const session = (await context.cookies()).find((c) => c.name === "dsites_session");
check("콘솔: 로그인하면 이름 표시, 세션 쿠키는 HttpOnly", (await page.getByTestId("signed-in").textContent()) === "김운영" && session?.httpOnly === true &&
  !(await page.evaluate(() => document.cookie)).includes("dsites_session"));
check("콘솔: 페이지에 토큰이 노출되지 않음", !(await page.content()).includes("eyJ") && !(await page.content()).includes(TOKEN));

// Payment and publish from the console are recorded as 김운영.
await page.getByTestId("subscription-card").getByRole("button", { name: "입금 확인" }).click();
await page.getByRole("dialog").getByRole("button", { name: "입금 확인" }).click();
await page.getByText("입금을 확인했습니다").first().waitFor({ timeout: 15000 });
await page.getByTestId("version-1").getByRole("button", { name: "게시" }).click();
await page.getByText("v1을 게시했습니다").first().waitFor({ timeout: 15000 });
const entries = await audit();
check("작업 기록: 콘솔 입금·게시는 김운영(콘솔), MCP 시안 링크는 김운영(MCP)", entries.some((e) => e.action === "POST /sites/:id/publish" && e.actor_name === "김운영" && e.via === "console") &&
  entries.some((e) => e.action === "POST /sites/:id/payments" && e.actor_name === "김운영") &&
  entries.some((e) => e.action === "MCP site_preview_link" && e.actor_name === "김운영" && e.via === "mcp"), { entries: entries.slice(0, 6) });
const payments = (await api("GET", `/sites/${siteId}/subscription`)).data.payments;
check("입금 확인자는 로그인한 운영자", payments[0]?.confirmed_by === "김운영");
await api("PATCH", `/payments/${payments[0].id}`, { memo: "계좌 입금" });
check("결제 기록 수정도 그 사이트의 작업 기록에", (await audit()).some((e) => e.action === "PATCH /payments/:id"));
await api("POST", `/sites/${siteId}/suspend`);
check("스크립트 작업은 스크립트로 기록, 거부된 작업도 기록", (await audit()).some((e) => e.actor_type === "script" && e.action === "POST /sites/:id/suspend") &&
  (await api("POST", `/sites/${siteId}/rollback`, { versionId: "nope" })).status === 404 &&
  (await audit()).some((e) => e.action === "POST /sites/:id/rollback" && e.status === 404));
await api("POST", `/sites/${siteId}/resume`);
// Replacing the draft link is told apart from issuing it.
await page.goto(`${CONSOLE}/sites/${siteId}`, { waitUntil: "networkidle" });
await page.getByTestId("draft-link-card").getByRole("button", { name: "새 링크로 바꾸기" }).click();
await page.getByRole("dialog").getByRole("button", { name: "바꾸기" }).click();
await page.getByText("시안 링크를 만들었습니다").first().waitFor({ timeout: 10000 });
check("버전 표: 만든 방식과 사람(스크립트로 생성)", (await page.getByTestId("version-1").textContent()).includes("스크립트"));
await page.goto(`${CONSOLE}/sites/${siteId}/activity`, { waitUntil: "networkidle" });
const activity = await page.getByTestId("activity-card").textContent();
check("작업 기록 탭: 누가 무엇을(재발급 구분)", activity.includes("김운영") && activity.includes("게시") && activity.includes("스크립트") &&
  activity.includes("AI 도구") && activity.includes("시안 링크 새로 바꿈"), { activity });
await page.screenshot({ path: `${ev.dir}/activity.png`, fullPage: true });
await page.goto(`${CONSOLE}/payments?tab=history`, { waitUntil: "networkidle" });
await page.getByTestId(`edit-${payments[0].id}`).click();
check("결제 수정 창: 누가 언제 입금을 확인했는지", (await page.getByTestId("payment-confirmed-by").textContent()).startsWith("김운영이(가)"));
await page.getByRole("dialog").getByRole("button", { name: "닫기" }).click();

// 4. the console refreshes an expiring access token on its own
await fetch(`${OIDC}/__mock/ttl?seconds=30`, { method: "POST" });
const fresh = await browser.newContext();
const lee = await fresh.newPage();
await consoleLogin(lee, "lee");
const before = (await fresh.cookies()).find((c) => c.name === "dsites_session")?.value;
const viaConsole = await lee.evaluate(async () => (await fetch("/api/sites")).status);
const after = (await fresh.cookies()).find((c) => c.name === "dsites_session")?.value;
// Parallel requests while renewing: none may fail (one rotates the refresh token, the rest
// keep using the still-valid access token).
const parallel = await lee.evaluate(async () => Promise.all(Array.from({ length: 6 }, () => fetch("/api/sites").then((r) => r.status))));
check("콘솔: 갱신 중 동시 요청도 모두 성공", parallel.every((code) => code === 200), { parallel });
await fetch(`${OIDC}/__mock/ttl?seconds=900`, { method: "POST" });
check("콘솔: 만료가 가까운 토큰은 갱신하고 요청은 성공(세션 쿠키 교체)", viaConsole === 200 && before && after && before !== after);

// After the access token has expired: a page that fires several requests at once must render
// without bouncing to the login (one request renews, the others retry with its cookie).
await fetch(`${OIDC}/__mock/ttl?seconds=2`, { method: "POST" });
const idle = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const back = await idle.newPage();
await consoleLogin(back, "kim");
await fetch(`${OIDC}/__mock/ttl?seconds=900`, { method: "POST" });
await new Promise((r) => setTimeout(r, 3000));
await back.goto(`${CONSOLE}/payments`, { waitUntil: "networkidle" });
await back.goto(`${CONSOLE}/`, { waitUntil: "networkidle" });
check("콘솔: 토큰 만료 뒤 돌아와도 동시 요청 화면이 로그인 없이 뜸", new URL(back.url()).origin === CONSOLE &&
  (await back.getByRole("heading", { name: "사이트" }).isVisible()) && (await back.getByTestId("signed-in").textContent()) === "김운영");
await idle.close();

// A token too large for one cookie (an operator in many groups): the session is split.
const big = await browser.newContext();
const many = await big.newPage();
await consoleLogin(many, "many");
const chunks = (await big.cookies()).filter((c) => c.name.startsWith("dsites_session"));
check("콘솔: 큰 토큰(그룹 많음)도 쿠키를 나눠 로그인 유지", chunks.length > 1 && chunks.every((c) => c.value.length < 4000) &&
  (await many.evaluate(async () => (await fetch("/api/sites")).status)) === 200, { chunks: chunks.map((c) => c.value.length) });
await big.close();

// 5. logout
await page.getByRole("link", { name: "로그아웃" }).click();
await page.waitForURL(`${CONSOLE}/auth/logged-out`, { timeout: 15000 });
check("로그아웃: 세션 삭제, 로그아웃 안내", !(await context.cookies()).some((c) => c.name === "dsites_session" && c.value) &&
  (await page.getByRole("heading", { name: "로그아웃했습니다" }).isVisible()));
await page.goto(CONSOLE, { waitUntil: "domcontentloaded" });
check("로그아웃 뒤 다시 열면 로그인부터", new URL(page.url()).origin === OIDC && new URL(page.url()).pathname === "/authorize");
check("콘솔 페이지 오류 없음", !errors.length, { errors });
await browser.close();

ev.finish();
