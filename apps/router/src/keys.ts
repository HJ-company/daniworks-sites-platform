// Storage layout shared by api (writer) and router (reader). Keep in sync with apps/api/src/keys.ts.
export const kvHostKey = (hostname: string) => `host:${hostname.toLowerCase()}`;
export const kvSiteKey = (siteId: string) => `site:${siteId}`;
export const r2PageKey = (siteId: string, versionId: string) => `sites/${siteId}/${versionId}/index.html`;
export const r2SharedKey = (path: string) => `shared/${path}`;

/** Value of kvSiteKey: the version the router serves. */
export interface PublishedPointer {
  versionId: string;
  number: number;
  publishedAt: string;
}
