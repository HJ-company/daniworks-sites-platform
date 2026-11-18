import { businessBasicTemplate, collectSeedValidationErrors } from "@dani-builder/site-templates";
import { allowedPickerIcons, isPickerIconName } from "./icons/allowlist.js";
import type { SiteConfig } from "./site-config.js";

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

function collectIcons(value: unknown, path: string, out: { path: string; name: string }[]) {
  if (Array.isArray(value)) {
    value.forEach((item, i) => collectIcons(item, `${path}[${i}]`, out));
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const childPath = path ? `${path}.${key}` : key;
      if (key === "icon" && typeof child === "string") out.push({ path: childPath, name: child });
      else collectIcons(child, childPath, out);
    }
  }
}

/** Every check a config must pass before it is stored. Returns human-readable errors. */
export function validateSiteConfig(config: SiteConfig): string[] {
  const errors: string[] = [];
  if (!SLUG.test(config.slug ?? "")) errors.push(`slug: 소문자·숫자·하이픈 1~40자 (${config.slug})`);
  if (config.templateId !== "business-basic") errors.push(`templateId: 지원하지 않는 템플릿 (${config.templateId})`);
  const compositions = Object.keys(businessBasicTemplate.compositions);
  if (!compositions.includes(config.compositionId)) errors.push(`compositionId: ${compositions.join("|")} 중 하나`);
  const palettes = Object.keys(businessBasicTemplate.palettes);
  if (!palettes.includes(config.paletteId)) errors.push(`paletteId: ${palettes.join("|")} 중 하나`);
  if (!config.meta?.title?.trim()) errors.push("meta.title: 필수");
  if (!config.meta?.description?.trim()) errors.push("meta.description: 필수");
  if (config.seed && compositions.includes(config.compositionId)) {
    const seedErrors = collectSeedValidationErrors(businessBasicTemplate, config.compositionId as never, config.seed);
    errors.push(...seedErrors.map((e) => `seed: ${String(e)}`));
  }
  const icons: { path: string; name: string }[] = [];
  collectIcons(config.seed, "seed", icons);
  for (const { path, name } of icons) {
    if (isPickerIconName(name) && !allowedPickerIcons.has(name)) {
      errors.push(`${path}: 허용 목록에 없는 아이콘 (${name})`);
    }
  }
  return errors;
}
