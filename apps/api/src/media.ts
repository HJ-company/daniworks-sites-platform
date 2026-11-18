import { PhotonImage, resize, SamplingFilter } from "@cf-wasm/photon/workerd";
import { VARIANT_WIDTHS } from "@sites/renderer";
import { HttpError } from "./http.js";
import { detectFormat, flattenOnWhite, imageSize, jpegOrientation, orientPixels } from "./image-header.js";

/**
 * Upload limits. Photon decodes into WASM memory inside a 128 MB isolate: measured about
 * 18 MiB per megapixel (12 MP phone photos exceed the limit). Pixels are capped from the
 * header before decoding; the console downsizes larger photos in the browser before upload.
 */
export const MAX_INPUT_BYTES = 15 * 1024 * 1024;
export const MAX_PIXELS = 3_000_000;
export const MAX_EDGE = 1600;
export const JPEG_QUALITY = 82;

export interface ProcessedPhoto {
  /** Normalized JPEG: EXIF orientation applied, longest edge at most MAX_EDGE. */
  main: Uint8Array;
  width: number;
  height: number;
  variants: { width: number; bytes: Uint8Array }[];
}

function orient(image: PhotonImage, orientation: number): PhotonImage {
  if (orientation === 1) return image;
  const raw = image.get_raw_pixels();
  const src = new Uint32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
  const { pixels, width, height } = orientPixels(src, image.get_width(), image.get_height(), orientation);
  image.free();
  return new PhotonImage(new Uint8Array(pixels.buffer), width, height);
}

function scaled(image: PhotonImage, maxWidth: number): PhotonImage {
  const w = image.get_width();
  const h = image.get_height();
  const width = Math.max(1, Math.min(maxWidth, w));
  return resize(image, width, Math.max(1, Math.round((h * width) / w)), SamplingFilter.Lanczos3);
}

/**
 * Validates, orients and downsizes an uploaded photo; produces the WebP variants the renderer's
 * srcset expects (`<file>.w<width>.webp`). Throws HttpError 413/415/422 for unusable input.
 */
export function processPhoto(input: Uint8Array): ProcessedPhoto {
  if (input.byteLength > MAX_INPUT_BYTES) throw new HttpError(413, `사진은 ${MAX_INPUT_BYTES / 1024 / 1024}MB 이하만 올릴 수 있습니다`);
  const format = detectFormat(input);
  if (!format) throw new HttpError(415, "JPEG, PNG, WebP 사진만 올릴 수 있습니다");
  const size = imageSize(input, format);
  if (!size || !size.width || !size.height) throw new HttpError(422, "사진 크기를 읽지 못했습니다");
  if (size.width * size.height > MAX_PIXELS) {
    throw new HttpError(
      413,
      `사진 해상도가 너무 큽니다 (${size.width}×${size.height}). 긴 변 ${MAX_EDGE}px 정도로 줄여서 올려주세요 (최대 ${MAX_PIXELS / 1_000_000}MP)`,
    );
  }

  let image: PhotonImage;
  try {
    image = PhotonImage.new_from_byteslice(input);
  } catch {
    throw new HttpError(422, "사진을 읽지 못했습니다");
  }
  // Longest edge at most MAX_EDGE (orientation does not change it), then orient the smaller image.
  const longest = Math.max(image.get_width(), image.get_height());
  if (longest > MAX_EDGE) {
    const ratio = MAX_EDGE / longest;
    const width = Math.max(1, Math.round(image.get_width() * ratio));
    const height = Math.max(1, Math.round(image.get_height() * ratio));
    const next = resize(image, width, height, SamplingFilter.Lanczos3);
    image.free();
    image = next;
  }
  image = orient(image, format === "jpeg" ? jpegOrientation(input) : 1);
  if (format !== "jpeg") {
    // Transparent PNG/WebP: JPEG would turn alpha black while WebP keeps it. Flatten once on white.
    const raw = image.get_raw_pixels();
    if (flattenOnWhite(raw)) {
      const next = new PhotonImage(raw, image.get_width(), image.get_height());
      image.free();
      image = next;
    }
  }
  const width = image.get_width();
  const height = image.get_height();
  const main = image.get_bytes_jpeg(JPEG_QUALITY);
  // Every advertised variant exists, even for small photos (then it is the original size),
  // because srcset may list all of them when a config omits the photo width.
  const variants = VARIANT_WIDTHS.map((w) => {
    const variant = scaled(image, Math.min(w, width));
    const bytes = variant.get_bytes_webp();
    variant.free();
    return { width: w, bytes };
  });
  image.free();
  return { main, width, height, variants };
}

let queue: Promise<unknown> = Promise.resolve();

/** Runs photo processing one at a time per isolate so concurrent uploads never double WASM memory. */
export function processPhotoExclusive(input: Uint8Array): Promise<ProcessedPhoto> {
  const run = queue.then(() => processPhoto(input));
  queue = run.catch(() => undefined);
  return run;
}
