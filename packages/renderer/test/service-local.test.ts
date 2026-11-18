import { describe, expect, it } from "vitest";
import { serviceSiteConfigSchema } from "@sites/schema";
import { parseSiteConfig } from "../src/validate.js";
import { renderSite } from "../src/render.js";
import { compileServiceSeed } from "../src/templates/service-local/compile.js";
import { fieldFixture, lessonFixture } from "../src/templates/service-local/fixtures.js";
import { starterConfig } from "../src/templates/service-local/starter.js";

const clone = <T>(value: T): T => structuredClone(value);

describe("service-local template", () => {
  it.each([
    ["lesson", lessonFixture],
    ["field", fieldFixture],
  ])("accepts the %s fixture and compiles a valid Builder seed", (_, fixture) => {
    const result = parseSiteConfig(fixture);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("fills defaults and keeps the block order owned by the template", () => {
    const config = serviceSiteConfigSchema.parse(lessonFixture);
    const seed = compileServiceSeed(config);
    const home = seed.pages.find((page) => page.route === "/")!;
    expect(home.blocks.map((block) => block.__component)).toEqual([
      "blocks.hero",
      "blocks.features",
      "blocks.features",
      "blocks.highlights",
      "blocks.testimonials",
      "blocks.features",
      "blocks.faq",
      "blocks.inquiry-form",
      "blocks.cta",
    ]);
    expect(seed.pages.map((page) => page.route)).toEqual(["/", "/privacy"]);
    // TemplateSeed rejects undefined anywhere.
    expect(JSON.stringify(seed)).toBe(JSON.stringify(JSON.parse(JSON.stringify(seed))));
  });

  it("omits optional sections and still validates", () => {
    const minimal = clone(fieldFixture);
    delete minimal.content.process;
    delete minimal.content.gallery;
    delete minimal.content.testimonials;
    minimal.content.faqs = [];
    expect(parseSiteConfig(minimal).errors).toEqual([]);
  });

  it("reports content errors with paths", () => {
    const bad = clone(lessonFixture);
    bad.business.phone = "123";
    bad.content.services.items = [bad.content.services.items[0]!];
    bad.content.hero.image = { key: "../etc/passwd", alt: "x" };
    const errors = parseSiteConfig(bad).errors.join("\n");
    expect(errors).toMatch(/business\.phone/);
    expect(errors).toMatch(/content\.services\.items/);
    expect(errors).toMatch(/content\.hero\.image\.key/);
  });

  it("rejects unknown sample photos, palettes and icons outside the allowlist", () => {
    const bad = clone(lessonFixture);
    bad.paletteId = "neon";
    bad.content.hero.image = { key: "t:nope", alt: "x" };
    bad.content.services.items[1]!.icon = "FaRocket";
    const errors = parseSiteConfig(bad).errors.join("\n");
    expect(errors).toMatch(/paletteId/);
    expect(errors).toMatch(/FaRocket/);
    expect(errors).toMatch(/t:nope/);
  });

  it("renders home and privacy pages with contact chrome and structured data", async () => {
    const { pages } = await renderSite(lessonFixture, { assetBase: "/_shared/abc", origin: "https://jefes.dsites.kr" });
    expect(pages.map((page) => page.path)).toEqual(["index.html", "privacy/index.html"]);
    const [home, privacy] = pages;
    expect(home!.html).toContain('<link rel="canonical" href="https://jefes.dsites.kr/">');
    expect(home!.html).toContain('"@type":"SportsActivityLocation"');
    expect(home!.html).toContain('"@type":"FAQPage"');
    expect(home!.html).toContain('data-track="tel"');
    expect(home!.html).toContain('href="tel:01000000000"');
    expect(home!.html).toContain('name="consent"');
    expect(home!.html).toContain("og:image");
    expect(privacy!.html).toContain("<title>개인정보처리방침 | 제페스 풋볼 아카데미</title>");
    expect(privacy!.html).toContain("개인정보 보호책임자");
    expect(privacy!.html).not.toContain("application/ld+json");
  });

  it("preloads the LCP image with the same srcset and sizes as the image", async () => {
    const { html } = await renderSite(lessonFixture, { assetBase: "/a" });
    const preload = html.match(/<link rel="preload" as="image"[^>]*>/)?.[0] ?? "";
    const img = html.match(/<img[^>]*fetchpriority="high"[^>]*>/i)?.[0] ?? "";
    const attr = (tag: string, name: string) => tag.match(new RegExp(`\\s${name}="([^"]*)"`, "i"))?.[1];
    expect(preload).toContain('fetchpriority="high"');
    expect(attr(preload, "href")).toBe(attr(img, "src"));
    expect(attr(preload, "imagesrcset")).toBe(attr(img, "srcset"));
    expect(attr(preload, "imagesizes")).toBe(attr(img, "sizes"));
    expect(html.indexOf("rel=\"preload\"")).toBeLessThan(html.indexOf("site.css"));
  });

  it("marks previews noindex without canonical", async () => {
    const { html } = await renderSite(fieldFixture, { assetBase: "/a", origin: "https://x.dsites.kr", preview: true });
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(html).not.toContain("canonical");
  });

  it("keeps preview links inside the preview in both HTML and hydration data", async () => {
    const { pages } = await renderSite(lessonFixture, { assetBase: "/a", preview: true, linkPrefix: "/preview/tok" });
    for (const { html } of pages) {
      expect(html).not.toMatch(/href="\/(#|privacy|")/);
      expect(html).toContain('href="/preview/tok/privacy"');
      expect(html).toContain('"linkPrefix":"/preview/tok"');
      expect(html).toContain('href="/a/_assets/site.css"');
    }
  });

  it("resolves uploaded photos to the media path", async () => {
    const config = clone(fieldFixture);
    config.content.hero.image = { key: "m:site123/abc123.jpg", alt: "현장", width: 1600, height: 1067 };
    const { html } = await renderSite(config, { assetBase: "/a" });
    expect(html).toContain("/_media/site123/abc123.jpg");
  });
});

describe("starterConfig", () => {
  it.each(["lesson", "field"] as const)("is valid for %s", (preset) => {
    const config = starterConfig({ preset, slug: "new-site", name: "새 업체", phone: "010-0000-0000" });
    expect(parseSiteConfig(config).errors).toEqual([]);
  });
});
