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

/** Everything the page needs at render and hydration time. Serialized into the HTML. */
export interface PageData {
  page: PageDocument;
  navigation: NavigationDocument;
  footer: Footer;
  brandColors: BrandColors;
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

function A({ source: _source, ...props }: BlocksLinkProps) {
  return <a {...props} />;
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
  const { page, navigation, footer, brandColors } = data;
  const first = page.blocks[0];
  return (
    <BlocksProvider value={adapters}>
      <SiteShell
        navigation={navigation}
        footer={footer}
        organization={footer.organization ?? ""}
        homeHref="/"
        currentPath="/"
        headerMode={page.headerMode}
        firstHero={first?.__component === "blocks.hero" ? first : null}
        colors={brandColors}
      >
        <BlockRenderer
          blocks={page.blocks}
          renderers={{ "blocks.inquiry-form": InquiryPlaceholder }}
        />
      </SiteShell>
    </BlocksProvider>
  );
}
