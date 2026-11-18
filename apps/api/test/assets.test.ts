import { describe, expect, it } from "vitest";
import { normalizeNaverImage } from "../src/remote-image.js";

describe("normalizeNaverImage", () => {
  it("swaps RSS thumbnails for the uploaded size", () => {
    expect(normalizeNaverImage("https://blogthumb.pstatic.net/MjAy/a.JPEG/900_1.jpg?type=s3")).toBe(
      "https://postfiles.pstatic.net/MjAy/a.JPEG/900_1.jpg?type=w966",
    );
  });
  it("leaves other hosts alone", () => {
    expect(normalizeNaverImage("https://example.com/a.jpg?type=s3")).toBe("https://example.com/a.jpg?type=s3");
  });
});
