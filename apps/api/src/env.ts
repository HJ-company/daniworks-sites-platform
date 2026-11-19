export interface Env {
  DB: D1Database;
  SITES: R2Bucket;
  ROUTES: KVNamespace;
  BASE_DOMAIN: string;
  ADMIN_TOKEN: string;
  /** `https` in deployed environments, `http` locally. Used for canonical and OG URLs. */
  PUBLIC_SCHEME?: string;
  /** Authentik applications (each has its own issuer): the console login and the MCP connector. */
  CONSOLE_OIDC_ISSUER?: string;
  CONSOLE_OIDC_CLIENT_ID?: string;
  MCP_OIDC_ISSUER?: string;
  MCP_OIDC_CLIENT_ID?: string;
  /** Origin of customer draft links (`https://dsites.kr`; locally the router). */
  PREVIEW_ORIGIN?: string;
  /** Public origin of this API (`https://api.dsites.kr`); hosts the Turnstile frame sites embed. */
  API_ORIGIN?: string;
  /** Turnstile widget key (public) and secret. Without a secret the check is skipped. */
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET?: string;
  /** `binding` (Cloudflare Email Service), `mailpit` (local inbox) or `off`. */
  MAIL_MODE?: "binding" | "mailpit" | "off";
  MAIL_FROM?: string;
  MAIL_PIT_URL?: string;
  EMAIL?: SendEmail;
  /** Cloudflare for SaaS custom hostnames. Locally CF_API_BASE is the cf-mock container. */
  CF_API_BASE?: string;
  CF_ZONE_ID?: string;
  CF_API_TOKEN?: string;
  /** CNAME target customers point their domain at (the SaaS fallback origin host). */
  DOMAIN_CNAME_TARGET?: string;
  /** Naver blog RSS base (`https://rss.blog.naver.com`); Docker points it at fixtures. */
  BLOG_RSS_BASE?: string;
  /** Days a cancelled site's data is kept before an operator may purge it (default 365: one year). */
  RETENTION_DAYS?: string;
  /** Pepper for hashing visitor IPs (rate limiting without storing addresses). */
  HASH_PEPPER?: string;
  /** Image generation (image_generate). Without a key the tool explains it is not configured. */
  OPENAI_API_KEY?: string;
  OPENAI_IMAGE_MODEL?: string;
  /** Images API base (`https://api.openai.com/v1`); Docker points it at cf-mock. */
  OPENAI_BASE_URL?: string;
  /** Recorded cost per generated image in USD, for the console's totals. Unset: not recorded. */
  IMAGE_COST_USD?: string;
}
