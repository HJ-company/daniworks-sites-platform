import type { CSSProperties } from "react";
import {
  BlockRenderer,
  BlocksProvider,
  SiteShell,
  type BlocksContextValue,
  type BlocksImageProps,
  type BlocksLinkProps,
} from "@dani-builder/blocks";
import type {
  BrandColors,
  Footer,
  InquiryFormBlock,
  NavigationDocument,
  PageDocument,
} from "@dani-builder/strapi-client/types";
import { srcSetFor } from "./images.js";
import { RenderContext, useSiteHref } from "./render-context.js";
import { ContactBar } from "./platform/contact-bar.js";
import { InquiryForm } from "./platform/inquiry-form.js";

/** Platform chrome for industry-template sites (v2). Legacy v1 sites have none. */
export interface SiteChrome {
  name: string;
  tel: string;
  kakaoUrl: string | null;
  mapUrl: string | null;
  bookingUrl: string | null;
  inquiryLabel: string;
  /** Platform-hosted Turnstile frame; null when spam checks are not configured. */
  turnstileFrame?: string | null;
}

/** Everything the page needs at render and hydration time. Serialized into the HTML. */
export interface PageData {
  page: PageDocument;
  navigation: NavigationDocument;
  footer: Footer;
  brandColors: BrandColors;
  /** `/` or `/privacy`; drives the shell's current path. */
  route?: string;
  site?: SiteChrome | null;
  /** Prefix for root-relative links, e.g. `/preview/<token>` so previews stay inside themselves. */
  linkPrefix?: string;
  /** Preview render: the inquiry form does not submit. */
  preview?: boolean;
}



const fillStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
};

function Img({ src, alt, fill, width, height, sizes, className, priority, onError }: BlocksImageProps) {
  return (
    <img
      src={src}
      srcSet={typeof src === "string" ? srcSetFor(src, width ? Number(width) : undefined) : undefined}
      alt={alt}
      width={fill ? undefined : width}
      height={fill ? undefined : height}
      sizes={sizes}
      className={className}
      style={fill ? fillStyle : undefined}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : undefined}
      decoding="async"
      onError={onError}
    />
  );
}

function A({ source: _source, href, ...props }: BlocksLinkProps) {
  const siteHref = useSiteHref();
  return <a href={typeof href === "string" ? siteHref(href) : href} {...props} />;
}

/** M0 placeholder: the shared inquiry Worker arrives in M2. */
function InquiryPlaceholder({ block }: { block: InquiryFormBlock }) {
  return (
    <section id={block.section?.anchorId ?? undefined} className="sites-inquiry-placeholder">
      <p>문의 폼 자리 (M2에서 공용 문의 Worker로 연결)</p>
    </section>
  );
}

const adapters: BlocksContextValue = {
  Image: Img,
  Link: A,
  resolveAssetUrl: (asset) => asset?.url ?? "",
};

export function SiteView({ data }: { data: PageData }) {
  const { page, navigation, footer, brandColors, site } = data;
  const first = page.blocks[0];
  const route = data.route ?? "/";
  const linkPrefix = data.linkPrefix ?? "";
  return (
    <RenderContext.Provider
      value={{ linkPrefix, preview: data.preview ?? false, turnstileFrame: site?.turnstileFrame ?? null }}
    >
    <BlocksProvider value={adapters}>
      <SiteShell
        navigation={navigation}
        footer={footer}
        organization={footer.organization ?? ""}
        homeHref={`${linkPrefix}/`}
        currentPath={route}
        headerMode={page.headerMode}
        firstHero={first?.__component === "blocks.hero" ? first : null}
        colors={brandColors}
      >
        <BlockRenderer
          blocks={page.blocks}
          renderers={{ "blocks.inquiry-form": site ? InquiryForm : InquiryPlaceholder }}
        />
      </SiteShell>
      {site ? <ContactBar site={site} /> : null}
    </BlocksProvider>
    </RenderContext.Provider>
  );
}
