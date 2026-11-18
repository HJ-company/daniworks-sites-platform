const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Server-side Turnstile check. A missing secret means Turnstile is not configured (allowed). */
export async function verifyTurnstile(
  secret: string | undefined,
  token: string | undefined,
  ip: string | null,
  fetcher: typeof fetch = fetch,
): Promise<{ ok: boolean; reason?: string }> {
  if (!secret) return { ok: true, reason: "not-configured" };
  if (!token) return { ok: false, reason: "missing-token" };
  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);
  try {
    const res = await fetcher(SITEVERIFY, { method: "POST", body: form });
    const body = (await res.json()) as { success?: boolean; "error-codes"?: string[] };
    return body.success ? { ok: true } : { ok: false, reason: body["error-codes"]?.join(",") ?? "failed" };
  } catch (error) {
    return { ok: false, reason: `siteverify-unreachable: ${String(error)}` };
  }
}

/**
 * Page hosting the Turnstile widget on the platform's own hostname. Widgets accept a short
 * hostname allowlist, so customer domains embed this frame and receive the token by
 * postMessage instead of rendering the widget themselves.
 */
export function turnstileFrame(siteKey: string, parentOrigin: string) {
  const parent = JSON.stringify(parentOrigin).replace(/</g, "\\u003c");
  const key = JSON.stringify(siteKey).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="robots" content="noindex">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{margin:0;background:transparent}</style>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad&render=explicit" async defer></script>
<script>
var parentOrigin = ${parent};
function send(message) { window.parent.postMessage(Object.assign({ type: "dsites-turnstile" }, message), parentOrigin); }
function onTurnstileLoad() {
  turnstile.render("#widget", {
    sitekey: ${key},
    language: "ko",
    callback: function (token) { send({ token: token }); },
    "expired-callback": function () { send({ token: null }); },
    "error-callback": function () { send({ error: true }); }
  });
}
</script></head><body><div id="widget"></div></body></html>`;
}
