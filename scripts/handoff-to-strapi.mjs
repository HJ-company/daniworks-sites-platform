// Moves a starter site into an AI homepage project scaffolded by create-daniworks-app
// (template business-basic), before its first `pnpm --filter cms template:import`:
//
//   API_URL=https://api.dsites.kr ADMIN_TOKEN=... node scripts/handoff-to-strapi.mjs --site=<id|slug> --into=<project dir>
//
// It replaces template-data/seed.json ({ seed, colors }) and template-data/assets/ with the
// site's content; the importer then loads it into Strapi. Fresh CMS only (the importer
// refuses to overwrite). No change to builder-v2 is needed.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { basename, join } from "node:path";

const API = process.env.API_URL ?? "http://127.0.0.1:8788";
const TOKEN = process.env.ADMIN_TOKEN ?? "dev-admin-token";
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
if (!args.site || !args.into) {
  console.error("usage: node scripts/handoff-to-strapi.mjs --site=<id|slug> --into=<project dir> [--version=<versionId>]");
  process.exit(2);
}
// The package exports no package.json; use the renderer's installed copy (same pinned version).
const templatesRoot = fileURLToPath(new URL("../packages/renderer/node_modules/@dani-builder/site-templates/", import.meta.url));
const { businessBasicTemplate, collectSeedValidationErrors } = await import(join(templatesRoot, "dist/index.js"));

const get = async (path) => {
  const res = await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${TOKEN}` } });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.json();
};

const selectionFile = join(args.into, "template-selection.json");
if (!existsSync(selectionFile)) throw new Error(`${selectionFile} 없음: create-daniworks-app으로 만든 프로젝트 루트를 지정하세요`);
const selection = JSON.parse(readFileSync(selectionFile, "utf8"));
if (selection.template !== "business-basic") throw new Error(`business-basic 템플릿 프로젝트가 아닙니다 (${selection.template})`);

const sites = (await get("/sites")).sites;
const site = sites.find((s) => s.id === args.site || s.slug === args.site);
if (!site) throw new Error(`사이트를 찾지 못했습니다: ${args.site}`);
const out = await get(`/sites/${site.id}/template-seed${args.version ? `?versionId=${args.version}` : ""}`);
const errors = collectSeedValidationErrors(businessBasicTemplate, out.selection.compositionId, out.seed);
if (errors.length) throw new Error(`seed 계약 검증 실패:\n${errors.join("\n")}`);

const data = join(args.into, "template-data");
const assets = join(data, "assets");
rmSync(assets, { recursive: true, force: true });
mkdirSync(assets, { recursive: true });
for (const asset of out.seed.assets) {
  const target = join(assets, basename(asset.src));
  if (/^https?:\/\//.test(asset.src)) {
    // Local Docker: the site origin is not resolvable here; fetch through the API instead.
    const res = await fetch(asset.src.replace(/^https?:\/\/[^/]+/, process.env.MEDIA_BASE ?? new URL(asset.src).origin));
    if (!res.ok) throw new Error(`${asset.src}: ${res.status}`);
    writeFileSync(target, Buffer.from(await res.arrayBuffer()));
  } else {
    copyFileSync(join(templatesRoot, asset.src), target);
  }
}
const colors = businessBasicTemplate.palettes[out.selection.paletteId].brandColors;
writeFileSync(join(data, "seed.json"), `${JSON.stringify({ seed: out.seed, colors }, null, 2)}\n`);
console.log(`${site.slug} v${out.source.version} → ${data}: ${out.seed.pages.length} pages, ${readdirSync(assets).length} assets, palette ${out.selection.paletteId}`);
console.log("다음: 새 CMS에서 pnpm --filter cms template:import");
