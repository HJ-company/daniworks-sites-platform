import type { Env } from "./env.js";
import { HttpError } from "./http.js";

/**
 * AI images (M4 4-E) through OpenAI's Images API, stored like any photo (3MP limit, WebP
 * variants). Policy (writing-rules guide): backgrounds, illustrations and mood only; real work
 * (cases, food, shop, lessons) only when the customer asked, with the request recorded.
 */
export const PURPOSES = ["background", "illustration", "mood", "work"] as const;
export type Purpose = (typeof PURPOSES)[number];
export const SIZES = ["1024x1024", "1536x1024", "1024x1536"] as const;

export interface CustomerRequest {
  /** Where the owner asked: 카톡, 전화, 메일… */
  channel: string;
  /** When (ISO date or date-time). */
  requestedAt: string;
  /** What they asked for, in a sentence. */
  summary: string;
}

export interface ImageInput {
  prompt: string;
  purpose: Purpose;
  size?: (typeof SIZES)[number];
  customerRequest?: CustomerRequest;
}

export function checkPolicy(input: ImageInput) {
  if (!PURPOSES.includes(input.purpose)) throw new HttpError(422, `purpose는 ${PURPOSES.join("·")} 중 하나`);
  if (input.purpose === "work") {
    const r = input.customerRequest;
    if (!r?.channel?.trim() || !r.requestedAt?.trim() || !r.summary?.trim()) {
      throw new HttpError(422, "실제 작업물(purpose: work) 이미지는 고객 요청이 있을 때만 만듭니다. customerRequest(경로·일시·요약)를 남기세요");
    }
  }
  if (!input.prompt?.trim() || input.prompt.length > 4000) throw new HttpError(422, "prompt는 1~4000자");
}

export async function callOpenAi(env: Env, input: ImageInput): Promise<Uint8Array> {
  if (!env.OPENAI_API_KEY || !env.OPENAI_IMAGE_MODEL) throw new HttpError(503, "이미지 생성이 설정되지 않았습니다(OPENAI_API_KEY, OPENAI_IMAGE_MODEL)");
  // An empty value (copied from .dev.vars.example) means the default.
  const base = env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const res = await fetch(`${base}/images/generations`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.OPENAI_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ model: env.OPENAI_IMAGE_MODEL, prompt: input.prompt, size: input.size ?? "1536x1024", n: 1 }),
  });
  const body = (await res.json().catch(() => ({}))) as { data?: { b64_json?: string; url?: string }[]; error?: { message?: string } };
  if (!res.ok) throw new HttpError(res.status === 400 ? 422 : 502, `이미지를 만들지 못했습니다: ${body.error?.message ?? res.status}`);
  const first = body.data?.[0];
  if (first?.b64_json) return Uint8Array.from(atob(first.b64_json), (c) => c.charCodeAt(0));
  // Some models answer with a short-lived URL instead.
  if (first?.url) {
    const image = await fetch(first.url);
    if (image.ok) return new Uint8Array(await image.arrayBuffer());
  }
  throw new HttpError(502, "이미지 응답이 비었습니다");
}
