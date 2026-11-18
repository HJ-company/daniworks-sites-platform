// M2 step 2-7: MCP tools over Streamable HTTP with a real MCP client. An agent's whole loop:
// read the template → validate → create → upload a photo → draft → preview → publish → rollback.
import { createRequire } from "node:module";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { API, TOKEN, evidence, routerRequest, uploadShared } from "./lib/verify.mjs";

const sharp = createRequire(new URL("../packages/renderer/package.json", import.meta.url))("sharp");
const ev = evidence("m2-mcp");
const { check } = ev;
const run = Date.now().toString(36);

async function connect(token = TOKEN) {
  const client = new Client({ name: "verify-m2-mcp", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${API}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return client;
}
const call = async (client, name, args = {}) => {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content?.[0]?.text ?? "{}";
  return { isError: Boolean(result.isError), data: result.structuredContent ?? JSON.parse(text) };
};

uploadShared();

// 1. auth
const anon = await fetch(`${API}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
check("토큰 없는 MCP 요청은 401", anon.status === 401);

const client = await connect();
const { tools } = await client.listTools();
const names = tools.map((t) => t.name).sort();
const expected = [
  "asset_upload", "site_create", "site_get", "site_preview_url", "site_publish",
  "site_rollback", "site_update_draft", "site_validate", "template_get", "template_list",
].sort();
check("도구 10종 노출", JSON.stringify(names) === JSON.stringify(expected), { names });

// 2. template
const list = await call(client, "template_list");
check("template_list: service-local과 preset 2종", list.data.templates?.[0]?.presets?.length === 2);
const template = await call(client, "template_get", { templateId: "service-local" });
check(
  "template_get: 지침, 샘플 사진, 자리표시자 뼈대(실제 업체 문구 없음)",
  template.data.guide?.includes("작성 지침") && template.data.samplePhotos?.length > 5 && template.data.skeleton?.version === 2 &&
    !JSON.stringify(template.data).includes("제페스") && !JSON.stringify(template.data).includes("상쾌공간"),
);

// 3. validate (an agent's mistakes come back with paths)
const { fieldFixture } = await import("../packages/renderer/src/templates/service-local/fixtures.ts");
const draft = structuredClone(fieldFixture);
draft.slug = `mcp-${run}`;
const bad = structuredClone(draft);
bad.business.phone = "02-12";
delete bad.content.hero;
const invalid = await call(client, "site_validate", { config: bad });
check("site_validate: 경로별 오류", invalid.data.valid === false && invalid.data.errors.some((e) => e.startsWith("business.phone")) && invalid.data.errors.some((e) => e.startsWith("content.hero")), invalid.data);
check("site_validate: 올바른 설정은 valid", (await call(client, "site_validate", { config: draft })).data.valid === true);
const createBad = await call(client, "site_create", { config: bad });
check("site_create: 잘못된 설정은 도구 오류(isError)와 세부 경로", createBad.isError && JSON.stringify(createBad.data.details).includes("business.phone"));

// 4. create → preview
const created = await call(client, "site_create", { config: draft });
check("site_create: 사이트와 프리뷰 URL", !created.isError && created.data.siteId && created.data.previewUrl?.includes("/preview/"), created.data);
const preview = await fetch(created.data.previewUrl.replace(/^https?:\/\/[^/]+/, API));
check("프리뷰 URL 열림", preview.status === 200);

// 5. photo upload (base64) and a draft that uses it
const photo = await sharp({ create: { width: 1200, height: 800, channels: 3, background: "#3a7" } }).jpeg().toBuffer();
const uploaded = await call(client, "asset_upload", { site: draft.slug, base64: photo.toString("base64"), contentType: "image/jpeg" });
check("asset_upload(base64): key·크기", !uploaded.isError && uploaded.data.key?.startsWith("m:") && uploaded.data.width === 1200, uploaded.data);
// Live: a Naver blog RSS thumbnail (365px) is fetched at its uploaded size. Needs internet.
const thumb = await call(client, "asset_upload", {
  site: draft.slug,
  url: "https://blogthumb.pstatic.net/MjAyNjExMTBfMSAg/MDAxNzk0MzE0NzUzMDUx.g2aY3dUpdEtYHp3utLItTwaGUHclau9MLW6eU3a9eSkg.zH2Rab1Buwlc6oGfxlSVn1SknNdVve8ESmA7GFeZYCsg.JPEG/900_1788649132204.jpg?type=s3",
});
check("asset_upload(url, 외부): 네이버 RSS 썸네일을 원본 크기(900px)로", !thumb.isError && thumb.data.width === 900, thumb.data);
const both = await call(client, "asset_upload", { site: draft.slug });
check("asset_upload: url·base64 둘 다 없으면 오류", both.isError);
const v2 = structuredClone(draft);
v2.content.hero.image = { key: uploaded.data.key, alt: "현장 사진", width: uploaded.data.width, height: uploaded.data.height };
v2.content.hero.heading = "MCP로 고친\n두 번째 시안";
const updated = await call(client, "site_update_draft", { site: draft.slug, config: v2, note: "히어로 사진 교체" });
check("site_update_draft: 버전 2와 프리뷰", !updated.isError && updated.data.number === 2 && updated.data.previewUrl);
const slugChange = await call(client, "site_update_draft", { site: draft.slug, config: { ...v2, slug: `${draft.slug}-x` } });
check("site_update_draft: slug 변경은 도구 오류", slugChange.isError);
const got = await call(client, "site_get", { site: draft.slug });
check("site_get(slug): 버전 2개, 최신 설정", got.data.versions?.length === 2 && got.data.latestConfig?.content?.hero?.heading === "MCP로 고친\n두 번째 시안");
const latestPreview = await call(client, "site_preview_url", { site: draft.slug });
check("site_preview_url: 최신 버전", latestPreview.data.number === 2);

// 6. publish → live → rollback
const host = `${draft.slug}.localhost`;
const pub1 = await call(client, "site_publish", { site: draft.slug, versionId: created.data.versionId });
const pub2 = await call(client, "site_publish", { site: draft.slug });
const live = await routerRequest(host, "/");
check("site_publish: 최신(v2) 공개", !pub2.isError && live.status === 200 && live.headers["x-site-version"] === "2" && live.body.includes(uploaded.data.key.slice(2)));
const back = await call(client, "site_rollback", { site: draft.slug, versionId: pub1.data.versionId });
const afterRollback = await routerRequest(host, "/");
check("site_rollback: v1로", !back.isError && afterRollback.headers["x-site-version"] === "1");
const missing = await call(client, "site_get", { site: `nobody-${run}` });
check("없는 사이트는 도구 오류", missing.isError);

await client.close();
ev.finish({ slug: draft.slug });
