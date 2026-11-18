import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { detectFormat, flattenOnWhite, imageSize, jpegOrientation, orientPixels } from "../src/image-header.js";

const sharp = createRequire(new URL("../../../packages/renderer/package.json", import.meta.url))("sharp");
const solid = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: "#c33" } });

describe("image headers", () => {
  it.each([
    ["jpeg", (s: any) => s.jpeg()],
    ["png", (s: any) => s.png()],
    ["webp", (s: any) => s.webp()],
    ["webp", (s: any) => s.webp({ lossless: true })],
  ])("reads %s dimensions without decoding", async (format, encode) => {
    const bytes = new Uint8Array(await encode(solid(321, 123)).toBuffer());
    expect(detectFormat(bytes)).toBe(format);
    expect(imageSize(bytes, format as never)).toEqual({ width: 321, height: 123 });
  });

  it("rejects non-images", () => {
    expect(detectFormat(new TextEncoder().encode("hello world"))).toBeNull();
  });

  it.each([1, 3, 6, 8])("reads EXIF orientation %i", async (orientation) => {
    const bytes = new Uint8Array(await solid(40, 20).jpeg().withMetadata({ orientation }).toBuffer());
    expect(jpegOrientation(bytes)).toBe(orientation);
  });

  it("defaults to 1 without EXIF", async () => {
    expect(jpegOrientation(new Uint8Array(await solid(4, 4).jpeg().toBuffer()))).toBe(1);
  });
});

describe("orientPixels", () => {
  // 3×2 source:  a b c
  //              d e f
  const src = Uint32Array.from([1, 2, 3, 4, 5, 6]);
  const grid = (o: number) => {
    const { pixels, width, height } = orientPixels(src, 3, 2, o);
    return { rows: Array.from({ length: height }, (_, y) => Array.from(pixels.slice(y * width, y * width + width))), width, height };
  };

  it.each([
    [1, [[1, 2, 3], [4, 5, 6]]],
    [2, [[3, 2, 1], [6, 5, 4]]],
    [3, [[6, 5, 4], [3, 2, 1]]],
    [4, [[4, 5, 6], [1, 2, 3]]],
    [5, [[1, 4], [2, 5], [3, 6]]],
    [6, [[4, 1], [5, 2], [6, 3]]],
    [7, [[6, 3], [5, 2], [4, 1]]],
    [8, [[3, 6], [2, 5], [1, 4]]],
  ])("orientation %i", (orientation, rows) => {
    expect(grid(orientation).rows).toEqual(rows);
  });
});

describe("flattenOnWhite", () => {
  it("composites transparency onto white and reports changes", () => {
    const px = Uint8Array.from([0, 0, 0, 0, 255, 0, 0, 255, 0, 0, 255, 128]);
    expect(flattenOnWhite(px)).toBe(true);
    expect(Array.from(px)).toEqual([255, 255, 255, 255, 255, 0, 0, 255, 127, 127, 255, 255]);
  });

  it("leaves opaque images untouched", () => {
    const px = Uint8Array.from([10, 20, 30, 255]);
    expect(flattenOnWhite(px)).toBe(false);
    expect(Array.from(px)).toEqual([10, 20, 30, 255]);
  });
});
