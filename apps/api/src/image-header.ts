// Pure image helpers (no WASM): format sniffing, header dimensions, EXIF orientation, pixel moves.

export type Format = "jpeg" | "png" | "webp";

const u16 = (b: Uint8Array, o: number, le = false) => (le ? b[o]! | (b[o + 1]! << 8) : (b[o]! << 8) | b[o + 1]!);
const u32 = (b: Uint8Array, o: number, le = false) =>
  le
    ? (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0
    : ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
const ascii = (b: Uint8Array, o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));

export function detectFormat(b: Uint8Array): Format | null {
  if (b[0] === 0xff && b[1] === 0xd8) return "jpeg";
  if (ascii(b, 1, 3) === "PNG") return "png";
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return "webp";
  return null;
}

/** Dimensions from the file header, without decoding. */
export function imageSize(b: Uint8Array, format: Format): { width: number; height: number } | null {
  if (format === "png") return { width: u32(b, 16), height: u32(b, 20) };
  if (format === "webp") {
    const chunk = ascii(b, 12, 4);
    if (chunk === "VP8 ") return { width: u16(b, 26, true) & 0x3fff, height: u16(b, 28, true) & 0x3fff };
    if (chunk === "VP8L") {
      const bits = u32(b, 21, true);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8X") {
      const w = 1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16));
      const h = 1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16));
      return { width: w, height: h };
    }
    return null;
  }
  // JPEG: walk segments to the first SOF marker.
  let o = 2;
  while (o + 9 < b.length) {
    if (b[o] !== 0xff) return null;
    const marker = b[o + 1]!;
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
      o += 2;
      continue;
    }
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) return { height: u16(b, o + 5), width: u16(b, o + 7) };
    o += 2 + u16(b, o + 2);
  }
  return null;
}

/** EXIF orientation (1–8) of a JPEG; 1 when absent. Phone photos are usually stored sideways. */
export function jpegOrientation(b: Uint8Array): number {
  let o = 2;
  while (o + 4 < b.length && b[o] === 0xff) {
    const marker = b[o + 1]!;
    const size = u16(b, o + 2);
    if (marker === 0xe1 && ascii(b, o + 4, 6) === "Exif\0\0") {
      const tiff = o + 10;
      const le = ascii(b, tiff, 2) === "II";
      const ifd = tiff + u32(b, tiff + 4, le);
      const count = u16(b, ifd, le);
      for (let i = 0; i < count; i++) {
        const entry = ifd + 2 + i * 12;
        if (entry + 12 > b.length) break;
        if (u16(b, entry, le) === 0x0112) {
          const value = u16(b, entry + 8, le);
          return value >= 1 && value <= 8 ? value : 1;
        }
      }
      return 1;
    }
    if (marker === 0xda) break; // image data starts; no EXIF after this
    o += 2 + size;
  }
  return 1;
}

/**
 * Applies an EXIF orientation by moving raw RGBA pixels. Photon's `rotate` blends interior
 * pixels (verified: solid red turns pink), so 90° steps and flips are done here exactly.
 */
export function orientPixels(src: Uint32Array, w: number, h: number, orientation: number) {
  const swap = orientation >= 5;
  const dw = swap ? h : w;
  const dh = swap ? w : h;
  const dst = new Uint32Array(dw * dh);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let dx = x;
      let dy = y;
      switch (orientation) {
        case 2: dx = w - 1 - x; break;
        case 3: dx = w - 1 - x; dy = h - 1 - y; break;
        case 4: dy = h - 1 - y; break;
        case 5: dx = y; dy = x; break;
        case 6: dx = h - 1 - y; dy = x; break;
        case 7: dx = h - 1 - y; dy = w - 1 - x; break;
        case 8: dx = y; dy = w - 1 - x; break;
      }
      dst[dy * dw + dx] = src[y * w + x]!;
    }
  }
  return { pixels: dst, width: dw, height: dh };
}


/** Composites RGBA pixels onto white in place, so JPEG and WebP outputs look the same. Returns whether any pixel changed. */
export function flattenOnWhite(rgba: Uint8Array): boolean {
  let changed = false;
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3]!;
    if (a === 255) continue;
    changed = true;
    const k = a / 255;
    rgba[i] = Math.round(rgba[i]! * k + 255 * (1 - k));
    rgba[i + 1] = Math.round(rgba[i + 1]! * k + 255 * (1 - k));
    rgba[i + 2] = Math.round(rgba[i + 2]! * k + 255 * (1 - k));
    rgba[i + 3] = 255;
  }
  return changed;
}
