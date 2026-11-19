import { useEffect, useRef, useState, type FormEvent } from "react";
import type { InquiryFormBlock } from "@dani-builder/strapi-client/types";
import { useIsPreview, useSiteHref, useTurnstileFrame } from "../render-context.js";

export const INQUIRY_ENDPOINT = "/api/inquiry";

type Status = "idle" | "sending" | "done" | "error";

const field =
  "w-full rounded-lg border border-black/15 bg-white px-4 py-3 text-base text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]";

/**
 * Turnstile token from the platform-hosted frame. The frame loads only after the visitor starts
 * filling the form, so the challenge script never weighs on page load.
 */
function useTurnstile(frameUrl: string | null, active: boolean) {
  const [token, setToken] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (!frameUrl || !active) return;
    const frameOrigin = new URL(frameUrl, location.href).origin;
    function onMessage(event: MessageEvent) {
      if (event.origin !== frameOrigin || event.data?.type !== "dsites-turnstile") return;
      if (event.data.error) setFailed(true);
      else setToken(event.data.token ?? null);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [frameUrl, active]);
  const src = frameUrl && active ? `${frameUrl}?parent=${encodeURIComponent(location.origin)}&round=${round}` : null;
  // Tokens are single-use: reloading the frame issues a fresh one.
  const reset = () => {
    setToken(null);
    setFailed(false);
    setRound((n) => n + 1);
  };
  return { token, failed, src, required: Boolean(frameUrl), reset };
}

/**
 * Platform inquiry form for local businesses: name, phone and message. It posts to the shared
 * `/api/inquiry` endpoint on the site's own host, which identifies the site by Host header.
 */
/** Drafts (customer draft links, operator previews) never send inquiries. */
const DRAFT_NOTICE = "시안에서는 문의가 전송되지 않습니다.";

export function InquiryForm({ block }: { block: InquiryFormBlock }) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const mountedAt = useRef<number>(0);
  const section = block.section;
  const siteHref = useSiteHref();
  const preview = useIsPreview();
  const turnstile = useTurnstile(useTurnstileFrame(), touched && !preview);

  useEffect(() => {
    mountedAt.current = Date.now();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (preview) {
      setError(DRAFT_NOTICE);
      setStatus("error");
      return;
    }
    if (turnstile.required && !turnstile.token) {
      setError(turnstile.failed ? "스팸 방지 확인을 불러오지 못했습니다. 전화로 문의해 주세요." : "스팸 방지 확인이 끝나면 다시 눌러 주세요.");
      setStatus("error");
      return;
    }
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    setStatus("sending");
    setError(null);
    try {
      const res = await fetch(INQUIRY_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...data,
          consent: data.consent === "on",
          page: location.pathname,
          elapsedMs: Date.now() - mountedAt.current,
          turnstileToken: turnstile.token ?? undefined,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? block.errorMessage ?? "전송하지 못했습니다.");
      }
      form.reset();
      setStatus("done");
    } catch (e) {
      // A Turnstile token is single-use; the frame issues a new one.
      turnstile.reset();
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }

  return (
    <section id={section?.anchorId ?? "inquiry"} className="sites-inquiry px-5 py-16 md:py-24">
      <div className="mx-auto max-w-xl">
        {section?.kickerText ? <p className="mb-2 text-sm font-semibold text-[var(--color-primary)]">{section.kickerText}</p> : null}
        {section?.heading ? <h2 className="text-2xl font-bold whitespace-pre-line md:text-3xl">{section.heading}</h2> : null}
        {section?.subheading ? (
          <p className="mt-3 whitespace-pre-line text-[var(--color-text-muted)]">{section.subheading}</p>
        ) : null}
        {status === "done" ? (
          <p role="status" className="mt-8 rounded-lg bg-[var(--color-bg)] p-6 whitespace-pre-line">
            {block.successMessage ?? "문의가 접수되었습니다."}
          </p>
        ) : (
          <form onSubmit={submit} onFocus={() => setTouched(true)} className="mt-8 grid gap-4">
            <label className="grid gap-1.5 text-sm font-medium">
              이름
              <input name="name" required maxLength={30} autoComplete="name" className={field} />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              연락처
              <input
                name="phone"
                required
                inputMode="tel"
                autoComplete="tel"
                pattern="[0-9\-\s]{9,14}"
                placeholder="010-1234-5678"
                className={field}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              문의 내용
              <textarea name="message" required maxLength={1000} rows={5} className={field} />
            </label>
            {/* Honeypot: people never see or fill it. */}
            <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
            <label className="flex items-start gap-2 text-sm text-[var(--color-text-muted)]">
              <input name="consent" type="checkbox" required className="mt-1" />
              <span>
                문의 응대를 위한 개인정보 수집·이용에 동의합니다.{" "}
                <a href={siteHref("/privacy")} className="underline">
                  개인정보처리방침 보기
                </a>
              </span>
            </label>
            {turnstile.src ? (
              <iframe
                title="스팸 방지 확인"
                src={turnstile.src}
                className="h-[70px] w-full max-w-[320px] border-0"
                data-turnstile-frame=""
              />
            ) : null}
            {preview && status !== "error" ? (
              <p className="text-sm text-[var(--color-muted,#5b616e)]" data-draft-notice="">
                {DRAFT_NOTICE}
              </p>
            ) : null}
            {status === "error" && error ? (
              <p role="alert" className="text-sm text-red-700">
                {error}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={status === "sending"}
              className="min-h-12 rounded-lg bg-[var(--color-cta)] px-6 font-semibold text-white disabled:opacity-60"
            >
              {status === "sending" ? "보내는 중…" : "문의 보내기"}
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
