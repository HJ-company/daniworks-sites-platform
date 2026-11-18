import { businessBasicTemplate } from "@dani-builder/site-templates";
import { createTemplatePreview } from "@dani-builder/site-templates/preview";
import type { SiteConfig } from "./site-config.js";
import { validateSiteConfig } from "./validate.js";
import type { PageData } from "./view.js";

/** Builder release the blocks package targets; seeds are validated against it. */
export const BUILDER_VERSION = "0.16.0";

export class SiteConfigError extends Error {
  constructor(readonly errors: readonly string[]) {
    super(`Invalid site config:\n- ${errors.join("\n- ")}`);
  }
}

/** Validates a site config and projects it into the props the view renders. */
export function toPageData(config: SiteConfig, assetBase: string): PageData {
  const manifest = businessBasicTemplate;
  const errors = validateSiteConfig(config);
  if (errors.length) throw new SiteConfigError(errors);
  const preview = createTemplatePreview({
    manifest,
    selection: {
      templateId: manifest.id,
      templateVersion: manifest.version,
      themeId: "open-atelier",
      compositionId: config.compositionId,
      paletteId: config.paletteId,
    },
    seed: config.seed,
    builderVersion: BUILDER_VERSION,
    resolveAsset: (asset) => ({
      url: `${assetBase}/site-templates/${asset.src.replace(/^assets\/business-basic\//, "")}`,
    }),
  });
  // Starter homepage is one page: home only.
  const home = preview.pages.find((entry) => entry.route === "/");
  if (!home) throw new SiteConfigError(["composition has no home route"]);
  return {
    page: home.page,
    navigation: preview.navigation,
    footer: preview.footer,
    brandColors: preview.brandColors,
  };
}
