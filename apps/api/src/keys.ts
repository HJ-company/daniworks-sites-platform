// Storage layout shared by api (writer) and router (reader). Keep in sync with apps/router/src/keys.ts.
export const kvHostKey = (hostname: string) => `host:${hostname.toLowerCase()}`;
export const kvSiteKey = (siteId: string) => `site:${siteId}`;
/**
 * `path` is `index.html` or `privacy/index.html`. With a renderId (since M2) every render has its
 * own immutable prefix; without one it is the M1 layout, still served for old pointers.
 */
export const r2PageKey = (siteId: string, versionId: string, path = "index.html", renderId?: string | null) =>
  renderId ? `sites/${siteId}/${versionId}/r/${renderId}/${path}` : `sites/${siteId}/${versionId}/${path}`;
export const r2SharedKey = (path: string) => `shared/${path}`;
/** Uploaded photos, content-addressed: `sites/<siteId>/media/<sha>.jpg`. Served at `/_media/<siteId>/<file>`. */
export const r2MediaKey = (siteId: string, file: string) => `sites/${siteId}/media/${file}`;
export const MEDIA_PATH = /^\/_media\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+(?:\.w\d{3,4})?\.(?:jpg|png|webp))$/;

/** Value of kvSiteKey: the version the router serves. */
export interface PublishedPointer {
  versionId: string;
  number: number;
  publishedAt: string;
  /** Routes rendered for this version. Missing on M1 pointers, which only had `/`. */
  pages?: string[];
  /** Immutable render of this version to serve. Missing on M1 pointers (legacy layout). */
  renderId?: string | null;
}

/**
 * Value of kvHostKey since M2: everything the router needs in one read. M1 stored the bare
 * siteId string there and the pointer under kvSiteKey; the router still accepts that form.
 */
export interface HostRecord {
  siteId: string;
  /** `suspended`: 503 (temporary). `cancelled`: 410. */
  status: "active" | "suspended" | "cancelled";
  /** Missing until the first publish. */
  pointer: PublishedPointer | null;
  /** 301 target host, e.g. the default subdomain once a custom domain is active. */
  redirectTo: string | null;
  /** Business name for notice pages (the suspended page shows only this). Missing before M4. */
  name?: string | null;
}
