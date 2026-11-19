// M3 step 3-6: AI homepage hand-off. The exported TemplateSeed passes the Builder seed contract
// (the same check builder-v2's importer runs) and its uploaded photos download by URL.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { API, TOKEN, api, evidence, uploadShared, paySite } from "./lib/verify.mjs";

const sharp = createRequire(new URL("../packages/renderer/package.json", import.meta.url))("sharp");
const { fieldFixture } = await import("../packages/renderer/src/templates/service-local/fixtures.ts");
const { businessBasicTemplate, collectSeedValidationErrors } = await import(
  "../packages/renderer/node_modules/@dani-builder/site-templates/dist/index.js"
);
const ev = evidence("m3-handoff");
const { check } = ev;
const run = Date.now().toString(36);

uploadShared();
const config = { ...structuredClone(fieldFixture), slug: `handoff-${run}` };
const created = await api("POST", "/sites", { config, createdBy: "operator" });
const siteId = created.data.siteId;
await paySite(siteId);
check("게시 전에는 versionId 없이 409", (await api("GET", `/sites/${siteId}/template-seed`)).status === 409);
const photo = await sharp({ create: { width: 1000, height: 700, channels: 3, background: "#369" } }).jpeg().toBuffer();
const up = await fetch(`${API}/sites/${siteId}/assets`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "image/jpeg" }, body: photo }).then((r) => r.json());
const v2 = structuredClone(config);
v2.content.hero.image = { key: up.key, alt: "현장", width: up.width, height: up.height };
const draft = await api("POST", `/sites/${siteId}/versions`, { config: v2 });
await api("POST", `/sites/${siteId}/publish`, { versionId: draft.data.versionId });

const out = (await api("GET", `/sites/${siteId}/template-seed`)).data;
check("형식·선택 정보·출처", out.format === "dani-builder.template-seed" && out.selection.templateId === "business-basic" && out.source.version === 2 && out.source.preset === "field");
const errors = collectSeedValidationErrors(businessBasicTemplate, out.selection.compositionId, out.seed);
check("빌더 seed 계약 검증 통과(importer와 같은 검사)", errors.length === 0, { errors: errors.slice(0, 5) });
check("페이지: 홈과 개인정보처리방침, 상호", out.seed.pages.map((p) => p.route).join() === "/,/privacy" && out.seed.global.sitename === config.business.name);
const uploaded = out.seed.assets.find((a) => a.key === up.key);
const download = uploaded ? await fetch(uploaded.src.replace(/^https?:\/\/[^/]+/, API)) : null;
check("업로드 사진은 절대 URL이고 내려받아짐", uploaded?.src.startsWith("http") && download?.ok && download.headers.get("content-type") === "image/jpeg");
const older = (await api("GET", `/sites/${siteId}/template-seed?versionId=${created.data.versionId}`)).data;
check("versionId로 예전 버전도 내보냄", older.source.version === 1 && !older.seed.assets.some((a) => a.key === up.key));

// Into a create-daniworks-app project layout (selection + template-data) for template:import.
const project = mkdtempSync(join(tmpdir(), "aihome-"));
writeFileSync(join(project, "template-selection.json"), JSON.stringify({ template: "business-basic", version: "0.2.4", composition: "logistics", palette: "clay", i18n: { enabled: false, locales: ["ko"] } }));
mkdirSync(join(project, "template-data/assets"), { recursive: true });
writeFileSync(join(project, "template-data/assets/stale.jpg"), "old");
const log = execFileSync("node", ["scripts/handoff-to-strapi.mjs", `--site=${config.slug}`, `--into=${project}`], {
  encoding: "utf8",
  env: { ...process.env, MEDIA_BASE: API },
});
const written = JSON.parse(readFileSync(join(project, "template-data/seed.json"), "utf8"));
const files = readdirSync(join(project, "template-data/assets"));
check("프로젝트에 seed.json(seed+colors)과 자산 파일명 일치, 이전 자산 정리", written.seed.global.sitename === config.business.name && written.colors &&
  written.seed.assets.every((a) => files.includes(basename(a.src))) && !files.includes("stale.jpg"), { log: log.trim(), files });
const errorsAfter = collectSeedValidationErrors(businessBasicTemplate, out.selection.compositionId, written.seed);
check("프로젝트에 쓴 seed도 계약 검증 통과", errorsAfter.length === 0);

ev.finish({ siteId });
