import { describe, expect, it } from "vitest";
import { businessSchema, formatIssues, photoSchema } from "../src/index.js";

const business = { name: "상호", phone: "010-1234-5678", representative: "대표" };

describe("businessSchema", () => {
  it.each(["010-1234-5678", "01012345678", "02-123-4567", "031-1234-5678", "1588-1234", "0507-1234-5678", "050712345678"])("accepts phone %s", (phone) => {
    expect(businessSchema.safeParse({ ...business, phone }).success).toBe(true);
  });

  it.each(["123", "010-12-34", "+82 10 1234 5678", "tel:01012345678"])("rejects phone %s", (phone) => {
    expect(businessSchema.safeParse({ ...business, phone }).success).toBe(false);
  });

  it("accepts Kakao channel and open chat links only", () => {
    expect(businessSchema.safeParse({ ...business, kakaoUrl: "https://pf.kakao.com/_abc" }).success).toBe(true);
    expect(businessSchema.safeParse({ ...business, kakaoUrl: "https://open.kakao.com/o/abc" }).success).toBe(true);
    expect(businessSchema.safeParse({ ...business, kakaoUrl: "https://evil.example/kakao" }).success).toBe(false);
    expect(businessSchema.safeParse({ ...business, kakaoUrl: "javascript:alert(1)" }).success).toBe(false);
  });

  it("requires https for external links", () => {
    expect(businessSchema.safeParse({ ...business, mapUrl: "http://naver.me/x" }).success).toBe(false);
    expect(businessSchema.safeParse({ ...business, mapUrl: "https://naver.me/x" }).success).toBe(true);
  });

  it("fills list defaults", () => {
    const parsed = businessSchema.parse(business);
    expect(parsed.hours).toEqual([]);
    expect(parsed.serviceAreas).toEqual([]);
  });
});

describe("photoSchema", () => {
  it.each(["m:site_1/abc.jpg", "m:abc/f00.png", "t:pine-cabin"])("accepts %s", (key) => {
    expect(photoSchema.safeParse({ key, alt: "사진" }).success).toBe(true);
  });

  it.each(["m:../x.jpg", "m:site/x.gif", "https://example.com/a.jpg", "t:Bad Name"])("rejects %s", (key) => {
    expect(photoSchema.safeParse({ key, alt: "사진" }).success).toBe(false);
  });
});

describe("formatIssues", () => {
  it("prefixes each issue with its path", () => {
    const result = businessSchema.safeParse({ ...business, phone: "x" });
    expect(result.success).toBe(false);
    if (!result.success) expect(formatIssues(result.error)).toEqual(["phone: 전화번호 형식이 아닙니다"]);
  });
});
