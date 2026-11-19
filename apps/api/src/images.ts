import { storePhoto, type AssetResult } from "./assets.js";
import type { Env } from "./env.js";
import { HttpError } from "./http.js";
import { callOpenAi, checkPolicy, type ImageInput, type Purpose } from "./openai-images.js";
import type { SiteRow } from "./store.js";

export { PURPOSES, SIZES } from "./openai-images.js";

/** Generates an image under the policy (openai-images.ts) and stores it like any photo. */
export async function generateImage(
  env: Env,
  site: SiteRow,
  input: ImageInput,
  recordedBy: string | null = null,
): Promise<AssetResult & { aiGenerated: true; purpose: Purpose }> {
  if (site.cancelled_at) throw new HttpError(409, "해지된 사이트에는 사진을 만들 수 없습니다");
  checkPolicy(input);
  const bytes = await callOpenAi(env, input);
  const cost = env.IMAGE_COST_USD ? Number(env.IMAGE_COST_USD) : null;
  const stored = await storePhoto(env, site, bytes, {
    source: "ai",
    name: `ai:${env.OPENAI_IMAGE_MODEL}`,
    prompt: input.prompt,
    purpose: input.purpose,
    // The request as the AI recorded it, plus the operator who ran the tool.
    customerRequest: input.customerRequest ? JSON.stringify({ ...input.customerRequest, recordedBy }) : null,
    costUsd: Number.isFinite(cost) ? cost : null,
  });
  return { ...stored, aiGenerated: true, purpose: input.purpose };
}
