import { renderSite, SiteConfigError, type SiteConfig } from "@sites/renderer";
import { sampleSites } from "./sample-sites.js";

/**
 * M0 router: GET /<slug> (or ?site=<slug>) renders that sample site in workerd.
 * Files under the assets directory are served before this handler runs.
 */
export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const slug = url.searchParams.get("site") ?? (url.pathname.split("/")[1] || "sample");
    const config: SiteConfig | undefined = sampleSites[slug];
    if (!config) return new Response(`unknown site: ${slug}`, { status: 404 });
    try {
      const { html, ms } = await renderSite(config, {
        assetBase: "",
        hydrate: url.searchParams.get("hydrate") !== "0",
      });
      return new Response(html, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "server-timing": `render;dur=${ms}`,
          "x-robots-tag": "noindex",
        },
      });
    } catch (error) {
      if (error instanceof SiteConfigError) return new Response(error.message, { status: 422 });
      throw error;
    }
  },
};
