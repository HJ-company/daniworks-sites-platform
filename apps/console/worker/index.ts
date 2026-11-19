import { createRemoteJWKSet, jwtVerify } from "jose";

/**
 * Operator console Worker (M4 4-D): the built SPA plus `/api/*` proxied to the api Worker, behind
 * an Authentik login (OIDC Authorization Code + PKCE, confidential client). The Worker holds the
 * tokens in an encrypted HttpOnly cookie and forwards the user's access token to the api, which
 * verifies it and records who did what. The browser never sees a token or a secret.
 */
interface Env {
  ASSETS: Fetcher;
  API: Fetcher;
  /** Authentik application issuer (`https://authentik.daniworks.kr/application/o/dsites-console/`). */
  OIDC_ISSUER?: string;
  OIDC_CLIENT_ID?: string;
  OIDC_CLIENT_SECRET?: string;
  /** Encrypts the session cookie. 32+ random characters, a secret in deployed environments. */
  SESSION_SECRET?: string;
  /** Where operators connect Claude/ChatGPT (`https://api.dsites.kr/mcp`), shown in the help page. */
  MCP_URL?: string;
  /** Deposit account put into payment requests to owners (`국민 000-00-0000 (주)다니웍스`). */
  BILLING_ACCOUNT?: string;
}

interface Session {
  /** Access token (forwarded to the api), refresh token, access token expiry (epoch seconds). */
  at: string;
  rt: string | null;
  exp: number;
  name: string | null;
  email: string | null;
}

interface Discovery {
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  end_session_endpoint?: string;
}

const SESSION_COOKIE = "dsites_session";
/** The sealed session is split across `dsites_session`, `dsites_session.1`… under the ~4 KB cookie limit. */
const CHUNK = 3500;
const MAX_CHUNKS = 5;
const LOGIN_COOKIE = "dsites_login";
const SESSION_SECONDS = 12 * 3600;
const OPERATOR_GROUP = "operator";

let discovered: { issuer: string; value: Promise<Discovery> } | null = null;
let jwks: { uri: string; set: ReturnType<typeof createRemoteJWKSet> } | null = null;

function config(env: Env) {
  if (!env.OIDC_ISSUER || !env.OIDC_CLIENT_ID || !env.OIDC_CLIENT_SECRET || !env.SESSION_SECRET || env.SESSION_SECRET.length < 32) return null;
  return { issuer: env.OIDC_ISSUER, clientId: env.OIDC_CLIENT_ID, secret: env.OIDC_CLIENT_SECRET, sessionSecret: env.SESSION_SECRET };
}

function discovery(issuer: string): Promise<Discovery> {
  if (discovered?.issuer !== issuer) {
    const value = fetch(new URL(".well-known/openid-configuration", issuer.endsWith("/") ? issuer : `${issuer}/`)).then((res) => {
      if (!res.ok) throw new Error(`discovery ${res.status}`);
      return res.json() as Promise<Discovery>;
    });
    // A failed fetch must not be cached for the isolate's lifetime.
    value.catch(() => (discovered = null));
    discovered = { issuer, value };
  }
  return discovered.value;
}

function keys(uri: string) {
  if (jwks?.uri !== uri) jwks = { uri, set: createRemoteJWKSet(new URL(uri)) };
  return jwks.set;
}

// ------------------------------------------------------------------------------ cookies

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (text: string) => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const random = (n: number) => b64url(crypto.getRandomValues(new Uint8Array(n)));

async function cipherKey(secret: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function seal(secret: string, value: unknown) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await cipherKey(secret), new TextEncoder().encode(JSON.stringify(value))));
  return `${b64url(iv)}.${b64url(data)}`;
}

async function open<T>(secret: string, sealed: string | undefined): Promise<T | null> {
  if (!sealed) return null;
  try {
    const [iv, data] = sealed.split(".");
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64url(iv!) }, await cipherKey(secret), fromB64url(data!));
    return JSON.parse(new TextDecoder().decode(plain)) as T;
  } catch {
    return null;
  }
}

function readCookie(request: Request, name: string) {
  const match = (request.headers.get("cookie") ?? "").split(/;\s*/).find((part) => part.startsWith(`${name}=`));
  return match?.slice(name.length + 1);
}

function cookie(request: Request, name: string, value: string, maxAge: number) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

const chunkName = (i: number) => (i === 0 ? SESSION_COOKIE : `${SESSION_COOKIE}.${i}`);

/** Set-Cookie headers for a sealed session, clearing chunks a previous, longer one left. Null if too large. */
function sessionCookies(request: Request, sealed: string) {
  const parts = sealed.match(new RegExp(`.{1,${CHUNK}}`, "g")) ?? [];
  if (parts.length > MAX_CHUNKS) return null;
  return Array.from({ length: MAX_CHUNKS }, (_, i) =>
    i < parts.length ? cookie(request, chunkName(i), parts[i]!, SESSION_SECONDS) : cookie(request, chunkName(i), "", 0),
  );
}

const clearSessionCookies = (request: Request) => Array.from({ length: MAX_CHUNKS }, (_, i) => cookie(request, chunkName(i), "", 0));

function readSessionCookie(request: Request) {
  let sealed = "";
  for (let i = 0; i < MAX_CHUNKS; i++) {
    const part = readCookie(request, chunkName(i));
    if (!part) break;
    sealed += part;
  }
  return sealed || undefined;
}

// ------------------------------------------------------------------------------ OIDC

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const page = (status: number, title: string, body: string) =>
  new Response(
    `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>` +
      `<body style="font-family:system-ui,-apple-system,'Apple SD Gothic Neo',sans-serif;max-width:420px;margin:96px auto;padding:0 24px;color:#1f2329">` +
      `<h1 style="font-size:20px">${title}</h1><p style="color:#5b616e;line-height:1.6">${body}</p></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );

/**
 * Only same-site paths: never redirect a login elsewhere. Resolved the way a browser would
 * (tabs and backslashes included) and reduced to path and query.
 */
export function safeReturn(value: string | null, origin: string) {
  if (!value) return "/";
  try {
    const resolved = new URL(value, origin);
    // `//host` as a path would itself be read as another site in a Location header.
    if (resolved.origin !== origin || resolved.pathname.startsWith("//")) return "/";
    return `${resolved.pathname}${resolved.search}`;
  } catch {
    return "/";
  }
}

async function tokenRequest(cfg: NonNullable<ReturnType<typeof config>>, body: Record<string, string>) {
  const { token_endpoint } = await discovery(cfg.issuer);
  const res = await fetch(token_endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${btoa(`${encodeURIComponent(cfg.clientId)}:${encodeURIComponent(cfg.secret)}`)}`,
    },
    body: new URLSearchParams(body),
  });
  if (!res.ok) return null;
  return (await res.json()) as { access_token: string; refresh_token?: string; id_token?: string };
}

/** Verifies the access token as the api will, and reads who it is for. */
async function sessionFrom(cfg: NonNullable<ReturnType<typeof config>>, tokens: { access_token: string; refresh_token?: string }, previousRefresh: string | null) {
  const { jwks_uri } = await discovery(cfg.issuer);
  const { payload } = await jwtVerify(tokens.access_token, keys(jwks_uri), { issuer: cfg.issuer, audience: cfg.clientId, algorithms: ["RS256"] });
  const groups = Array.isArray(payload.groups) ? payload.groups : [];
  const session: Session = {
    at: tokens.access_token,
    rt: tokens.refresh_token ?? previousRefresh,
    exp: payload.exp ?? 0,
    name: typeof payload.name === "string" ? payload.name : typeof payload.preferred_username === "string" ? payload.preferred_username : null,
    email: typeof payload.email === "string" ? payload.email : null,
  };
  return { session, operator: groups.includes(OPERATOR_GROUP) };
}

async function login(request: Request, cfg: NonNullable<ReturnType<typeof config>>) {
  const url = new URL(request.url);
  const verifier = random(32);
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  const state = random(16);
  const nonce = random(16);
  const { authorization_endpoint } = await discovery(cfg.issuer);
  const target = new URL(authorization_endpoint);
  target.search = new URLSearchParams({
    response_type: "code",
    client_id: cfg.clientId,
    redirect_uri: `${url.origin}/auth/callback`,
    scope: "openid profile email offline_access",
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  const pending = await seal(cfg.sessionSecret, { verifier, state, nonce, back: safeReturn(url.searchParams.get("return"), url.origin) });
  return new Response(null, { status: 302, headers: { location: target.toString(), "set-cookie": cookie(request, LOGIN_COOKIE, pending, 600) } });
}

async function callback(request: Request, cfg: NonNullable<ReturnType<typeof config>>) {
  const url = new URL(request.url);
  const pending = await open<{ verifier: string; state: string; nonce: string; back: string }>(cfg.sessionSecret, readCookie(request, LOGIN_COOKIE));
  if (!pending || url.searchParams.get("state") !== pending.state || !url.searchParams.get("code")) {
    return page(400, "로그인을 다시 시작해 주세요", `로그인 요청이 만료되었거나 올바르지 않습니다. <a href="/auth/login">다시 로그인</a>`);
  }
  const tokens = await tokenRequest(cfg, {
    grant_type: "authorization_code",
    code: url.searchParams.get("code")!,
    redirect_uri: `${url.origin}/auth/callback`,
    code_verifier: pending.verifier,
  });
  if (!tokens) return page(400, "로그인에 실패했습니다", `<a href="/auth/login">다시 로그인</a>`);
  // The ID token must be the one this login asked for.
  if (tokens.id_token) {
    const { jwks_uri } = await discovery(cfg.issuer);
    const { payload } = await jwtVerify(tokens.id_token, keys(jwks_uri), { issuer: cfg.issuer, audience: cfg.clientId });
    if (payload.nonce !== pending.nonce) return page(400, "로그인에 실패했습니다", `<a href="/auth/login">다시 로그인</a>`);
  }
  const { session, operator } = await sessionFrom(cfg, tokens, null);
  const clearLogin = cookie(request, LOGIN_COOKIE, "", 0);
  if (!operator) {
    const res = page(
      403,
      "운영자 권한이 없습니다",
      `${escapeHtml(session.name ?? "이")} 계정에는 콘솔을 쓸 권한이 없습니다. 관리자에게 운영자 권한을 요청하세요. <a href="/auth/logout">다른 계정으로 로그인</a>`,
    );
    res.headers.append("set-cookie", clearLogin);
    return res;
  }
  const cookies = sessionCookies(request, await seal(cfg.sessionSecret, session));
  if (!cookies) return page(500, "로그인 정보가 너무 큽니다", "Authentik 토큰에 담긴 정보(그룹 등)를 줄여 주세요.");
  const headers = new Headers({ location: pending.back });
  headers.append("set-cookie", clearLogin);
  for (const value of cookies) headers.append("set-cookie", value);
  return new Response(null, { status: 302, headers });
}

/**
 * The session, refreshed when the access token is about to expire (`renewed` must be stored).
 * Parallel requests may all try the same rotating refresh token; only one wins. A loser keeps
 * using the current access token while it is still valid, so it neither fails nor overwrites
 * the winner's new session. Once the token has actually expired a loser answers 401 and the SPA
 * retries with the winner's cookie (api.ts); there is no shared store to coordinate across isolates.
 */
async function currentSession(request: Request, cfg: NonNullable<ReturnType<typeof config>>) {
  const session = await open<Session>(cfg.sessionSecret, readSessionCookie(request));
  if (!session) return null;
  const now = Date.now() / 1000;
  if (session.exp - 60 > now) return { session, renewed: false };
  const stillValid = session.exp - 5 > now ? { session, renewed: false } : null;
  if (!session.rt) return stillValid;
  try {
    // Refused, unreachable or invalid alike: keep the current token while it lasts.
    const tokens = await tokenRequest(cfg, { grant_type: "refresh_token", refresh_token: session.rt });
    if (!tokens) return stillValid;
    const next = await sessionFrom(cfg, tokens, session.rt);
    return next.operator ? { session: next.session, renewed: true } : null;
  } catch {
    return stillValid;
  }
}

async function logout(request: Request, cfg: NonNullable<ReturnType<typeof config>>) {
  const url = new URL(request.url);
  const { end_session_endpoint } = await discovery(cfg.issuer);
  const target = end_session_endpoint ? new URL(end_session_endpoint) : new URL("/auth/login", url.origin);
  if (end_session_endpoint) target.searchParams.set("post_logout_redirect_uri", `${url.origin}/auth/logged-out`);
  const headers = new Headers({ location: target.toString() });
  for (const value of clearSessionCookies(request)) headers.append("set-cookie", value);
  return new Response(null, { status: 302, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cfg = config(env);
    if (!cfg) return page(503, "로그인이 설정되지 않았습니다", "OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, SESSION_SECRET(32자 이상)을 설정하세요.");
    const url = new URL(request.url);

    if (url.pathname === "/auth/login") return login(request, cfg);
    if (url.pathname === "/auth/callback") return callback(request, cfg);
    if (url.pathname === "/auth/logout") return logout(request, cfg);
    if (url.pathname === "/auth/logged-out") return page(200, "로그아웃했습니다", `<a href="/auth/login">다시 로그인</a>`);

    // Built JS/CSS chunks carry no data or credentials; serving them without a session keeps a
    // page's parallel chunk loads out of the refresh race.
    if (url.pathname.startsWith("/assets/")) return env.ASSETS.fetch(request);

    const current = await currentSession(request, cfg);
    const store = async (res: Response) => {
      if (!current?.renewed) return res;
      const cookies = sessionCookies(request, await seal(cfg.sessionSecret, current.session));
      if (!cookies) return res;
      const out = new Response(res.body, res);
      for (const value of cookies) out.headers.append("set-cookie", value);
      return out;
    };

    if (url.pathname === "/auth/me") {
      if (!current) return Response.json({ error: "로그인이 필요합니다" }, { status: 401 });
      return store(Response.json({ name: current.session.name, email: current.session.email, mcpUrl: env.MCP_URL ?? null, billingAccount: env.BILLING_ACCOUNT || null }));
    }

    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      if (!current) return Response.json({ error: "로그인이 필요합니다. 다시 로그인하세요", login: "/auth/login" }, { status: 401 });
      // Forward to the api Worker with the operator's own token; drop anything credential-like from the browser.
      const target = new URL(url.pathname.slice(4) || "/", "https://api.internal");
      target.search = url.search;
      const headers = new Headers(request.headers);
      headers.delete("cookie");
      headers.set("authorization", `Bearer ${current.session.at}`);
      return store(await env.API.fetch(new Request(target, { method: request.method, headers, body: request.body, redirect: "manual" })));
    }

    // Every page needs a login; the SPA itself carries no data.
    if (!current) return Response.redirect(`${url.origin}/auth/login?return=${encodeURIComponent(url.pathname + url.search)}`, 302);
    return store(await env.ASSETS.fetch(request));
  },
};
