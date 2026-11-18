export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, "요청 본문이 JSON이 아닙니다");
  }
}

const encoder = new TextEncoder();
// Workers extension; the DOM lib (needed by the renderer's JSX) does not declare it.
const subtle = crypto.subtle as SubtleCrypto & { timingSafeEqual(a: ArrayBufferView, b: ArrayBufferView): boolean };

/** Bearer token check in constant time. */
export function requireAdmin(request: Request, token: string | undefined) {
  if (!token) throw new HttpError(500, "ADMIN_TOKEN이 설정되지 않았습니다");
  const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const a = encoder.encode(given);
  const b = encoder.encode(token);
  if (a.byteLength !== b.byteLength || !subtle.timingSafeEqual(a, b)) {
    throw new HttpError(401, "인증이 필요합니다");
  }
}
