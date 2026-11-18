import { compileServiceSeed, HOST_COMPOSITION, isServiceConfig, parseSiteConfig } from "@sites/renderer";
import type { Env } from "./env.js";
import { HttpError } from "./http.js";
import { siteOrigin } from "./publish.js";
import { getSite } from "./store.js";

/**
 * Hand-off to the AI homepage product (Strapi via create-daniworks-app's importer): the site's
 * content as a Builder TemplateSeed plus the selection it renders with. Uploaded photos get
 * absolute URLs so the importer can download them. The importer side lives in builder-v2.
 */
export async function templateSeedExport(env: Env, siteId: string, versionId?: string) {
  const site = await getSite(env.DB, siteId);
  const id = versionId ?? site.published_version_id;
  if (!id) throw new HttpError(409, "게시된 버전이 없습니다. versionId를 지정하세요");
  const row = await env.DB.prepare("SELECT number, config FROM site_versions WHERE id = ? AND site_id = ?").bind(id, siteId).first<{ number: number; config: string }>();
  if (!row) throw new HttpError(404, "버전이 없습니다");
  const parsed = parseSiteConfig(JSON.parse(row.config));
  if (!parsed.ok || !isServiceConfig(parsed.config)) throw new HttpError(422, "업종 템플릿(v2) 설정만 내보낼 수 있습니다");
  const config = parsed.config;
  const seed = compileServiceSeed(config);
  const origin = await siteOrigin(env, site);
  const assets = seed.assets.map((asset) =>
    asset.src.startsWith("/_media/") ? { ...asset, src: `${origin}${asset.src}`, sourceUrl: `${origin}${asset.src}`, sourceImageUrl: `${origin}${asset.src}` } : asset,
  );
  return {
    format: "dani-builder.template-seed",
    selection: { templateId: "business-basic", compositionId: HOST_COMPOSITION, paletteId: config.paletteId, themeId: "open-atelier" },
    source: { siteId, slug: site.slug, version: row.number, templateId: config.templateId, preset: config.preset },
    business: config.business,
    seed: { ...seed, assets },
  };
}
