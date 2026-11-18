import { createContext, useContext } from "react";

export interface RenderContextValue {
  linkPrefix: string;
  preview: boolean;
  /** Platform-hosted Turnstile frame URL; null when spam checks are not configured. */
  turnstileFrame: string | null;
}

export const RenderContext = createContext<RenderContextValue>({ linkPrefix: "", preview: false, turnstileFrame: null });

/** Applies the page's link prefix to a root-relative site link; asset paths stay untouched. */
export function useSiteHref() {
  const { linkPrefix } = useContext(RenderContext);
  return (href: string) =>
    linkPrefix && href.startsWith("/") && !href.startsWith("/_shared/") && !href.startsWith("/_media/")
      ? `${linkPrefix}${href}`
      : href;
}

export const useIsPreview = () => useContext(RenderContext).preview;

export const useTurnstileFrame = () => useContext(RenderContext).turnstileFrame;
