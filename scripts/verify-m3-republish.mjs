// M3 step 3-3: full republish. Two outdated sites: one renders the same (applied), one whose
// rendering changed (held for review). Commit is refused when the live version moved on.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { API, api, evidence, localD1, localKv, routerRequest, uploadShared } from "./lib/verify.mjs";

const { fieldFixture, lessonFixture } = await import("../packages/renderer/src/templates/service-local/fixtures.ts");
const ev = evidence("m3-republish");
const { check } = ev;
const run = Date.now().toString(36);

uploadShared();
// The "same" site has a blog section: its images are third-party requests the token must not reach.
const same = { ...structuredClone(lessonFixture), slug: `rp-same-${run}` };
same.business.blogUrl = "https://blog.naver.com/fixtureblog";
const changed = { ...structuredClone(fieldFixture), slug: `rp-changed-${run}` };
const ids = {};
for (const config of [same, changed]) {
  const created = await api("POST", "/sites", { config, createdBy: "operator" });
  ids[config.slug] = created.data.siteId;
  await api("POST", `/sites/${created.data.siteId}/publish`);
}
// Live pages get blog cards injected by the router; staged HTML never does.
await api("POST", `/sites/${ids[same.slug]}/blog/refresh`);
check("공개 화면에는 블로그 카드가 있음(비교 조건)", (await routerRequest(`${same.slug}.localhost`, "/")).body.includes("sites-blog-card"));
const pointerOf = (slug) => JSON.parse(localKv("get", `host:${slug}.localhost`)).pointer;
const before = { same: pointerOf(same.slug), changed: pointerOf(changed.slug) };

// Simulate a renderer update: both live versions were rendered with an older asset version.
localD1(`UPDATE site_versions SET asset_version = 'old-assets' WHERE site_id IN ('${ids[same.slug]}', '${ids[changed.slug]}')`);
// …and for one of them the new renderer changes what it draws.
localD1(
  `UPDATE site_versions SET config = replace(config, '하루 한 집만', '렌더러가 바뀐 문구') WHERE site_id = '${ids[changed.slug]}'`,
);
const plan = (await api("GET", "/republish/plan")).data;
check("계획: 두 사이트가 outdated", ["same", "changed"].every((k) => plan.sites.find((s) => s.slug === (k === "same" ? same.slug : changed.slug))?.outdated));
check("스테이지 HTML은 관리자만", (await fetch(`${API}/staged/${ids[same.slug]}/x/`)).status === 401);

// Run the operator command (apply), only on these two sites.
let output = "";
try {
  output = execFileSync("node", ["scripts/republish-all.mjs", "--apply", `--only=${same.slug},${changed.slug}`], {
    encoding: "utf8",
    env: { ...process.env, LIVE_PORT: "8787" },
  });
} catch (error) {
  output = String(error.stdout ?? "") + String(error.stderr ?? "");
}
console.log(output.trim());
const runs = readdirSync("evidence/republish").sort();
const full = JSON.parse(readFileSync(`evidence/republish/${runs.at(-1)}/report.json`, "utf8"));
const report = full.report;
check("관리자 토큰은 스테이지 HTML 요청에만(외부 요청에 없음)", Array.isArray(full.tokenLeaks) && full.tokenLeaks.length === 0, { leaks: full.tokenLeaks });
const sameEntry = report.find((r) => r.slug === same.slug);
const changedEntry = report.find((r) => r.slug === changed.slug);
check("같은 화면인 사이트는 홈·개인정보처리방침 × 모바일·데스크톱 모두 차이 0으로 적용", sameEntry?.result === "applied" && Object.keys(sameEntry.diffs).length === 4 && Object.values(sameEntry.diffs).every((d) => d.ratio === 0), sameEntry?.diffs);
check("화면이 바뀐 사이트는 보류(review)와 diff 이미지", changedEntry?.result === "review" && changedEntry.diffs["home-mobile"].ratio > 0.0001 &&
  readdirSync(`evidence/republish/${runs.at(-1)}`).some((f) => f.startsWith(`${changed.slug}-home-mobile-diff`)), changedEntry?.diffs);

// A renderer change that breaks only the privacy page is caught too.
const privacyOnly = { ...structuredClone(fieldFixture), slug: `rp-privacy-${run}` };
const p = await api("POST", "/sites", { config: privacyOnly, createdBy: "operator" });
await api("POST", `/sites/${p.data.siteId}/publish`);
localD1(`UPDATE site_versions SET asset_version = 'old-assets', config = replace(config, '"representative":"김철수"', '"representative":"바뀐 대표"') WHERE site_id = '${p.data.siteId}'`);
let out2 = "";
try {
  out2 = execFileSync("node", ["scripts/republish-all.mjs", "--apply", `--only=${privacyOnly.slug}`], { encoding: "utf8", env: { ...process.env, LIVE_PORT: "8787" } });
} catch (error) {
  out2 = String(error.stdout ?? "");
}
const runs2 = readdirSync("evidence/republish").sort();
const privacyEntry = JSON.parse(readFileSync(`evidence/republish/${runs2.at(-1)}/report.json`, "utf8")).report[0];
// A layout change (page height) is held and still leaves a diff image.
const tall = { ...structuredClone(fieldFixture), slug: `rp-tall-${run}` };
const t = await api("POST", "/sites", { config: tall, createdBy: "operator" });
await api("POST", `/sites/${t.data.siteId}/publish`);
localD1(`UPDATE site_versions SET asset_version = 'old-assets', config = replace(config, '"faqs":[', '"faqs":[{"question":"새 질문","answer":"렌더러가 더한 문답"},') WHERE site_id = '${t.data.siteId}'`);
try {
  execFileSync("node", ["scripts/republish-all.mjs", "--apply", `--only=${tall.slug}`], { encoding: "utf8", env: { ...process.env, LIVE_PORT: "8787" } });
} catch {}
const runs3 = readdirSync("evidence/republish").sort();
const tallEntry = JSON.parse(readFileSync(`evidence/republish/${runs3.at(-1)}/report.json`, "utf8")).report[0];
check("높이가 바뀐 레이아웃 변경도 보류하고 diff 이미지를 남김", tallEntry?.result === "review" && tallEntry.diffs["home-mobile"].reason?.startsWith("size") &&
  readdirSync(`evidence/republish/${runs3.at(-1)}`).some((f) => f.startsWith(`${tall.slug}-home-mobile-diff`)), tallEntry?.diffs);
check("개인정보처리방침만 바뀌어도 보류", privacyEntry?.result === "review" && privacyEntry.diffs["privacy-mobile"].ratio > 0.0001, privacyEntry?.diffs);

const after = { same: pointerOf(same.slug), changed: pointerOf(changed.slug) };
const versionRow = (slug) => localD1(`SELECT v.asset_version, v.render_id FROM sites s JOIN site_versions v ON v.id = s.published_version_id WHERE s.id = '${ids[slug]}'`)[0];
check("적용된 사이트: 새 render_id로 서빙, 자산 버전 현재값", after.same.renderId === sameEntry.renderId && after.same.renderId !== before.same.renderId &&
  versionRow(same.slug).asset_version === plan.renderVersion && (await routerRequest(`${same.slug}.localhost`, "/")).status === 200);
check("보류된 사이트: 공개 화면 그대로", after.changed.renderId === before.changed.renderId && versionRow(changed.slug).asset_version === "old-assets" &&
  !(await routerRequest(`${changed.slug}.localhost`, "/")).body.includes("렌더러가 바뀐 문구"));

// Commit is refused once the live version moved on.
const staged = (await api("POST", `/sites/${ids[changed.slug]}/republish/stage`)).data;
const draft = await api("POST", `/sites/${ids[changed.slug]}/versions`, { config: changed });
await api("POST", `/sites/${ids[changed.slug]}/publish`, { versionId: draft.data.versionId });
const refused = await api("POST", `/sites/${ids[changed.slug]}/republish/commit`, { renderId: staged.renderId });
check("그사이 새 버전이 게시되면 적용 거부(409)", refused.status === 409 && pointerOf(changed.slug).versionId === draft.data.versionId);
// A stage from an earlier renderer deployment is refused.
const old = (await api("POST", `/sites/${ids[same.slug]}/republish/stage`)).data;
localD1(`UPDATE staged_renders SET asset_version = 'previous-deploy' WHERE render_id = '${old.renderId}'`);
check("이전 배포에서 만든 스테이지는 적용 거부(409)", (await api("POST", `/sites/${ids[same.slug]}/republish/commit`, { renderId: old.renderId })).status === 409);
// The live render changed after staging (e.g. a domain change re-rendered it): refused.
const fresh = (await api("POST", `/sites/${ids[same.slug]}/republish/stage`)).data;
localD1(`UPDATE site_versions SET render_id = '${old.renderId}' WHERE id = (SELECT published_version_id FROM sites WHERE id = '${ids[same.slug]}')`);
const moved = await api("POST", `/sites/${ids[same.slug]}/republish/commit`, { renderId: fresh.renderId });
check("스테이지 뒤 공개 렌더가 바뀌었으면 적용 거부(409)", moved.status === 409, moved.data);
check("없는 스테이지 적용은 404", (await api("POST", `/sites/${ids[same.slug]}/republish/commit`, { renderId: "nope" })).status === 404);

ev.finish({ ids, run: runs.at(-1) });
