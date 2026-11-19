import { parseSiteConfig, starterConfig, type SiteConfig, type StarterInput } from "@sites/renderer";
import type { Env } from "./env.js";
import { HttpError } from "./http.js";
import { newSubscription } from "./billing.js";
import { getCustomerRow } from "./customers.js";
import { syncHostRecordsNow } from "./routes.js";
import { addVersion, createSite, getSite, type CreatedBy, type SiteRow } from "./store.js";

const CREATORS: CreatedBy[] = ["ai", "operator", "customer"];

/** Parsed config with defaults filled; what gets stored. Throws 422 with every problem. */
export function validated(input: unknown): SiteConfig {
  const result = parseSiteConfig(input);
  if (!result.ok) throw new HttpError(422, "설정 검증 실패", result.errors);
  return result.config;
}

export function creator(value: unknown): CreatedBy {
  return CREATORS.includes(value as CreatedBy) ? (value as CreatedBy) : "operator";
}

/**
 * New site with version 1, its `<slug>.<BASE_DOMAIN>` hostname and a subscription in the 시안
 * (trial) state; optionally linked to a customer. Nothing is public until paid and published.
 */
export async function createSiteFromInput(env: Env, input: unknown, createdBy: CreatedBy, customerId?: unknown) {
  const config = validated(input);
  if (customerId !== undefined && customerId !== null) {
    if (typeof customerId !== "string") throw new HttpError(422, "customerId는 문자열이어야 합니다");
    await getCustomerRow(env.DB, customerId);
  }
  const hostname = `${config.slug}.${env.BASE_DOMAIN}`;
  const { siteId, versionId } = await createSite(env.DB, config, createdBy, hostname, (id) => [
    newSubscription(env.DB, id),
    ...(customerId ? [env.DB.prepare("UPDATE sites SET customer_id = ? WHERE id = ?").bind(customerId, id)] : []),
  ]);
  await syncHostRecordsNow(env, siteId);
  return { siteId, versionId, hostname };
}

/** New draft version; nothing goes public until it is published. */
export async function addDraft(env: Env, site: SiteRow, input: unknown, createdBy: CreatedBy, note: string | null) {
  return addVersion(env.DB, site, validated(input), createdBy, note);
}

export function previewUrl(env: Env, previewToken: string) {
  return `${env.API_ORIGIN ?? ""}/preview/${previewToken}`;
}

/** Site by id or slug (MCP callers often know only the slug). */
export async function findSite(env: Env, idOrSlug: string): Promise<SiteRow> {
  const bySlug = await env.DB.prepare("SELECT id FROM sites WHERE slug = ?").bind(idOrSlug).first<{ id: string }>();
  return getSite(env.DB, bySlug?.id ?? idOrSlug);
}

/** Console "new site": either a full config or starter fields expanded server-side. */
export function configFromBody(body: { config?: unknown; starter?: Partial<StarterInput> }): unknown {
  if (body.config !== undefined) return body.config;
  const starter = body.starter;
  if (!starter || (starter.preset !== "lesson" && starter.preset !== "field")) {
    throw new HttpError(422, "config 또는 starter{preset, slug, name, phone}가 필요합니다");
  }
  return starterConfig({
    preset: starter.preset,
    slug: String(starter.slug ?? ""),
    name: String(starter.name ?? ""),
    phone: String(starter.phone ?? ""),
    representative: starter.representative ? String(starter.representative) : undefined,
  });
}
