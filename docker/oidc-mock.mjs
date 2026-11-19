// Stand-in for Authentik (OIDC/OAuth 2.0) so the console login and MCP OAuth run unchanged in
// Docker. Same shapes as Authentik: discovery, Authorization Code + PKCE S256 for confidential
// clients, RS256 JWT access tokens with a `groups` claim, refresh tokens, JWKS, end session.
// Runs inside the workers container on 127.0.0.1:8791, so Workers, scripts and the host browser
// all see one issuer. In-memory; restart clears codes and refresh tokens (keys too).
// Control (tests only): POST /__mock/ttl?seconds=N sets the access token lifetime.
import http from "node:http";
import { createHash, createSign, generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";

const PORT = Number(process.env.OIDC_MOCK_PORT ?? 8791);
const ISSUER = process.env.OIDC_MOCK_ISSUER ?? `http://127.0.0.1:${PORT}`;
let ttl = Number(process.env.OIDC_MOCK_TTL ?? 900);

// Pre-registered confidential clients, as in Authentik (no dynamic registration).
const CLIENTS = {
  "dsites-console": {
    secret: process.env.OIDC_CONSOLE_SECRET ?? "dev-console-secret",
    redirects: ["http://127.0.0.1:8789/auth/callback", "http://localhost:8789/auth/callback"],
  },
  "dsites-mcp": {
    secret: process.env.OIDC_MCP_SECRET ?? "dev-mcp-secret",
    redirects: [
      "https://claude.ai/api/mcp/auth_callback",
      "https://chatgpt.com/connector_platform_oauth_redirect",
      "http://localhost:6274/oauth/callback",
      "http://127.0.0.1:6274/oauth/callback",
    ],
  },
};

const USERS = {
  kim: { sub: "u-kim", name: "김운영", email: "kim@daniworks.kr", groups: ["operator"] },
  lee: { sub: "u-lee", name: "이운영", email: "lee@daniworks.kr", groups: ["operator"] },
  guest: { sub: "u-guest", name: "손님", email: "guest@example.test", groups: [] },
  owner: { sub: "u-owner", name: "사장님", email: "owner@example.test", groups: ["customer"], customer_id: "c-demo" },
  // An operator in many groups: a token too large for one cookie.
  many: {
    sub: "u-many",
    name: "그룹많은운영",
    email: "many@daniworks.kr",
    groups: ["operator", ...Array.from({ length: 200 }, (_, i) => `daniworks-team-${String(i).padStart(3, "0")}-long-group-name`)],
  },
};

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const KID = randomUUID();
const jwk = { ...publicKey.export({ format: "jwk" }), kid: KID, use: "sig", alg: "RS256" };

const b64url = (data) => Buffer.from(data).toString("base64url");
function sign(payload) {
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: KID }));
  const body = b64url(JSON.stringify(payload));
  const signature = createSign("RSA-SHA256").update(`${head}.${body}`).sign(privateKey);
  return `${head}.${body}.${b64url(signature)}`;
}

const codes = new Map();
const refreshTokens = new Map();

function tokens(clientId, userKey, { nonce, scope } = {}) {
  const user = USERS[userKey];
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: ISSUER,
    sub: user.sub,
    aud: clientId,
    iat: now,
    exp: now + ttl,
    name: user.name,
    email: user.email,
    preferred_username: userKey,
    groups: user.groups,
    ...(user.customer_id ? { customer_id: user.customer_id } : {}),
  };
  const refresh = randomBytes(24).toString("hex");
  refreshTokens.set(refresh, { clientId, userKey, scope });
  return {
    access_token: sign({ ...claims, scope: scope ?? "openid profile email" }),
    id_token: sign({ ...claims, ...(nonce ? { nonce } : {}) }),
    refresh_token: refresh,
    token_type: "Bearer",
    expires_in: ttl,
    scope: scope ?? "openid profile email",
  };
}

const json = (res, status, body, headers = {}) => {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...headers });
  res.end(JSON.stringify(body));
};
const html = (res, status, body) => {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  res.end(body);
};
const escape = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function clientAuth(req, form) {
  const basic = req.headers.authorization?.match(/^Basic (.+)$/i);
  if (basic) {
    const [id, secret] = Buffer.from(basic[1], "base64").toString().split(":").map(decodeURIComponent);
    return { id, secret };
  }
  return { id: form.get("client_id"), secret: form.get("client_secret") };
}

const discovery = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/authorize`,
  token_endpoint: `${ISSUER}/token`,
  jwks_uri: `${ISSUER}/jwks`,
  userinfo_endpoint: `${ISSUER}/userinfo`,
  end_session_endpoint: `${ISSUER}/end-session`,
  response_types_supported: ["code"],
  grant_types_supported: ["authorization_code", "refresh_token"],
  code_challenge_methods_supported: ["S256"],
  token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
  id_token_signing_alg_values_supported: ["RS256"],
  scopes_supported: ["openid", "profile", "email", "offline_access"],
  subject_types_supported: ["public"],
};

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, ISSUER);
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const form = new URLSearchParams(raw);

    if (url.pathname === "/.well-known/openid-configuration" || url.pathname === "/.well-known/oauth-authorization-server") {
      return json(res, 200, discovery);
    }
    if (url.pathname === "/jwks") return json(res, 200, { keys: [jwk] });

    if (url.pathname === "/authorize") {
      const p = req.method === "POST" ? form : url.searchParams;
      const client = CLIENTS[p.get("client_id")];
      if (!client || !client.redirects.includes(p.get("redirect_uri"))) return html(res, 400, "<p>알 수 없는 클라이언트 또는 redirect_uri</p>");
      if (p.get("response_type") !== "code" || !p.get("code_challenge") || p.get("code_challenge_method") !== "S256") {
        return html(res, 400, "<p>Authorization Code + PKCE(S256)만 지원합니다</p>");
      }
      const user = req.method === "POST" ? p.get("user") : null;
      if (!user || !USERS[user]) {
        const hidden = [...p.entries()].filter(([k]) => k !== "user").map(([k, v]) => `<input type="hidden" name="${escape(k)}" value="${escape(v)}">`).join("");
        const buttons = Object.entries(USERS)
          .map(([key, u]) => `<button name="user" value="${key}" style="display:block;width:100%;margin:8px 0;padding:12px;font-size:15px">${escape(u.name)} (${key}, ${u.groups.join(",") || "그룹 없음"})</button>`)
          .join("");
        return html(
          res,
          200,
          `<!doctype html><html lang="ko"><meta charset="utf-8"><title>Authentik (로컬 목업) 로그인</title><body style="font-family:system-ui;max-width:360px;margin:64px auto">` +
            `<h1 style="font-size:20px">Authentik 로그인 (로컬 목업)</h1><form method="post" action="/authorize">${hidden}${buttons}</form></body></html>`,
        );
      }
      const code = randomBytes(16).toString("hex");
      codes.set(code, {
        clientId: p.get("client_id"),
        redirectUri: p.get("redirect_uri"),
        challenge: p.get("code_challenge"),
        nonce: p.get("nonce"),
        scope: p.get("scope"),
        user,
        exp: Date.now() + 60_000,
      });
      const back = new URL(p.get("redirect_uri"));
      back.searchParams.set("code", code);
      if (p.get("state")) back.searchParams.set("state", p.get("state"));
      back.searchParams.set("iss", ISSUER);
      res.writeHead(302, { location: back.toString() });
      return res.end();
    }

    if (url.pathname === "/token" && req.method === "POST") {
      const auth = clientAuth(req, form);
      const client = CLIENTS[auth.id];
      if (!client || client.secret !== auth.secret) return json(res, 401, { error: "invalid_client" });
      if (form.get("grant_type") === "authorization_code") {
        const entry = codes.get(form.get("code"));
        codes.delete(form.get("code"));
        if (!entry || entry.exp < Date.now() || entry.clientId !== auth.id || entry.redirectUri !== form.get("redirect_uri")) {
          return json(res, 400, { error: "invalid_grant" });
        }
        const challenge = createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url");
        if (challenge !== entry.challenge) return json(res, 400, { error: "invalid_grant", error_description: "PKCE" });
        return json(res, 200, tokens(auth.id, entry.user, { nonce: entry.nonce, scope: entry.scope }));
      }
      if (form.get("grant_type") === "refresh_token") {
        const entry = refreshTokens.get(form.get("refresh_token"));
        refreshTokens.delete(form.get("refresh_token"));
        if (!entry || entry.clientId !== auth.id) return json(res, 400, { error: "invalid_grant" });
        return json(res, 200, tokens(auth.id, entry.userKey, { scope: entry.scope }));
      }
      return json(res, 400, { error: "unsupported_grant_type" });
    }

    if (url.pathname === "/end-session") {
      const back = url.searchParams.get("post_logout_redirect_uri");
      res.writeHead(back ? 302 : 200, back ? { location: back } : { "content-type": "text/plain; charset=utf-8" });
      return res.end(back ? undefined : "로그아웃했습니다");
    }

    if (url.pathname === "/__mock/ttl" && req.method === "POST") {
      ttl = Number(url.searchParams.get("seconds") ?? 900);
      return json(res, 200, { ttl });
    }
    json(res, 404, { error: "not_found" });
  })
  .listen(PORT, "0.0.0.0", () => console.log(`oidc-mock on ${ISSUER}`));
