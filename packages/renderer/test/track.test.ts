import { describe, expect, it } from "vitest";
import { classifyLink } from "../src/platform/track.js";

const a = (href: string, track?: string) => ({
  getAttribute: (name: string) => (name === "href" ? href : name === "data-track" ? (track ?? null) : null),
});

describe("classifyLink", () => {
  it.each([
    ["tel:01012345678", "tel"],
    ["https://pf.kakao.com/_abc", "kakao"],
    ["https://open.kakao.com/o/x", "kakao"],
    ["https://m.booking.naver.com/booking/1", "booking"],
    ["https://naver.me/abc", "map"],
    ["https://map.naver.com/p/entry/place/1", "map"],
    ["https://map.kakao.com/link/to/1", "map"],
    ["/#inquiry", "inquiry_cta"],
    ["/preview/tok/#inquiry", "inquiry_cta"],
    ["/#services", null],
    ["https://blog.naver.com/x", null],
  ])("%s → %s", (href, kind) => {
    expect(classifyLink(a(href))).toBe(kind);
  });

  it("prefers data-track", () => {
    expect(classifyLink(a("/#inquiry", "tel"))).toBe("tel");
  });
});
