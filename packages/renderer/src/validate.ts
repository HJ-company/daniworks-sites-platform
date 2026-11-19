import { businessBasicTemplate, collectSeedValidationErrors, type TemplateSeed } from "@dani-builder/site-templates";
import { formatIssues, SLUG_PATTERN, serviceSiteConfigSchema } from "@sites/schema";
import { allowedPickerIcons, isPickerIconName } from "./icons/allowlist.js";
import type { LegacySiteConfig, SiteConfig, SiteConfigInput } from "./site-config.js";
import { compileServiceSeed } from "./templates/service-local/compile.js";

/** Composition the Builder preview hosts a compiled seed in; only its seed is replaced. */
export const HOST_COMPOSITION = "forest-stay";

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

function iconErrors(value: unknown, root: string): string[] {
  const icons: { path: string; name: string }[] = [];
  collectIcons(value, root, icons);
  return icons
    .filter(({ name }) => isPickerIconName(name) && !allowedPickerIcons.has(name))
    .map(({ path, name }) => `${path}: 허용 목록에 없는 아이콘 (${name})`);
}

function paletteErrors(paletteId: string): string[] {
  const palettes = Object.keys(businessBasicTemplate.palettes);
  return palettes.includes(paletteId) ? [] : [`paletteId: ${palettes.join("|")} 중 하나`];
}

function seedErrors(compositionId: string, seed: TemplateSeed): string[] {
  return collectSeedValidationErrors(businessBasicTemplate, compositionId as never, seed).map((e) => `seed: ${String(e)}`);
}

function validateLegacy(config: LegacySiteConfig): string[] {
  const errors: string[] = [];
  if (!SLUG_PATTERN.test(config.slug ?? "")) errors.push(`slug: 소문자·숫자·하이픈 1~40자 (${config.slug})`);
  if (config.templateId !== "business-basic") errors.push(`templateId: service-local(version 2) 또는 business-basic (${config.templateId})`);
  const compositions = Object.keys(businessBasicTemplate.compositions);
  if (!compositions.includes(config.compositionId)) errors.push(`compositionId: ${compositions.join("|")} 중 하나`);
  errors.push(...paletteErrors(config.paletteId));
  if (!config.meta?.title?.trim()) errors.push("meta.title: 필수");
  if (!config.meta?.description?.trim()) errors.push("meta.description: 필수");
  if (config.seed && compositions.includes(config.compositionId)) errors.push(...seedErrors(config.compositionId, config.seed));
  errors.push(...iconErrors(config.seed, "seed"));
  return errors;
}

export type Validation = { ok: true; config: SiteConfig; errors: [] } | { ok: false; errors: string[] };

/**
 * Every check a config must pass before it is stored. v2 configs are parsed (defaults filled),
 * compiled into a Builder seed and checked against the Builder contract, so an invalid
 * template output can never be saved.
 */
export function parseSiteConfig(input: SiteConfigInput | unknown): Validation {
  const raw = (input ?? {}) as { version?: unknown };
  if (raw.version === 2) {
    const parsed = serviceSiteConfigSchema.safeParse(input);
    if (!parsed.success) return { ok: false, errors: formatIssues(parsed.error) };
    const config = parsed.data;
    const errors = [...paletteErrors(config.paletteId), ...iconErrors(config.content, "content")];
    try {
      errors.push(...seedErrors(HOST_COMPOSITION, compileServiceSeed(config)));
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
    return errors.length ? { ok: false, errors } : { ok: true, config, errors: [] };
  }
  if (raw.version !== undefined && raw.version !== 1) return { ok: false, errors: ["version: 1 또는 2"] };
  const errors = validateLegacy(input as LegacySiteConfig);
  return errors.length ? { ok: false, errors } : { ok: true, config: input as LegacySiteConfig, errors: [] };
}

