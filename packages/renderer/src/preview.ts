import { businessBasicTemplate, type TemplateSeed } from "@dani-builder/site-templates";
import { createTemplatePreview } from "@dani-builder/site-templates/preview";
import { isServiceConfig, type SiteConfig, type SiteConfigInput } from "./site-config.js";
import { compileServiceSeed, telHref } from "./templates/service-local/compile.js";
import { presets } from "./templates/service-local/presets.js";
import { HOST_COMPOSITION, parseSiteConfig } from "./validate.js";
import type { PageData, SiteChrome } from "./view.js";

/** Builder release the blocks package targets; seeds are validated against it. */
export const BUILDER_VERSION = "0.16.0";

export class SiteConfigError extends Error {
  constructor(readonly errors: readonly string[]) {
    super(`Invalid site config:\n- ${errors.join("\n- ")}`);
  }
}

export interface SitePage {
  /** `/` or `/privacy`. */
  route: string;
  title: string;
  data: PageData;
}

function chrome(config: SiteConfig): SiteChrome | null {
  if (!isServiceConfig(config)) return null;
  const { business } = config;
  return {
    name: business.name,
    tel: telHref(business.phone),
    kakaoUrl: business.kakaoUrl ?? null,
    mapUrl: business.mapUrl ?? null,
    bookingUrl: business.bookingUrl ?? null,
    inquiryLabel: presets[config.preset].inquiryCta,
    blogUrl: business.blogUrl ?? null,
  };
}

/** Validates a config; throws SiteConfigError with every problem. */
export function requireValidConfig(input: SiteConfigInput): SiteConfig {
  const parsed = parseSiteConfig(input);
  if (!parsed.ok) throw new SiteConfigError(parsed.errors);
  return parsed.config;
}

/** Validates a config and projects every page into the props the view renders. */
export function toSitePages(input: SiteConfigInput, assetBase: string): SitePage[] {
  return sitePagesFor(requireValidConfig(input), assetBase);
}

/** Projects an already validated config into page props. */
export function sitePagesFor(config: SiteConfig, assetBase: string): SitePage[] {
  const manifest = businessBasicTemplate;
  const service = isServiceConfig(config);
  const seed: TemplateSeed | undefined = service ? compileServiceSeed(config) : config.seed;
  const preview = createTemplatePreview({
    manifest,
    selection: {
      templateId: manifest.id,
      templateVersion: manifest.version,
      themeId: "open-atelier",
      compositionId: service ? HOST_COMPOSITION : config.compositionId,
      paletteId: config.paletteId,
    },
    seed,
    builderVersion: BUILDER_VERSION,
    resolveAsset: (asset) => ({
      url: asset.src.startsWith("/_media/")
        ? asset.src
        : `${assetBase}/site-templates/${asset.src.replace(/^assets\/business-basic\//, "")}`,
    }),
  });
  const site = chrome(config);
  // v1 is one page (home). v2 adds the privacy page.
  const routes = service ? ["/", "/privacy"] : ["/"];
  return routes.map((route) => {
    const entry = preview.pages.find((page) => page.route === route);
    if (!entry) throw new SiteConfigError([`composition has no ${route} route`]);
    return {
      route,
      title: entry.page.title ?? "",
      data: {
        page: entry.page,
        navigation: preview.navigation,
        footer: preview.footer,
        brandColors: preview.brandColors,
        route,
        site,
      },
    };
  });
}

/** Home page only (M1 callers). */
export function toPageData(config: SiteConfigInput, assetBase: string): PageData {
  return toSitePages(config, assetBase)[0]!.data;
}
