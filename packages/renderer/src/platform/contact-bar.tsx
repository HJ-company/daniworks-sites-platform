import { useSiteHref } from "../render-context.js";
import type { SiteChrome } from "../view.js";

/**
 * Mobile bottom bar: the main conversion points for local businesses. `data-track` names the
 * click event the tracking beacon records, so every channel is measured the same way.
 */
export function ContactBar({ site }: { site: SiteChrome }) {
  const siteHref = useSiteHref();
  const items: { label: string; href: string; track: string; external?: boolean }[] = [
    { label: "전화", href: site.tel, track: "tel" },
  ];
  if (site.kakaoUrl) items.push({ label: "카톡", href: site.kakaoUrl, track: "kakao", external: true });
  if (site.bookingUrl) items.push({ label: "예약", href: site.bookingUrl, track: "booking", external: true });
  else if (site.mapUrl) items.push({ label: "지도", href: site.mapUrl, track: "map", external: true });
  items.push({ label: site.inquiryLabel, href: siteHref("/#inquiry"), track: "inquiry_cta" });

  return (
    <nav
      aria-label="빠른 연락"
      className="sites-contact-bar fixed inset-x-0 bottom-0 z-40 grid border-t border-black/10 bg-white/95 backdrop-blur md:hidden"
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
    >
      {items.map((item) => (
        <a
          key={item.track}
          href={item.href}
          data-track={item.track}
          target={item.external ? "_blank" : undefined}
          rel={item.external ? "noopener" : undefined}
          className="flex min-h-14 items-center justify-center text-[15px] font-semibold text-[var(--color-text)] active:bg-black/5"
        >
          {item.label}
        </a>
      ))}
    </nav>
  );
}
