export interface Env {
  DB: D1Database;
  SITES: R2Bucket;
  ROUTES: KVNamespace;
  BASE_DOMAIN: string;
  ADMIN_TOKEN: string;
  /** `https` in deployed environments, `http` locally. Used for canonical and OG URLs. */
  PUBLIC_SCHEME?: string;
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
  /** Pepper for hashing visitor IPs (rate limiting without storing addresses). */
  HASH_PEPPER?: string;
}
