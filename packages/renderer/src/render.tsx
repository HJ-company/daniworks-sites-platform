import { renderToReadableStream } from "react-dom/server";
import { requireValidConfig, sitePagesFor, type SitePage } from "./preview.js";
import { isServiceConfig, type SiteConfig, type SiteConfigInput } from "./site-config.js";
import { presets } from "./templates/service-local/presets.js";
import { SiteView } from "./view.js";

export interface RenderOptions {
  /** Base URL of shared, template-versioned assets (CSS, client JS, template images). */
  assetBase: string;
  /** Public origin (`https://jefes.dsites.kr`) for canonical, OG and structured data URLs. */
  origin?: string;
  /** Skip the client bundle to measure server-only output. */
  hydrate?: boolean;
  /** Preview renders: noindex, no canonical, inquiry form disabled. */
  preview?: boolean;
  /** Prefix for root-relative site links (previews: `/preview/<token>`). */
  linkPrefix?: string;
  /** Turnstile frame the inquiry form embeds (`https://api.dsites.kr/turnstile-frame`). */
  turnstileFrame?: string | null;
}

export interface RenderedPage {
  route: string;
  /** Object path below the version prefix: `index.html`, `privacy/index.html`. */
  path: string;
  html: string;
}

export interface RenderResult {
  /** Home page HTML. */
  html: string;
  pages: RenderedPage[];
  ms: number;
}

const DATA_ID = "__SITE_DATA__";

function escapeJson(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

const absolute = (origin: string | undefined, url: string | undefined | null) =>
  !url ? undefined : /^https?:\/\//.test(url) ? url : origin ? `${origin}${url}` : undefined;

/** LocalBusiness (subtype by preset) and FAQPage. AI answers and search both read these. */
function structuredData(config: SiteConfig, origin: string | undefined, heroImage: string | undefined) {
  if (!isServiceConfig(config)) return [];
  const { business, content } = config;
  const org: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": business.schemaType ?? presets[config.preset].schemaType,
    name: business.name,
    description: config.meta.description,
    telephone: business.phone,
    url: origin ? `${origin}/` : undefined,
    image: heroImage,
    address: business.address,
    areaServed: business.serviceAreas.length ? business.serviceAreas : undefined,
    sameAs: [business.blogUrl, business.kakaoUrl].filter(Boolean),
    makesOffer: content.services.items.map((item) => ({
      "@type": "Offer",
      itemOffered: { "@type": "Service", name: item.label, description: item.description },
    })),
  };
  const result: unknown[] = [JSON.parse(JSON.stringify(org))];
  if (content.faqs.length) {
    result.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: content.faqs.map((faq) => ({
        "@type": "Question",
        name: faq.question,
        acceptedAnswer: { "@type": "Answer", text: faq.answer },
      })),
    });
  }
  return result;
}

async function renderPage(config: SiteConfig, sitePage: SitePage, options: RenderOptions): Promise<RenderedPage> {
  // Serialized for hydration too, so server and client agree on every link.
  const site = sitePage.data.site ? { ...sitePage.data.site, turnstileFrame: options.turnstileFrame ?? null } : sitePage.data.site;
  const page = {
    ...sitePage,
    data: { ...sitePage.data, site, linkPrefix: options.linkPrefix, preview: options.preview },
  };
  const stream = await renderToReadableStream(<SiteView data={page.data} />);
  await stream.allReady;
  const body = await new Response(stream).text();
  const hydrate = options.hydrate ?? true;
  const { title, description } = config.meta;
  const lang = ("lang" in config.meta && config.meta.lang) || "ko";
  const home = page.route === "/";
  const pageTitle = home ? title : `${page.title} | ${isServiceConfig(config) ? config.business.name : title}`;
  const url = options.origin ? `${options.origin}${page.route === "/" ? "/" : `${page.route}`}` : undefined;
  const hero = page.data.page.blocks[0];
  const heroImage = absolute(
    options.origin,
    hero?.__component === "blocks.hero" ? (hero.image?.media as { url?: string } | undefined)?.url : undefined,
  );
  const head = [
    `<title>${escapeHtml(pageTitle)}</title>`,
    `<meta name="description" content="${escapeHtml(description)}">`,
    options.preview ? `<meta name="robots" content="noindex, nofollow">` : "",
    url && !options.preview ? `<link rel="canonical" href="${escapeHtml(url)}">` : "",
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${escapeHtml(pageTitle)}">`,
    `<meta property="og:description" content="${escapeHtml(description)}">`,
    url ? `<meta property="og:url" content="${escapeHtml(url)}">` : "",
    heroImage ? `<meta property="og:image" content="${escapeHtml(heroImage)}">` : "",
    `<meta property="og:locale" content="ko_KR">`,
    ...(home ? structuredData(config, options.origin, heroImage) : []).map(
      (data) => `<script type="application/ld+json">${escapeJson(data)}</script>`,
    ),
  ]
    .filter(Boolean)
    .join("\n");
  const html = `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${head}
<link rel="stylesheet" href="${options.assetBase}/_assets/site.css">
</head>
<body${page.data.site ? ' class="has-contact-bar"' : ""}>
<div id="root">${body}</div>
${hydrate ? `<script id="${DATA_ID}" type="application/json">${escapeJson(page.data)}</script>
<script type="module" src="${options.assetBase}/_assets/client.js"></script>` : ""}
</body>
</html>`;
  return { route: page.route, path: page.route === "/" ? "index.html" : `${page.route.slice(1)}/index.html`, html };
}

/** Config → one HTML document per page. Runs in workerd and Node. */
export async function renderSite(input: SiteConfigInput, options: RenderOptions): Promise<RenderResult> {
  const started = Date.now();
  const config = requireValidConfig(input);
  const pages: RenderedPage[] = [];
  for (const page of sitePagesFor(config, options.assetBase)) pages.push(await renderPage(config, page, options));
  return { html: pages[0]!.html, pages, ms: Date.now() - started };
}

export { DATA_ID };
