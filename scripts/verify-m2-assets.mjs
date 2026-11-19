// M2 step 2-3: photo upload. Orientation, downsizing, WebP variants, limits, idempotency,
// serving from API (preview) and router (published), and use inside a published v2 site.
import { createRequire } from "node:module";
import { API, ROUTER_PORT, TOKEN, api, chromium, evidence, inspectPage, routerRequest, uploadShared, viewports, paySite } from "./lib/verify.mjs";

const sharp = createRequire(new URL("../packages/renderer/package.json", import.meta.url))("sharp");
const { lessonFixture } = await import("../packages/renderer/src/templates/service-local/fixtures.ts");

const ev = evidence("m2-assets");
const { check } = ev;
const run = Date.now().toString(36);

async function upload(siteId, body, type, { auth = true } = {}) {
  const res = await fetch(`${API}/sites/${siteId}/assets`, {
    method: "POST",
    headers: { ...(auth ? { authorization: `Bearer ${TOKEN}` } : {}), "content-type": type },
    body,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

/** Solid two-tone image: top half red, bottom half blue. */
async function twoTone(width, height) {
  const half = Buffer.alloc(width * Math.floor(height / 2) * 3);
  const top = Buffer.from(half.map((_, i) => (i % 3 === 0 ? 220 : 20)));
  const bottom = Buffer.from(Buffer.alloc(width * (height - Math.floor(height / 2)) * 3).map((_, i) => (i % 3 === 2 ? 220 : 20)));
  return sharp(Buffer.concat([top, bottom]), { raw: { width, height, channels: 3 } });
}

async function pixel(buffer, xr, yr) {
  const img = sharp(buffer);
  const { width, height } = await img.metadata();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const x = Math.floor(width * xr);
  const y = Math.floor(height * yr);
  const i = (y * info.width + x) * info.channels;
  return { r: data[i], g: data[i + 1], b: data[i + 2] };
}
const isRed = (p) => p.r > 150 && p.b < 100;
const isBlue = (p) => p.b > 150 && p.r < 100;

uploadShared();
const config = { ...structuredClone(lessonFixture), slug: `assets-${run}` };
const created = await api("POST", "/sites", { config, createdBy: "operator" });
const siteId = created.data.siteId;
await paySite(siteId);
check("사이트 생성", created.status === 201);

// 1. sideways photo (downsized by the console): 2000×1500 stored landscape, EXIF orientation 6
const phone = await (await twoTone(2000, 1500)).jpeg({ quality: 90 }).withMetadata({ orientation: 6 }).toBuffer();
const up1 = await upload(siteId, phone, "image/jpeg");
check("EXIF 회전 사진: 201, 세로 1200×1600으로 줄임", up1.status === 201 && up1.data.width === 1200 && up1.data.height === 1600, up1.data);
const main = Buffer.from(await (await fetch(`${API}${up1.data.url}`)).arrayBuffer());
const right = await pixel(main, 0.9, 0.5);
const left = await pixel(main, 0.1, 0.5);
check("EXIF 방향 적용: 원래 위쪽(빨강)이 오른쪽", isRed(right) && isBlue(left), { right, left });
check("결과물에 EXIF 방향 없음", ((await sharp(main).metadata()).orientation ?? 1) === 1);

// 2. variants and caching via API and router
const host = `${config.slug}.localhost`;
for (const w of [480, 800]) {
  const path = up1.data.url.replace(/\.jpg$/, `.w${w}.webp`);
  const viaApi = await fetch(`${API}${path}`);
  const buf = Buffer.from(await viaApi.arrayBuffer());
  const meta = await sharp(buf).metadata();
  check(`변형 w${w}: WebP, 폭 ${w}, 영구 캐시`, viaApi.status === 200 && meta.format === "webp" && meta.width === w &&
    viaApi.headers.get("cache-control")?.includes("immutable"));
}
const viaRouter = await routerRequest(host, up1.data.url);
check("라우터도 /_media 서빙", viaRouter.status === 200 && viaRouter.headers["content-type"] === "image/jpeg");
check("없는 미디어 404", (await routerRequest(host, `/_media/${siteId}/nope.jpg`)).status === 404);

// 3. idempotent: same bytes → same key
const again = await upload(siteId, phone, "image/jpeg");
check("같은 사진 재업로드는 같은 키", again.status === 201 && again.data.key === up1.data.key);

// 4. PNG and WebP input
const png = await (await twoTone(800, 600)).png().toBuffer();
const up2 = await upload(siteId, png, "image/png");
check("PNG 입력 → JPEG 800×600", up2.status === 201 && up2.data.width === 800 && up2.data.key.endsWith(".jpg"), up2.data);
for (const w of [480, 800, 1200]) {
  const res = await fetch(`${API}${up2.data.url.replace(/\.jpg$/, `.w${w}.webp`)}`);
  const meta = res.ok ? await sharp(Buffer.from(await res.arrayBuffer())).metadata() : null;
  check(`작은 사진도 광고한 변형 w${w}이 있음 (폭 ${Math.min(w, 800)})`, meta?.width === Math.min(w, 800));
}
const webp = await (await twoTone(1000, 500)).webp().toBuffer();
const up3 = await upload(siteId, webp, "image/webp");
check("WebP 입력 → 1000×500", up3.status === 201 && up3.data.width === 1000 && up3.data.height === 500, up3.data);

// Transparent PNG: main JPEG and WebP variant must both show white where it was transparent.
const transparent = await sharp({ create: { width: 600, height: 400, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
const upT = await upload(siteId, transparent, "image/png");
const tMain = Buffer.from(await (await fetch(`${API}${upT.data.url}`)).arrayBuffer());
const tVar = Buffer.from(await (await fetch(`${API}${upT.data.url.replace(/\.jpg$/, ".w480.webp")}`)).arrayBuffer());
const [pm, pv] = [await pixel(tMain, 0.5, 0.5), await pixel(tVar, 0.5, 0.5)];
check("투명 PNG: JPEG와 WebP 모두 흰 배경", pm.r > 240 && pm.g > 240 && pv.r > 240 && pv.g > 240 && pv.b > 240, { pm, pv });

// 5. limits and errors
// A 12 MP phone original would exceed the 128 MB isolate when decoded: refused from the header.
const giant = await (await twoTone(4000, 3000)).jpeg().toBuffer();
const tooMany = await upload(siteId, giant, "image/jpeg");
check("3MP 넘는 해상도는 413 (디코딩 전 거부, 줄이라는 안내)", tooMany.status === 413 && tooMany.data.error.includes("줄여서"), tooMany.data);
const tooBig = await upload(siteId, Buffer.alloc(16 * 1024 * 1024, 1), "image/jpeg");
check("15MB 넘는 파일은 413", tooBig.status === 413);
// Chunked body without Content-Length: the limit must hold while streaming.
const chunked = new ReadableStream({
  start(controller) {
    for (let i = 0; i < 17; i++) controller.enqueue(new Uint8Array(1024 * 1024).fill(1));
    controller.close();
  },
});
const streamed = await fetch(`${API}/sites/${siteId}/assets`, {
  method: "POST",
  headers: { authorization: `Bearer ${TOKEN}`, "content-type": "image/jpeg" },
  body: chunked,
  duplex: "half",
});
check("Content-Length 없는 스트림도 15MB 넘으면 413", streamed.status === 413);
const narrow = await sharp({ create: { width: 1, height: 4000, channels: 3, background: "#123" } }).png().toBuffer();
const upNarrow = await upload(siteId, narrow, "image/png");
check("1×4000 같은 좁은 사진도 처리(폭 최소 1px)", upNarrow.status === 201 && upNarrow.data.width === 1 && upNarrow.data.height === 1600, upNarrow.data);
check("이미지가 아니면 415", (await upload(siteId, Buffer.from("hello"), "text/plain")).status === 415);
check("큰 JSON 본문은 파싱 전에 413", (await upload(siteId, JSON.stringify({ url: "https://x/" + "a".repeat(10000) }), "application/json")).status === 413);
check("http URL 가져오기는 400", (await upload(siteId, JSON.stringify({ url: "http://example.com/a.jpg" }), "application/json")).status === 400);
check("인증 없으면 401", (await upload(siteId, png, "image/png", { auth: false })).status === 401);
const list = await api("GET", `/sites/${siteId}/assets`);
check("목록에 5장", list.status === 200 && list.data.assets.length === 5, { count: list.data.assets?.length });

// 6. use the upload in a published site
const v2 = structuredClone(config);
v2.content.hero.image = { key: up1.data.key, alt: "현장 사진", width: up1.data.width, height: up1.data.height };
v2.content.gallery.items[0].image = { key: up2.data.key, alt: "작업 사진", width: up2.data.width, height: up2.data.height };
const version = await api("POST", `/sites/${siteId}/versions`, { config: v2, createdBy: "operator" });
const published = await api("POST", `/sites/${siteId}/publish`, { versionId: version.data.versionId });
const page = await routerRequest(host, "/");
check(
  "게시 페이지에 업로드 사진과 srcset 변형",
  published.status === 200 && page.body.includes(up1.data.url) && page.body.includes(up1.data.url.replace(".jpg", ".w800.webp 800w")),
);
const browser = await chromium().launch();
const r = await inspectPage(browser, `http://${host}:${ROUTER_PORT}/`, viewports.mobile, {
  screenshot: `${ev.dir}/site-mobile.png`,
  allowExternal: ["https://pf.kakao.com/"],
});
const heroSrc = await r.page.locator("main img").first().evaluate((img) => img.currentSrc);
check("브라우저: 이미지 모두 로드, 히어로는 WebP 변형", !r.failed.length && !r.unloadedImages.length && !r.errors.length && heroSrc.endsWith(".webp"), {
  heroSrc,
  failed: r.failed,
  errors: r.errors,
});
await browser.close();

ev.finish({ siteId });
