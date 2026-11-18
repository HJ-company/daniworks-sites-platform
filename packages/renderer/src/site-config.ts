import type { TemplateSeed } from "@dani-builder/site-templates";
import type { ServiceSiteConfig, ServiceSiteConfigInput } from "@sites/schema";

/**
 * v1 (M0/M1): a packaged Builder composition, optionally with a hand-written seed.
 * Kept so versions stored before M2 still render and roll back.
 */
export interface LegacySiteConfig {
  version?: 1;
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

/** Stored config: v2 is an industry template (`service-local`) plus structured content. */
export type SiteConfig = LegacySiteConfig | ServiceSiteConfig;
/** What authors send. v2 defaults (empty lists, flags) are filled by validation. */
export type SiteConfigInput = LegacySiteConfig | ServiceSiteConfigInput;

export const isServiceConfig = (config: { version?: unknown }): config is ServiceSiteConfig => config.version === 2;
