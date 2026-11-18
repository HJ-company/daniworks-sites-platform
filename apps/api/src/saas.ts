import type { Env } from "./env.js";
import { HttpError } from "./http.js";

/** The parts of a Cloudflare for SaaS custom hostname the platform uses. */
export interface CustomHostname {
  id: string;
  hostname: string;
  status: string;
  ssl?: { status?: string; method?: string; validation_records?: { txt_name?: string; txt_value?: string }[] };
  ownership_verification?: { type: string; name: string; value: string };
  verification_errors?: string[];
}

interface CfEnvelope<T> {
  success: boolean;
  errors?: { code: number; message: string }[];
  result: T;
  result_info?: { total_count?: number };
}

/**
 * Cloudflare for SaaS custom hostnames API. Locally `CF_API_BASE` points at the cf-mock
 * container, which serves the same HTTP shape, so this client is the code path in both.
 */
export class SaasClient {
  constructor(private readonly env: Env) {}

  static configured(env: Env) {
    return Boolean(env.CF_API_BASE && env.CF_ZONE_ID && env.CF_API_TOKEN);
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<CfEnvelope<T>> {
    const res = await fetch(`${this.env.CF_API_BASE}/zones/${this.env.CF_ZONE_ID}/custom_hostnames${path}`, {
      method,
      headers: { authorization: `Bearer ${this.env.CF_API_TOKEN}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const envelope = (await res.json().catch(() => null)) as CfEnvelope<T> | null;
    if (!res.ok || !envelope?.success) {
      const message = envelope?.errors?.map((e) => `${e.code} ${e.message}`).join("; ") ?? `HTTP ${res.status}`;
      throw new HttpError(res.status === 404 ? 404 : 502, `Cloudflare custom hostname 오류: ${message}`);
    }
    return envelope;
  }

  /** HTTP DCV: once the customer's CNAME points at the platform, hostname and certificate validate on their own. */
  async create(hostname: string) {
    return (await this.call<CustomHostname>("POST", "", { hostname, ssl: { method: "http", type: "dv", settings: { min_tls_version: "1.2" } } })).result;
  }

  async get(id: string) {
    return (await this.call<CustomHostname>("GET", `/${id}`)).result;
  }

  /** Idempotent: an already deleted hostname is fine. */
  async delete(id: string) {
    try {
      await this.call("DELETE", `/${id}`);
    } catch (error) {
      if (!(error instanceof HttpError && error.status === 404)) throw error;
    }
  }

  /** Hostnames on the zone (billing: 100 included, then per hostname). */
  async count() {
    // per_page must be 5–50 on the real API; only total_count is used.
    return (await this.call<CustomHostname[]>("GET", "?per_page=5")).result_info?.total_count ?? 0;
  }
}
