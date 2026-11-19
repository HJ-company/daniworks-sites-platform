import { describe, expect, it } from "vitest";
import { getGuide, SCHEMA_SLUG, sections } from "../src/guides.js";

describe("sections", () => {
  it("splits markdown on '## ' headings, keeping the intro", () => {
    const parts = sections("# 제목\n\n소개\n\n## 사진\n\n고객 사진만\n\n## FAQ\n\n짧게\n");
    expect(parts.map((p) => p.heading)).toEqual(["", "사진", "FAQ"]);
    expect(parts[1]!.text).toContain("고객 사진만");
    expect(parts.map((p) => p.text).join("")).toBe("# 제목\n\n소개\n\n## 사진\n\n고객 사진만\n\n## FAQ\n\n짧게\n\n");
  });
});

describe("schema guide", () => {
  it("is generated from the validating schema, with the skeleton", async () => {
    const guide = await getGuide({} as never, SCHEMA_SLUG);
    expect(guide.body).toContain("## JSON Schema");
    expect(guide.body).toContain('"business"');
    expect(guide.body).toContain("## 뼈대");
  });

  it("answers a query with only the matching sections", async () => {
    const guide = await getGuide({} as never, SCHEMA_SLUG, "뼈대");
    expect(guide.matched).toEqual(["뼈대(자리표시자)"]);
    expect(guide.body).not.toContain("## JSON Schema");
  });
});
