import type { Env } from "./env.js";

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Sends a transactional mail. `binding`: Cloudflare Email Service (`send_email` binding, the
 * sender domain must be onboarded). `mailpit`: local inbox for verification. `off`: skipped.
 */
export async function sendMail(env: Env, mail: OutgoingMail): Promise<{ id: string | null; skipped: boolean }> {
  const mode = env.MAIL_MODE ?? "off";
  const from = { email: env.MAIL_FROM ?? "noreply@dsites.kr", name: "홈페이지 알림" };
  if (mode === "binding") {
    if (!env.EMAIL) throw new Error("send_email 바인딩(EMAIL)이 없습니다");
    const result = await env.EMAIL.send({ from, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html });
    return { id: result.messageId, skipped: false };
  }
  if (mode === "mailpit") {
    const res = await fetch(`${env.MAIL_PIT_URL ?? "http://127.0.0.1:8025"}/api/v1/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        From: { Email: from.email, Name: from.name },
        To: [{ Email: mail.to }],
        Subject: mail.subject,
        Text: mail.text,
        HTML: mail.html,
      }),
    });
    if (!res.ok) throw new Error(`mailpit ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { ID?: string };
    return { id: body.ID ?? null, skipped: false };
  }
  return { id: null, skipped: true };
}
