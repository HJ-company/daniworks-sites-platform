// M2 step 2-1/2-2: config v2 + `service-local` industry template, end to end.
// create → validation errors → preview (home, privacy) → publish → router pages, sitemap,
// structured data → browser (mobile/desktop) → Lighthouse mobile. Uses local-only fixtures.
import { writeFileSync } from "node:fs";
import { api, chromium, evidence, inspectPage, lighthouse, ROUTER_PORT, routerRequest, uploadShared, viewports } from "./lib/verify.mjs";

// Node strips the TypeScript types (type-only imports) at load time.
const { fieldFixture, lessonFixture } = await import("../packages/renderer/src/templates/service-local/fixtures.ts");

const ev = evidence("m2-template");
const { check } = ev;
const run = Date.now().toString(36);

uploadShared();

// 1. validation: bad content is rejected with paths, nothing is stored
const bad = structuredClone(lessonFixture);
bad.slug = `bad-${run}`;
bad.business.phone = "123";
bad.content.services.items = bad.content.services.items.slice(0, 1);
const rejected = await api("POST", "/sites", { config: bad, createdBy: "ai" });
check(
  "잘못된 v2 설정은 422와 경로별 오류",
  rejected.status === 422 &&
    rejected.data.details.some((d) => d.startsWith("business.phone")) &&
    rejected.data.details.some((d) => d.startsWith("content.services.items")),
  { details: rejected.data.details },
);

const sites = {};
for (const [name, fixture] of Object.entries({ lesson: lessonFixture, field: fieldFixture })) {
  const config = { ...structuredClone(fixture), slug: `${fixture.slug}-${run}` };
  const created = await api("POST", "/sites", { config, createdBy: "ai" });
  check(`${name}: 사이트 생성 201`, created.status === 201, { hostname: created.data.hostname });
  const site = (await api("GET", `/sites/${created.data.siteId}`)).data;
  sites[name] = { ...created.data, slug: config.slug, token: site.versions[0].preview_token };

  // 2. stored config has defaults filled (parsed, not raw)
  check(`${name}: 저장된 설정은 v2`, site.site.template_id === "service-local");

  // 3. preview
  const home = await fetch(`${process.env.API_URL ?? "http://127.0.0.1:8788"}/preview/${sites[name].token}`);
  const homeHtml = await home.text();
  check(
    `${name}: 프리뷰 홈 200, noindex, 링크가 프리뷰 안에 머묾`,
    home.status === 200 &&
      homeHtml.includes('name="robots" content="noindex') &&
      homeHtml.includes(`href="/preview/${sites[name].token}/privacy"`) &&
      !/href="\/(#|privacy)/.test(homeHtml),
  );
  const privacy = await fetch(`${process.env.API_URL ?? "http://127.0.0.1:8788"}/preview/${sites[name].token}/privacy`);
  check(`${name}: 프리뷰 개인정보처리방침 200`, privacy.status === 200 && (await privacy.text()).includes("개인정보 보호책임자"));

  // 4. publish and serve
  const published = await api("POST", `/sites/${created.data.siteId}/publish`);
  check(`${name}: 게시 200`, published.status === 200 && published.data.pages?.join() === "/,/privacy", published.data);
  const host = `${config.slug}.localhost`;
  const live = await routerRequest(host, "/");
  check(
    `${name}: 공개 홈 200 + canonical + JSON-LD + 연락 바`,
    live.status === 200 &&
      live.body.includes(`<link rel="canonical" href="http://${host}/">`) &&
      live.body.includes('"@type":"FAQPage"') &&
      live.body.includes('data-track="tel"'),
  );
  const livePrivacy = await routerRequest(host, "/privacy");
  check(`${name}: 공개 /privacy 200`, livePrivacy.status === 200 && livePrivacy.body.includes("개인정보처리방침"));
  const sitemap = await routerRequest(host, "/sitemap.xml");
  check(`${name}: sitemap에 /privacy 포함`, sitemap.body.includes(`https://${host}/privacy`));
  check(`${name}: 없는 경로 404`, (await routerRequest(host, "/nope")).status === 404);
}

// 5. browser
const browser = await chromium().launch();
const kakao = ["https://pf.kakao.com/", "https://open.kakao.com/"];
{
  const api = process.env.API_URL ?? "http://127.0.0.1:8788";
  const r = await inspectPage(browser, `${api}/preview/${sites.lesson.token}`, viewports.mobile, { allowExternal: kakao });
  const privacyHref = await r.page.locator("footer a", { hasText: "개인정보처리방침" }).getAttribute("href");
  await r.page.locator("form input[name=name]").fill("테스트");
  await r.page.locator("form input[name=phone]").fill("010-1111-2222");
  await r.page.locator("form textarea[name=message]").fill("프리뷰 전송 시험");
  await r.page.locator("form input[name=consent]").check();
  await r.page.locator("form button[type=submit]").click();
  const blocked = await r.page.getByRole("alert").textContent();
  check(
    "프리뷰: 하이드레이션 오류 없음, 링크가 프리뷰 안, 문의 전송 차단",
    r.hydrated && !r.errors.length && privacyHref === `/preview/${sites.lesson.token}/privacy` && blocked?.includes("프리뷰"),
    { errors: r.errors, privacyHref, blocked },
  );
  await r.page.close();
}
for (const [name, site] of Object.entries(sites)) {
  const url = `http://${site.slug}.localhost:${ROUTER_PORT}/`;
  for (const [vp, viewport] of Object.entries(viewports)) {
    const r = await inspectPage(browser, url, viewport, { screenshot: `${ev.dir}/${name}-${vp}.png`, allowExternal: kakao });
    const bar = await r.page.locator(".sites-contact-bar").isVisible();
    const form = await r.page.locator("form input[name=phone]").isVisible();
    check(
      `${name}: 브라우저 ${vp}`,
      r.hydrated && !r.errors.length && !r.failed.length && !r.external.length && !r.unloadedImages.length && form &&
        bar === (vp === "mobile"),
      { errors: r.errors, failed: r.failed, external: r.external, unloaded: r.unloadedImages.length, contactBar: bar },
    );
    await r.page.close();
  }
}
await browser.close();

// 6. Lighthouse mobile
const scores = {};
for (const [name, site] of Object.entries(sites)) {
  const { report, ...score } = await lighthouse(`http://${site.slug}.localhost:${ROUTER_PORT}/`);
  scores[name] = score;
  writeFileSync(`${ev.dir}/lighthouse-${name}.json`, JSON.stringify(report));
  check(`${name}: Lighthouse 모바일 성능 90 이상, LCP 2.5초 이하`, score.performance >= 90 && score.lcpMs <= 2500, score);
  check(`${name}: Lighthouse SEO 90 이상, 접근성 90 이상`, score.seo >= 90 && score.accessibility >= 90, score);
}

ev.finish({ sites, scores });
