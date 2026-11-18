import type { TemplateSeed } from "@dani-builder/site-templates";

/**
 * One site = one config row. M0 keeps it minimal: a template selection plus
 * an optional seed that replaces the packaged composition seed.
 */
export interface SiteConfig {
  slug: string;
  templateId: "business-basic";
  compositionId: string;
  paletteId: string;
  /** Customer content. Omit to use the packaged composition seed. */
  seed?: TemplateSeed;
  meta: {
    title: string;
    description: string;
    lang?: string;
  };
}
