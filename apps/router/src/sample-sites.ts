import type { SiteConfig } from "@sites/renderer";

/** Packaged compositions as stand-ins for customer configs until M1 adds the DB. */
export const sampleSites: Record<string, SiteConfig> = {
  sample: {
    slug: "sample",
    templateId: "business-basic",
    compositionId: "forest-stay",
    paletteId: "pine",
    meta: { title: "샘플 사이트 (forest-stay)", description: "M0 렌더 PoC" },
  },
  logistics: {
    slug: "logistics",
    templateId: "business-basic",
    compositionId: "logistics",
    paletteId: "ocean",
    meta: { title: "샘플 사이트 (logistics)", description: "M0 렌더 PoC" },
  },
  ceramics: {
    slug: "ceramics",
    templateId: "business-basic",
    compositionId: "ceramics",
    paletteId: "clay",
    meta: { title: "샘플 사이트 (ceramics)", description: "M0 렌더 PoC" },
  },
};
