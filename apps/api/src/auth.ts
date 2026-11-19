import { createRemoteJWKSet, decodeJwt, jwtVerify, type JWTPayload } from "jose";
import type { Env } from "./env.js";
import { HttpError } from "./http.js";

/**
 * Who is calling (M4 4-D). Console and MCP callers carry an Authentik access token (RS256 JWT,
 * `aud` = the client id, `groups` claim); scripts and deploys use the fixed ADMIN_TOKEN. Each
 * Authentik application has its own issuer, so the console and MCP clients are configured
 * separately and a token must match one of them on issuer and audience.
 */
export interface Actor {
  type: "user" | "script";
  id: string;
  name: string | null;
  groups: string[];
  via: "console" | "mcp" | "script";
}

const OPERATOR_GROUP = "operator";

interface Client {
  via: "console" | "mcp";
  issuer: string;
  clientId: string;
}

function clients(env: Env): Client[] {
  const out: Client[] = [];
  if (env.CONSOLE_OIDC_ISSUER && env.CONSOLE_OIDC_CLIENT_ID) out.push({ via: "console", issuer: env.CONSOLE_OIDC_ISSUER, clientId: env.CONSOLE_OIDC_CLIENT_ID });
  if (env.MCP_OIDC_ISSUER && env.MCP_OIDC_CLIENT_ID) out.push({ via: "mcp", issuer: env.MCP_OIDC_ISSUER, clientId: env.MCP_OIDC_CLIENT_ID });
  return out;
}

// One JWKS fetcher per issuer for the isolate's lifetime (jose caches keys and refetches on a new kid).
const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
async function keySet(issuer: string) {
  let set = keySets.get(issuer);
  if (!set) {
    const discovery = await fetch(new URL(".well-known/openid-configuration", issuer.endsWith("/") ? issuer : `${issuer}/`));
    if (!discovery.ok) throw new HttpError(503, "로그인 서버에 연결할 수 없습니다");
    const { jwks_uri } = (await discovery.json()) as { jwks_uri: string };
    set = createRemoteJWKSet(new URL(jwks_uri));
    keySets.set(issuer, set);
  }
  return set;
}

const encoder = new TextEncoder();
// Workers extension; the DOM lib (needed by the renderer's JSX) does not declare it.
const subtle = crypto.subtle as SubtleCrypto & { timingSafeEqual(a: ArrayBufferView, b: ArrayBufferView): boolean };
function sameSecret(given: string, expected: string) {
  const a = encoder.encode(given);
  const b = encoder.encode(expected);
  return a.byteLength === b.byteLength && subtle.timingSafeEqual(a, b);
}

/** Verifies the bearer token. 401 without a valid one, 403 for a signed-in non-operator. */
export async function authenticate(request: Request, env: Env): Promise<Actor> {
  if (!env.ADMIN_TOKEN) throw new HttpError(500, "ADMIN_TOKEN이 설정되지 않았습니다");
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!token) throw new HttpError(401, "인증이 필요합니다");
  if (sameSecret(token, env.ADMIN_TOKEN)) return { type: "script", id: "script", name: "스크립트", groups: [OPERATOR_GROUP], via: "script" };

  let unverified: JWTPayload;
  try {
    unverified = decodeJwt(token);
  } catch {
    throw new HttpError(401, "인증이 필요합니다");
  }
  const client = clients(env).find((c) => c.issuer === unverified.iss && (unverified.aud === c.clientId || (Array.isArray(unverified.aud) && unverified.aud.includes(c.clientId))));
  if (!client) throw new HttpError(401, "인증이 필요합니다");
  let payload: JWTPayload & { groups?: unknown; name?: unknown; preferred_username?: unknown };
  try {
    ({ payload } = await jwtVerify(token, await keySet(client.issuer), {
      issuer: client.issuer,
      audience: client.clientId,
      algorithms: ["RS256"],
      requiredClaims: ["exp", "sub"],
    }));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(401, "로그인이 만료되었거나 올바르지 않습니다");
  }
  const groups = Array.isArray(payload.groups) ? payload.groups.filter((g): g is string => typeof g === "string") : [];
  if (!groups.includes(OPERATOR_GROUP)) throw new HttpError(403, "운영자 권한이 없습니다. 관리자에게 operator 그룹을 요청하세요");
  const name = typeof payload.name === "string" ? payload.name : typeof payload.preferred_username === "string" ? payload.preferred_username : null;
  return { type: "user", id: payload.sub!, name, groups, via: client.via };
}

/** RFC 9728 metadata MCP clients read after a 401 to find Authentik. */
export function protectedResourceMetadata(env: Env) {
  return {
    resource: `${env.API_ORIGIN ?? ""}/mcp`,
    authorization_servers: env.MCP_OIDC_ISSUER ? [env.MCP_OIDC_ISSUER] : [],
    scopes_supported: ["openid", "profile", "email", "offline_access"],
    bearer_methods_supported: ["header"],
    resource_name: "스타터 홈페이지 MCP",
  };
}

export const mcpChallenge = (env: Env) => `Bearer resource_metadata="${env.API_ORIGIN ?? ""}/.well-known/oauth-protected-resource/mcp"`;

/** How a person appears in records (versions, payments): their name, else their id. */
export const actorName = (actor: Actor) => actor.name ?? actor.id;

const now = () => new Date().toISOString();

/** One row per authenticated change. Never the request body (it may hold personal data). */
export async function audit(env: Env, actor: Actor, entry: { action: string; siteId?: string | null; target?: string | null; status: number }) {
  try {
    await env.DB.prepare(
      "INSERT INTO audit_log (id, actor_type, actor_id, actor_name, via, action, site_id, target, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(crypto.randomUUID(), actor.type, actor.id, actor.name, actor.via, entry.action, entry.siteId ?? null, entry.target ?? null, entry.status, now())
      .run();
  } catch (error) {
    // The change itself already happened; a missing audit row must not turn it into an error.
    console.error("[audit] failed", error);
  }
}

/** `POST /sites/:id/publish` from `/sites/abc/publish`: ids replaced so actions group. */
export function actionOf(method: string, parts: string[]) {
  const ID = /^[0-9a-f-]{20,}$|^[0-9a-f]{32,}$/i;
  return `${method} /${parts.map((part, i) => (ID.test(part) || (parts[0] === "sites" && i === 1) || (parts[0] === "customers" && i === 1) || (parts[0] === "payments" && i === 1) ? ":id" : part)).join("/")}`;
}
