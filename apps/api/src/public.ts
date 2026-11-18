import { WorkerEntrypoint } from "cloudflare:workers";
import type { Env } from "./env.js";
import { submitInquiry, type InquiryRequest, type InquiryResponse } from "./inquiries.js";
import { recordTrack, type TrackRequest } from "./metrics.js";

/**
 * Methods the public router calls through its service binding (Workers RPC). Not reachable
 * over HTTP, so api.dsites.kr cannot be used to submit for an arbitrary site id.
 */
export class PublicApi extends WorkerEntrypoint<Env> {
  async submitInquiry(request: InquiryRequest): Promise<InquiryResponse> {
    try {
      return await submitInquiry(this.env, request, (promise) => this.ctx.waitUntil(promise));
    } catch (error) {
      console.error("[inquiry] failed", error);
      return { status: 500, body: { ok: false, error: "잠시 뒤 다시 시도해 주세요" } };
    }
  }

  async track(request: TrackRequest): Promise<"counted" | "ignored"> {
    try {
      return await recordTrack(this.env.DB, request);
    } catch (error) {
      console.error("[track] failed", error);
      return "ignored";
    }
  }
}
