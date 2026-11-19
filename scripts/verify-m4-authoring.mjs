// M4 step 4-E: MCP authoring tools. Guides an agent reads before writing (stored, versioned,
// editable by section; the config schema generated from code), customers, assets and AI images.
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { API, TOKEN, api, evidence, localD1, uploadShared } from "./lib/verify.mjs";

const { fieldFixture } = await import("../packages/renderer/src/templates/service-local/fixtures.ts");
const ev = evidence("m4-authoring");
const { check } = ev;
const run = Date.now().toString(36);
uploadShared();

const client = new Client({ name: "verify-m4-authoring", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(`${API}/mcp`), { requestInit: { headers: { authorization: `Bearer ${TOKEN}` } } }));
const call = async (name, args = {}) => {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content?.[0]?.text ?? "{}";
  return { isError: Boolean(result.isError), data: result.structuredContent ?? JSON.parse(text) };
};

// 1. guides
const tools = (await client.listTools()).tools.map((t) => t.name);
check("지침 도구 4종", ["guide_list", "guide_get", "guide_create", "guide_update"].every((t) => tools.includes(t)), { tools });
const instructions = client.getInstructions?.() ?? "";
check("서버 안내: 제작 전에 지침부터", instructions.includes("guide_get") && instructions.includes("site_preview_link"));

const list = (await call("guide_list")).data.guides;
check("지침 목록: 생성 스키마(읽기 전용) + 기본 지침 4종", list[0]?.slug === "schema-site-config" && list[0].readOnly &&
  ["industry-service-local", "writing-rules", "product-policy", "design"].every((slug) => list.some((g) => g.slug === slug)), { slugs: list.map((g) => g.slug) });
const schema = (await call("guide_get", { slug: "schema-site-config" })).data;
check("스키마 지침은 코드에서 만든 JSON Schema와 뼈대", schema.body.includes('"business"') && schema.body.includes("## 뼈대"));
const photos = (await call("guide_get", { slug: "writing-rules", query: "AI 이미지" })).data;
check("query로 해당 섹션만", photos.matched.includes("이미지 용도") && !photos.body.includes("## 카피 톤"), { matched: photos.matched });
check("스키마 지침은 고칠 수 없음", (await call("guide_update", { slug: "schema-site-config", body: "x" })).isError);

const industry = (await call("guide_get", { slug: "industry-service-local" })).data;
const marker = `한 장 더 확인 ${run}`;
const updated = await call("guide_update", { slug: "industry-service-local", section: "4. 사진", body: `${(await call("guide_get", { slug: "industry-service-local", query: "사진" })).data.body.split("\n").filter((l) => !l.startsWith("## ")).join("\n").trim()}\n- ${marker}`, note: "사진 확인 항목 추가", baseVersion: industry.version });
check("섹션 단위 수정 → 새 버전, 다른 섹션은 그대로", !updated.isError && updated.data.version === industry.version + 1 && updated.data.body.includes(marker) &&
  updated.data.body.includes("## 5. 검증") && updated.data.author === "스크립트", { version: updated.data.version });
check("읽은 뒤 다른 수정이 있었으면 거부(baseVersion)", (await call("guide_update", { slug: "industry-service-local", section: "5. 검증", body: "x", baseVersion: industry.version })).isError);
check("template_get도 고친 업종 지침을 준다", (await call("template_get", { templateId: "service-local" })).data.guide.includes(marker));
check("예전 버전도 읽을 수 있음", !(await call("guide_get", { slug: "industry-service-local", version: industry.version })).data.body.includes(marker));

const newSlug = `industry-cafe-${run}`;
const created = await call("guide_create", { slug: newSlug, title: "업종: 카페", kind: "industry", summary: "카페 시험", body: "# 카페\n\n## 메뉴\n\n대표 메뉴 3개\n" });
check("새 지침 만들기(v1), 같은 slug는 거부", !created.isError && created.data.version === 1 &&
  (await call("guide_create", { slug: newSlug, title: "x", kind: "industry", summary: "x", body: "x" })).isError);
const http = await api("GET", "/guides");
check("콘솔용 API: 지침 목록·버전 이력", http.data.guides.some((g) => g.slug === newSlug) &&
  (await api("GET", "/guides/industry-service-local/versions")).data.versions.length >= 2);

// 2. AI-saved versions record the guide versions they were written against
const config = { ...structuredClone(fieldFixture), slug: `author-${run}` };
const site = await call("site_create", { config });
const stamp = JSON.parse(localD1(`SELECT guide_versions FROM site_versions WHERE id = '${site.data.versionId}'`)[0]?.guide_versions ?? "{}");
check("AI가 만든 버전에 참고한 지침 버전 기록", stamp["industry-service-local"] === industry.version + 1 && stamp[newSlug] === 1, { stamp });

// 3. customers: look before creating, never the same owner twice
const unique = String(Date.now()).slice(-8);
const owner = { name: `저자청소 ${run}`, contactName: "박사장", phone: `010-${unique.slice(0, 4)}-${unique.slice(4)}` };
const first = await call("customer_create", owner);
const again = await call("customer_create", { ...owner, name: "다른 이름" });
check("customer_create: 같은 전화번호면 만들지 않고 기존 고객 안내", !first.isError && again.isError && JSON.stringify(again.data).includes(first.data.customer.id));
const found = await call("customer_get", { search: "박사장" });
check("customer_get: 사장님 이름으로 찾기", found.data.customers.some((c) => c.id === first.data.customer.id));
const linked = await call("site_create", { config: { ...structuredClone(fieldFixture), slug: `author-c-${run}` }, customerId: first.data.customer.id });
const detail = await call("customer_get", { customerId: first.data.customer.id });
check("site_create(customerId) → 고객 상세에 사이트", !linked.isError && detail.data.sites.some((x) => x.id === linked.data.siteId));

// 4. assets: listed with origin and use; deleting refused while a version uses it
const sharp = (await import("node:module")).createRequire(new URL("../packages/renderer/package.json", import.meta.url))("sharp");
const jpeg = await sharp({ create: { width: 800, height: 600, channels: 3, background: "#4a7" } }).jpeg().toBuffer();
const used = await call("asset_upload", { site: config.slug, base64: jpeg.toString("base64"), contentType: "image/jpeg" });
const spare = await call("asset_upload", { site: config.slug, base64: (await sharp({ create: { width: 640, height: 480, channels: 3, background: "#a47" } }).jpeg().toBuffer()).toString("base64"), contentType: "image/jpeg" });
const v2 = structuredClone(config);
v2.content.hero.image = { key: used.data.key, alt: "현장", width: used.data.width, height: used.data.height };
const saved = await call("site_update_draft", { site: config.slug, config: v2 });
check("사진을 쓰는 초안 저장", !saved.isError, saved.isError ? saved.data : {});
const assets = (await call("asset_list", { site: config.slug })).data.assets;
const usedRow = assets.find((a) => a.key === used.data.key);
check("asset_list: 출처와 사용 여부", usedRow?.in_use === true && usedRow.source === "upload" && assets.find((a) => a.key === spare.data.key)?.in_use === false);
check("asset_delete: 쓰는 사진은 거부", (await call("asset_delete", { site: config.slug, key: used.data.key })).isError);
const removed = await call("asset_delete", { site: config.slug, key: spare.data.key });
const gone = await fetch(`${API}${spare.data.url}`);
check("asset_delete: 안 쓰는 사진은 파일까지 삭제", !removed.isError && gone.status === 404 && !(await call("asset_list", { site: config.slug })).data.assets.some((a) => a.key === spare.data.key));
const stale = structuredClone(config);
stale.content.hero.image = { key: spare.data.key, alt: "지운 사진", width: spare.data.width, height: spare.data.height };
check("지운 사진을 담은 예전 화면에서 저장해도 거부", (await call("site_update_draft", { site: config.slug, config: stale })).isError);
const revived = await call("asset_upload", { site: config.slug, base64: (await sharp({ create: { width: 640, height: 480, channels: 3, background: "#a47" } }).jpeg().toBuffer()).toString("base64"), contentType: "image/jpeg" });
check("같은 사진을 다시 올리면 되살아남", revived.data.key === spare.data.key && (await fetch(`${API}${spare.data.url}`)).status === 200 &&
  !(await call("site_update_draft", { site: config.slug, config: stale })).isError);
const other = await call("site_create", { config: { ...structuredClone(fieldFixture), slug: `author-o-${run}` } });
const borrowed = await call("asset_upload", { site: config.slug, base64: (await sharp({ create: { width: 500, height: 400, channels: 3, background: "#47a" } }).jpeg().toBuffer()).toString("base64"), contentType: "image/jpeg" });
const otherConfig = { ...structuredClone(fieldFixture), slug: `author-o-${run}` };
otherConfig.content.hero.image = { key: borrowed.data.key, alt: "빌린 사진", width: borrowed.data.width, height: borrowed.data.height };
await call("site_update_draft", { site: otherConfig.slug, config: otherConfig });
check("다른 사이트가 쓰는 사진도 지울 수 없음", !other.isError && (await call("asset_delete", { site: config.slug, key: borrowed.data.key })).isError &&
  (await call("asset_list", { site: config.slug })).data.assets.find((a) => a.key === borrowed.data.key)?.in_use === true);
// A photo being deleted (reserved) cannot be put into a new version or a new site meanwhile.
const doomed = await call("asset_upload", { site: config.slug, base64: (await sharp({ create: { width: 520, height: 400, channels: 3, background: "#aa4" } }).jpeg().toBuffer()).toString("base64"), contentType: "image/jpeg" });
localD1(`UPDATE assets SET deleting_at = '${new Date().toISOString()}', deleting_token = 'someone-else' WHERE key = '${doomed.data.key}'`);
const withDoomed = structuredClone(config);
withDoomed.content.hero.image = { key: doomed.data.key, alt: "x", width: doomed.data.width, height: doomed.data.height };
const draftRefused = await call("site_update_draft", { site: config.slug, config: withDoomed });
const siteRefused = await api("POST", "/sites", { config: { ...withDoomed, slug: `author-d-${run}` }, createdBy: "operator" });
check("지우는 중인 사진은 새 초안·새 사이트에 못 씀(사이트도 안 생김)", draftRefused.isError && JSON.stringify(draftRefused.data).includes("지우는 중") &&
  siteRefused.status === 409 && (await api("GET", "/sites")).data.sites.every((x) => x.slug !== `author-d-${run}`));
check("다른 삭제가 진행 중이면 두 번째 삭제는 거부", (await call("asset_delete", { site: config.slug, key: doomed.data.key })).isError);
localD1(`UPDATE assets SET deleting_at = '${new Date(Date.now() - 10 * 60_000).toISOString()}' WHERE key = '${doomed.data.key}'`);
const takenOver = await call("asset_delete", { site: config.slug, key: doomed.data.key });
check("10분 넘게 멈춘 삭제는 이어받아 끝냄", !takenOver.isError && (await fetch(`${API}${doomed.data.url}`)).status === 404);
check("콘솔 API로도 같은 규칙(DELETE)", (await api("DELETE", `/sites/${site.data.siteId}/assets/${used.data.key.split("/")[1]}`)).status === 409);

// 5. AI images: background freely, real work only on the customer's request (recorded)
const bg = await call("image_generate", { site: config.slug, prompt: "밝은 거실 배경, 사람 없음", purpose: "background" });
const bgRow = (await call("asset_list", { site: config.slug })).data.assets.find((a) => a.key === bg.data.key);
check("image_generate(배경): 가로 1536px 사진으로 저장, 출처·용도·프롬프트·비용 기록", !bg.isError && bg.data.width === 1536 && bg.data.aiGenerated &&
  bgRow?.source === "ai" && bgRow.purpose === "background" && bgRow.prompt.includes("거실") && bgRow.cost_usd === 0.04 &&
  (await fetch(`${API}${bg.data.url}`)).status === 200, { row: bgRow });
const noRequest = await call("image_generate", { site: config.slug, prompt: "입주청소 전후 주방", purpose: "work" });
check("image_generate(실제 작업물): 고객 요청 없으면 거부", noRequest.isError && JSON.stringify(noRequest.data).includes("고객 요청"));
const work = await call("image_generate", {
  site: config.slug,
  prompt: "입주청소 전후 주방",
  purpose: "work",
  size: "1024x1024",
  customerRequest: { channel: "카톡", requestedAt: "2026-11-20", summary: "사장님이 작업 사진 대신 예시 이미지를 요청" },
});
const workRow = (await call("asset_list", { site: config.slug })).data.assets.find((a) => a.key === work.data.key);
check("image_generate(실제 작업물, 요청 있음): 요청 기록과 함께 저장", !work.isError && workRow?.purpose === "work" && workRow.customer_request?.channel === "카톡");
const refused = await call("image_generate", { site: config.slug, prompt: "__fail__", purpose: "mood" });
check("OpenAI가 거부하면 이유와 함께 도구 오류", refused.isError && JSON.stringify(refused.data).includes("safety"));
check("이미지 생성은 작업 기록에(누가·어느 사이트)", (await api("GET", `/sites/${site.data.siteId}/audit`)).data.entries.some((e) => e.action === "MCP image_generate" && e.status === 200));

await client.close();
ev.finish();
