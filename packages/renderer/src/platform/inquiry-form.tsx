import { useState, type FormEvent } from "react";
import type { InquiryFormBlock } from "@dani-builder/strapi-client/types";
import { useIsPreview, useSiteHref } from "../render-context.js";

export const INQUIRY_ENDPOINT = "/api/inquiry";

type Status = "idle" | "sending" | "done" | "error";

const field =
  "w-full rounded-lg border border-black/15 bg-white px-4 py-3 text-base text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]";

/**
 * Platform inquiry form for local businesses: name, phone and message. It posts to the shared
 * `/api/inquiry` endpoint on the site's own host, which identifies the site by Host header.
 */
export function InquiryForm({ block }: { block: InquiryFormBlock }) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const section = block.section;
  const siteHref = useSiteHref();
  const preview = useIsPreview();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (preview) {
      setError("프리뷰에서는 문의가 전송되지 않습니다.");
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
        body: JSON.stringify({ ...data, consent: data.consent === "on", page: location.pathname }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? block.errorMessage ?? "전송하지 못했습니다.");
      }
      form.reset();
      setStatus("done");
    } catch (e) {
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
          <form onSubmit={submit} className="mt-8 grid gap-4" noValidate={false}>
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
                  자세히
                </a>
              </span>
            </label>
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
