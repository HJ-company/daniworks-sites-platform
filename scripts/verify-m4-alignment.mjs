// M4 step 4-A: code aligned with the PRD. Suspended sites show only the business name (503,
// Retry-After, no contact details); cancelled data is kept for a year; customers are told to
// CNAME to the fallback origin that actually exists.
import { api, evidence, localKv, routerRequest, uploadShared } from "./lib/verify.mjs";

const { fieldFixture } = await import("../packages/renderer/src/templates/service-local/fixtures.ts");
const ev = evidence("m4-alignment");
const { check } = ev;
const run = Date.now().toString(36);

uploadShared();

// 1. suspended page
const config = structuredClone(fieldFixture);
config.slug = `align-${run}`;
config.business.name = "상쾌공간 & 청소 <본점>";
const host = `${config.slug}.localhost`;
const created = await api("POST", "/sites", { config, createdBy: "operator" });
const siteId = created.data.siteId;
await api("POST", `/sites/${siteId}/publish`);
check("게시 후 호스트 레코드에 업체명", JSON.parse(localKv("get", `host:${host}`)).name === config.business.name);

await api("POST", `/sites/${siteId}/suspend`);
const down = await routerRequest(host, "/");
check("중단: 503 + Retry-After + noindex + 캐시 안 함", down.status === 503 && down.headers["retry-after"] === "86400" && down.body.includes("noindex") && down.headers["cache-control"] === "no-store");
check("중단 페이지: 업체명(이스케이프)과 준비 중 안내", down.body.includes("상쾌공간 &amp; 청소 &lt;본점&gt;") && down.body.includes("준비하고 있습니다") && !down.body.includes("<본점>"));
check(
  "중단 페이지: 연락처·주소·문의 폼·연체 문구 없음",
  !down.body.includes(config.business.phone) && !down.body.includes("tel:") && !down.body.includes("<form") && !/연체|미납|결제|정지/.test(down.body),
);
const sub = await routerRequest(host, "/privacy");
check("중단: 하위 페이지도 같은 안내", sub.status === 503 && sub.body.includes("준비하고 있습니다"));

// A record written before M4 has no name: generic notice, still 503.
const legacy = { ...JSON.parse(localKv("get", `host:${host}`)) };
delete legacy.name;
localKv("put", `host:${host}`, JSON.stringify(legacy));
const generic = await routerRequest(host, "/");
check("업체명 없는 옛 레코드: 일반 안내 503", generic.status === 503 && generic.body.includes("홈페이지 준비 중"));

await api("POST", `/sites/${siteId}/resume`);
check("재개: 다시 200", (await routerRequest(host, "/")).status === 200);

ev.finish();
