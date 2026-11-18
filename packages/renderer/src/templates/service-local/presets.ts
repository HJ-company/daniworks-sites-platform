import type { Preset } from "@sites/schema";

/** What differs between a lesson academy and a field-service business. Copy comes from the config. */
export interface PresetSpec {
  label: string;
  defaultPalette: string;
  schemaType: "EducationalOrganization" | "HomeAndConstructionBusiness";
  inquiryCta: string;
  heroVariant: "side-by-side" | "media-extending";
  servicesVariant: "dual-column" | "simple-grid";
  galleryVariant: "triple-column" | "dual-column";
  nav: { services: string; gallery: string; reviews: string; info: string };
  infoHeading: string;
  areasLabel: string;
}

export const presets: Record<Preset, PresetSpec> = {
  lesson: {
    label: "레슨·교육",
    defaultPalette: "ocean",
    schemaType: "EducationalOrganization",
    inquiryCta: "수업 상담",
    heroVariant: "side-by-side",
    servicesVariant: "dual-column",
    galleryVariant: "triple-column",
    nav: { services: "수업 안내", gallery: "수업 현장", reviews: "수강 후기", info: "시간·장소" },
    infoHeading: "수업 시간과 장소",
    areasLabel: "수업 장소",
  },
  field: {
    label: "출장 서비스",
    defaultPalette: "pine",
    schemaType: "HomeAndConstructionBusiness",
    inquiryCta: "견적 문의",
    heroVariant: "media-extending",
    servicesVariant: "simple-grid",
    galleryVariant: "dual-column",
    nav: { services: "서비스", gallery: "작업 사례", reviews: "고객 후기", info: "상담·지역" },
    infoHeading: "상담 시간과 출장 지역",
    areasLabel: "출장 지역",
  },
};
