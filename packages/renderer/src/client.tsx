import { hydrateRoot } from "react-dom/client";
import { startTracking } from "./platform/track.js";
import { SiteView, type PageData } from "./view.js";

const DATA_ID = "__SITE_DATA__";
const root = document.getElementById("root");
const json = document.getElementById(DATA_ID)?.textContent;
if (root && json) {
  const data = JSON.parse(json) as PageData;
  hydrateRoot(root, <SiteView data={data} />, {
    onRecoverableError(error) {
      console.error("[sites] hydration error", error);
    },
  });
  // Industry-template sites only, and never from previews.
  if (data.site && !data.preview) startTracking();
}
