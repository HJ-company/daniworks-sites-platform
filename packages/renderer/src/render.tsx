import { renderToReadableStream } from "react-dom/server";
import { toPageData } from "./preview.js";
import type { SiteConfig } from "./site-config.js";
import { SiteView } from "./view.js";

export interface RenderOptions {
  /** Base URL of shared, template-versioned assets (CSS, client JS, template images). */
  assetBase: string;
  /** Skip the client bundle to measure server-only output. */
  hydrate?: boolean;
}

export interface RenderResult {
  html: string;
  ms: number;
}

const DATA_ID = "__SITE_DATA__";

function escapeJson(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

/** Config → full HTML document. Runs in workerd and Node. */
export async function renderSite(config: SiteConfig, options: RenderOptions): Promise<RenderResult> {
  const started = Date.now();
  const data = toPageData(config, options.assetBase);
  const stream = await renderToReadableStream(<SiteView data={data} />);
  await stream.allReady;
  const body = await new Response(stream).text();
  const hydrate = options.hydrate ?? true;
  const { title, description, lang = "ko" } = config.meta;
  const html = `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="stylesheet" href="${options.assetBase}/_assets/site.css">
</head>
<body>
<div id="root">${body}</div>
${hydrate ? `<script id="${DATA_ID}" type="application/json">${escapeJson(data)}</script>
<script type="module" src="${options.assetBase}/_assets/client.js"></script>` : ""}
</body>
</html>`;
  return { html, ms: Date.now() - started };
}

export { DATA_ID };
