import type { Preset, ServiceSiteConfigInput } from "@sites/schema";
import { presets } from "./presets.js";

export interface StarterInput {
  preset: Preset;
  slug: string;
  name: string;
  phone: string;
  representative?: string;
}

/** Marks copy the operator or the AI still has to write; drafts that contain it are flagged. */
export const TODO = "(작성 필요)";

/**
 * A valid starting config for a new site from the console: real identity fields, placeholder
 * copy marked "(작성 필요)" and sample photos. Operators or the AI replace the rest.
 */
export function starterConfig({ preset, slug, name, phone, representative }: StarterInput): ServiceSiteConfigInput {
  const spec = presets[preset];
  const lesson = preset === "lesson";
  return {
    version: 2,
    slug,
    templateId: "service-local",
    preset,
    paletteId: spec.defaultPalette,
    meta: { title: `${name} ${TODO}`, description: `${name} 소개 ${TODO}` },
    business: { name, phone, representative: representative || "확인 필요", hours: [], serviceAreas: [] },
    content: {
      hero: {
        kicker: `${spec.label} ${TODO}`,
        heading: `${name}\n대표 문구 ${TODO}`,
        subheading: `근거가 되는 사실 ${TODO}`,
        image: { key: lesson ? "t:pine-trail" : "t:pine-interior", alt: "샘플 사진" },
      },
      services: {
        heading: lesson ? "수업 안내" : "서비스",
        items: [
          { label: `${lesson ? "수업" : "서비스"} 1 ${TODO}`, description: `설명 ${TODO}` },
          { label: `${lesson ? "수업" : "서비스"} 2 ${TODO}`, description: `설명 ${TODO}` },
        ],
      },
      faqs: [],
      cta: { heading: `${spec.inquiryCta} 안내 ${TODO}` },
      inquiry: { heading: spec.inquiryCta, subheading: "이름과 연락처, 궁금한 점을 남겨주세요." },
    },
  };
}
