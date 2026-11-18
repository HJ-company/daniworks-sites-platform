/** Click and pageview events the platform measures (stored in D1 `metrics_daily`). */
export type TrackEvent = "pageview" | "tel" | "kakao" | "map" | "booking" | "inquiry_cta";

export const TRACK_ENDPOINT = "/api/track";

/** Classifies a clicked link; `data-track` wins, otherwise the destination decides. */
export function classifyLink(anchor: { getAttribute(name: string): string | null }): TrackEvent | null {
  const explicit = anchor.getAttribute("data-track");
  if (explicit) return explicit as TrackEvent;
  const href = anchor.getAttribute("href") ?? "";
  if (href.startsWith("tel:")) return "tel";
  if (/^https:\/\/(pf|open)\.kakao\.com\//.test(href)) return "kakao";
  if (/^https:\/\/(m\.)?booking\.naver\.com\//.test(href)) return "booking";
  if (/^https:\/\/((m\.)?map\.naver\.com|naver\.me|map\.kakao\.com|kko\.to|maps\.app\.goo\.gl|(www\.)?google\.[a-z.]+\/maps)/.test(href)) {
    return "map";
  }
  if (/(^|\/)#inquiry$/.test(href)) return "inquiry_cta";
  return null;
}

function send(event: TrackEvent) {
  const body = JSON.stringify({ event, page: location.pathname });
  // sendBeacon survives navigation (tel:, external links); text/plain avoids a preflight.
  if (!navigator.sendBeacon?.(TRACK_ENDPOINT, new Blob([body], { type: "text/plain" }))) {
    void fetch(TRACK_ENDPOINT, { method: "POST", body, keepalive: true }).catch(() => undefined);
  }
}

/** Pageview now, then one delegated listener for every tracked link on the page. */
export function startTracking() {
  send("pageview");
  document.addEventListener(
    "click",
    (event) => {
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      const kind = anchor ? classifyLink(anchor) : null;
      if (kind) send(kind);
    },
    { capture: true },
  );
}
