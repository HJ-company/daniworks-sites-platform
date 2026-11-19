// M2 step 2-5: visitor inquiry end to end. Browser form (Turnstile frame, timing) → router →
// api RPC → D1 → mail (Mailpit) → operator list/CSV; spam and abuse paths; metrics.
import { API, ROUTER_PORT, TOKEN, api, chromium, evidence, inspectPage, localD1, routerRequest, uploadShared, viewports, paySite } from "./lib/verify.mjs";

const { lessonFixture } = await import("../packages/renderer/src/templates/service-local/fixtures.ts");
const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:8025";
const ev = evidence("m2-inquiry");
// CSV rows with embedded newlines span several physical lines.
const extraLines = (rows) => rows.reduce((n, row) => n + (row.message.match(/\n/g)?.length ?? 0), 0);
const { check } = ev;
const run = Date.now().toString(36);
const notify = `owner-${run}@example.test`;

uploadShared();
const config = { ...structuredClone(lessonFixture), slug: `inq-${run}` };
const host = `${config.slug}.localhost`;
const created = await api("POST", "/sites", { config, createdBy: "operator" });
const siteId = created.data.siteId;
await paySite(siteId);
const patched = await api("PATCH", `/sites/${siteId}`, { notifyEmail: notify });
check("알림 이메일 설정", patched.status === 200 && patched.data.site.notify_email === notify);
check("잘못된 알림 이메일은 422", (await api("PATCH", `/sites/${siteId}`, { notifyEmail: "nope" })).status === 422);
await api("POST", `/sites/${siteId}/publish`);

const post = (body, headers = {}) =>
  routerRequest(host, "/api/inquiry", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...headers },
  });
const ok = { name: "API 시험", phone: "010-2222-3333", message: "API 경로 시험", consent: true, elapsedMs: 5000, turnstileToken: "XXXX.DUMMY.TOKEN.XXXX" };

// 1. browser: the real form
const browser = await chromium().launch();
const r = await inspectPage(browser, `http://${host}:${ROUTER_PORT}/`, viewports.mobile, {
  allowExternal: ["https://pf.kakao.com/", "https://challenges.cloudflare.com/"],
});
const turnstileBeforeInteraction = await r.page.locator("iframe[data-turnstile-frame]").count();
check("페이지 로드 때는 Turnstile을 불러오지 않음", turnstileBeforeInteraction === 0 && !r.external.length, { external: r.external });
const form = r.page.locator("form").filter({ has: r.page.locator("input[name=phone]") });
await form.locator("input[name=name]").fill("브라우저 시험");
await form.locator("input[name=phone]").fill("010-1234-5678");
await form.locator("textarea[name=message]").fill("주말반 자리 있나요?\n초급입니다.");
await form.locator("input[name=consent]").check();
await r.page.waitForSelector("iframe[data-turnstile-frame]");
// The test site key passes automatically; wait for the token to arrive by postMessage.
await r.page.waitForTimeout(2500);
await form.locator("button[type=submit]").click();
const done = await r.page.getByRole("status").textContent({ timeout: 15000 }).catch(() => null);
await r.page.screenshot({ path: `${ev.dir}/form-done.png` });
check("브라우저 폼 제출 → 접수 완료 메시지", done?.includes("접수되었습니다"), { done, errors: r.errors });
await r.page.close();
await browser.close();

// 2. stored, listed, exported
const list = await api("GET", `/sites/${siteId}/inquiries`);
const stored = list.data.inquiries?.find((row) => row.name === "브라우저 시험");
check("D1 저장 (연락처 숫자만)", stored?.phone === "01012345678" && stored.page === "/", stored);

// 3. mail to the owner
let mail;
for (let i = 0; i < 40 && !mail; i++) {
  const found = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${notify}`)}`)).json();
  mail = found.messages?.[0];
  if (!mail) await new Promise((res) => setTimeout(res, 250));
}
const detail = mail ? await (await fetch(`${MAILPIT}/api/v1/message/${mail.ID}`)).json() : null;
check(
  "사장님 메일 수신: 제목에 상호, 본문에 이름·연락처·내용",
  mail?.Subject === "[제페스 풋볼 아카데미] 홈페이지 문의 - 브라우저 시험" &&
    detail?.Text.includes("010-1234-5678") &&
    detail.Text.includes("주말반 자리 있나요?"),
  { subject: mail?.Subject },
);
let notified;
for (let i = 0; i < 20; i++) {
  notified = (await api("GET", `/sites/${siteId}/inquiries`)).data.inquiries.find((row) => row.id === stored?.id);
  if (notified?.notify_status === "sent") break;
  await new Promise((res) => setTimeout(res, 250));
}
check("알림 결과 sent 기록", notified?.notify_status === "sent");

// 4. abuse and validation paths (API level)
check("동의 없으면 422", (await post({ ...ok, consent: false })).status === 422);
check("전화번호 형식 오류 422", (await post({ ...ok, phone: "12" })).status === 422);
check("Turnstile 토큰 없으면 403", (await post({ ...ok, turnstileToken: undefined })).status === 403);
const before = (await api("GET", `/sites/${siteId}/inquiries`)).data.inquiries.length;
const honeypot = await post({ ...ok, website: "http://spam" });
const fast = await post({ ...ok, elapsedMs: 300 });
const after = (await api("GET", `/sites/${siteId}/inquiries`)).data.inquiries.length;
check("허니팟·2초 미만 제출은 200으로 답하되 저장 안 함", honeypot.status === 200 && fast.status === 200 && before === after);
check("JSON 아니면 415", (await routerRequest(host, "/api/inquiry", { method: "POST", body: "a=b", headers: { "content-type": "application/x-www-form-urlencoded" } })).status === 415);
check("16KB 넘는 본문 400", (await post({ ...ok, message: "x".repeat(20000) })).status === 400);
check("GET은 405", (await routerRequest(host, "/api/inquiry")).status === 405);
check("연결 안 된 호스트는 404", (await routerRequest(`nobody-${run}.localhost`, "/api/inquiry", { method: "POST", body: "{}", headers: { "content-type": "application/json" } })).status === 404);

// 5. rate limit per visitor (hashed IP). Local wrangler sets cf-connecting-ip to the real
// client (always this container), so earlier runs share the window: age them out first.
localD1("UPDATE inquiries SET created_at = '2000-01-01T00:00:00.000Z' WHERE client_hash IS NOT NULL");
const ip = { "cf-connecting-ip": "203.0.113.7" };
const statuses = [];
for (let i = 0; i < 6; i++) statuses.push((await post({ ...ok, message: `한도 ${i}` }, ip)).status);
check("같은 방문자 10분 5건 초과는 429", statuses.slice(0, 5).every((s) => s === 201) && statuses[5] === 429, { statuses });
// Concurrent burst from one visitor: the atomic insert admits exactly the limit.
localD1("UPDATE inquiries SET created_at = '2000-01-01T00:00:00.000Z' WHERE client_hash IS NOT NULL");
const burst = await Promise.all(
  Array.from({ length: 12 }, (_, i) => post({ ...ok, message: `동시 ${i}` }, { "cf-connecting-ip": "203.0.113.8" })),
);
const admitted = burst.filter((res) => res.status === 201).length;
check("동시 12건 버스트도 정확히 5건만 저장", admitted === 5 && burst.filter((res) => res.status === 429).length === 7, { admitted });
const hashes = localD1(`SELECT DISTINCT client_hash FROM inquiries WHERE site_id = '${siteId}' AND client_hash IS NOT NULL`);
check("IP는 해시로만 저장", hashes.length >= 1 && hashes.every((h) => /^[0-9a-f]{32}$/.test(h.client_hash)) && !JSON.stringify(localD1(`SELECT * FROM inquiries WHERE site_id = '${siteId}'`)).includes("127.0.0.1"));

// Pagination: small pages cover every row exactly once.
const all = [];
let cursor = null;
do {
  const page = await api("GET", `/sites/${siteId}/inquiries?limit=2${cursor ? `&before=${encodeURIComponent(cursor)}` : ""}`);
  all.push(...page.data.inquiries);
  cursor = page.data.next;
} while (cursor);
const total = localD1(`SELECT COUNT(*) AS n FROM inquiries WHERE site_id = '${siteId}'`)[0].n;
check("목록 페이지네이션: 2건씩 끝까지 = 전체, 중복 없음", all.length === total && new Set(all.map((x) => x.id)).size === total, { pages: all.length, total });

// 6. CSV export
const csvRes = await fetch(`${API}/sites/${siteId}/inquiries.csv`, { headers: { authorization: `Bearer ${TOKEN}` } });
// text() would strip the BOM; check the bytes.
const csvBytes = new Uint8Array(await csvRes.arrayBuffer());
const csv = new TextDecoder("utf-8", { ignoreBOM: true }).decode(csvBytes);
const bom = csvBytes[0] === 0xef && csvBytes[1] === 0xbb && csvBytes[2] === 0xbf;
check("CSV는 전체 행(헤더 제외)을 내보냄", csv.trim().split(/\r?\n/).length - 1 === total + extraLines(all), { total });
check("CSV 내보내기: BOM, 헤더, 하이픈 연락처", csvRes.ok && bom && csv.includes("접수(한국 시간)") && csv.includes("010-1234-5678"), { bom });
check("목록은 인증 필요", (await fetch(`${API}/sites/${siteId}/inquiries`)).status === 401);

// 7. metrics and suspended sites
const metric = localD1(`SELECT SUM(count) AS n FROM metrics_daily WHERE site_id = '${siteId}' AND event = 'inquiry'`)[0];
check("문의 지표 집계 (저장된 건수와 같음)", metric.n === (await api("GET", `/sites/${siteId}/inquiries`)).data.inquiries.length, metric);
await api("POST", `/sites/${siteId}/suspend`);
check("정지된 사이트는 문의 404", (await post(ok)).status === 404);
await api("POST", `/sites/${siteId}/resume`);

ev.finish({ siteId });
