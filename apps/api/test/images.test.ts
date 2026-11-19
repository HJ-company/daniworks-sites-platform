import { describe, expect, it } from "vitest";
import { callOpenAi, checkPolicy } from "../src/openai-images.js";


describe("image policy", () => {
  it("refuses real-work images without the customer's request", () => {
    expect(() => checkPolicy({ prompt: "시공 사례", purpose: "work" })).toThrow(expect.objectContaining({ status: 422 }));
    expect(() => checkPolicy({ prompt: "시공 사례", purpose: "work", customerRequest: { channel: "카톡", requestedAt: "", summary: "x" } })).toThrow(
      expect.objectContaining({ status: 422 }),
    );
    expect(() =>
      checkPolicy({ prompt: "시공 사례", purpose: "work", customerRequest: { channel: "카톡", requestedAt: "2026-11-20", summary: "요청" } }),
    ).not.toThrow();
  });

  it("allows backgrounds, illustrations and mood without a request", () => {
    for (const purpose of ["background", "illustration", "mood"] as const) expect(() => checkPolicy({ prompt: "하늘", purpose })).not.toThrow();
  });

  it("refuses unknown purposes and empty prompts", () => {
    expect(() => checkPolicy({ prompt: "x", purpose: "logo" as never })).toThrow(expect.objectContaining({ status: 422 }));
    expect(() => checkPolicy({ prompt: " ", purpose: "mood" })).toThrow(expect.objectContaining({ status: 422 }));
  });

  it("says when image generation is not configured", async () => {
    await expect(callOpenAi({} as never, { prompt: "하늘", purpose: "background" })).rejects.toMatchObject({ status: 503 });
  });
});
