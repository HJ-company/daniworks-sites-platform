import { createContext, useContext } from "react";

export const RenderContext = createContext<{ linkPrefix: string; preview: boolean }>({ linkPrefix: "", preview: false });

/** Applies the page's link prefix to a root-relative site link; asset paths stay untouched. */
export function useSiteHref() {
  const { linkPrefix } = useContext(RenderContext);
  return (href: string) =>
    linkPrefix && href.startsWith("/") && !href.startsWith("/_shared/") && !href.startsWith("/_media/")
      ? `${linkPrefix}${href}`
      : href;
}

export const useIsPreview = () => useContext(RenderContext).preview;
