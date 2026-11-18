import { HttpError } from "./http.js";

const DEFAULT_LIMIT = 15 * 1024 * 1024;

/** Reads a body stream, aborting with 413 as soon as it passes the limit (no Content-Length trust). */
export async function readLimited(stream: ReadableStream<Uint8Array> | null, limit = DEFAULT_LIMIT): Promise<Uint8Array> {
  if (!stream) return new Uint8Array();
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new HttpError(413, "사진이 너무 큽니다");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
