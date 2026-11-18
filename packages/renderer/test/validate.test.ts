import { describe, expect, it } from "vitest";
import { businessBasicTemplate } from "@dani-builder/site-templates";
import { validateSiteConfig } from "../src/validate.js";
import { renderSite } from "../src/render.js";
import type { SiteConfig } from "../src/site-config.js";

const base: SiteConfig = {
  slug: "gongbang",
  templateId: "business-basic",
  compositionId: "forest-stay",
  paletteId: "pine",
  meta: { title: "공방", description: "설명" },
};

function seedWithIcon(icon: string) {
  const seed = structuredClone(businessBasicTemplate.compositions["forest-stay"].seed);
  const json = JSON.stringify(seed).replace('"icon":null', JSON.stringify({ icon }).slice(1, -1));
  return JSON.parse(json);
}

describe("validateSiteConfig", () => {
  it("accepts a packaged composition", () => {
    expect(validateSiteConfig(base)).toEqual([]);
  });

  it("rejects a bad slug, composition and missing meta", () => {
    const errors = validateSiteConfig({ ...base, slug: "Bad Slug", compositionId: "nope", meta: { title: "", description: "" } });
    expect(errors.join("\n")).toMatch(/slug/);
    expect(errors.join("\n")).toMatch(/compositionId/);
    expect(errors.join("\n")).toMatch(/meta.title/);
  });

  it("rejects a missing or unknown legacy templateId", () => {
    expect(validateSiteConfig({ ...base, templateId: undefined } as never).join("\n")).toMatch(/templateId/);
    expect(validateSiteConfig({ ...base, templateId: "other" } as never).join("\n")).toMatch(/templateId/);
  });

  it("accepts allowlisted and built-in icons", () => {
    expect(validateSiteConfig({ ...base, seed: seedWithIcon("FaPhone") })).toEqual([]);
    expect(validateSiteConfig({ ...base, seed: seedWithIcon("phone") })).toEqual([]);
  });

  it("rejects picker icons outside the allowlist", () => {
    const errors = validateSiteConfig({ ...base, seed: seedWithIcon("FaRocket") });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/FaRocket/);
  });
});

describe("renderSite", () => {
  it("renders a full document with versioned asset paths", async () => {
    const { html } = await renderSite(base, { assetBase: "/_shared/abc" });
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain('<link rel="stylesheet" href="/_shared/abc/_assets/site.css">');
    expect(html).toContain("/_shared/abc/site-templates/");
    expect(html).toContain("<title>공방</title>");
  });
});
