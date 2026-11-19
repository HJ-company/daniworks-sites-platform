import { WorkerEntrypoint } from "cloudflare:workers";
import { renderDraft, type DraftPage } from "./draft-links.js";
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

  /** Customer draft link: `/preview/<token>` on the base domain. */
  async renderDraft(request: { token: string; route: string }): Promise<DraftPage> {
    try {
      return await renderDraft(this.env, request.token, request.route);
    } catch (error) {
      console.error("[draft] failed", error);
      return { status: 500, html: "<!doctype html><meta charset=utf-8><title>오류</title><p>잠시 뒤 다시 열어 주세요.</p>" };
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
