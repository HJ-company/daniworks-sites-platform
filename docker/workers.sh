#!/usr/bin/env bash
# Starts the api and router Workers with shared local state (D1, R2, KV) for Docker verification.
set -euo pipefail
cd /app

STATE=/state
: "${ADMIN_TOKEN:=dev-admin-token}"

# wrangler reads secrets from .dev.vars; generate it from the container environment.
env | grep -E '^(ADMIN_TOKEN|TURNSTILE_SECRET|HASH_PEPPER|MAIL_|CF_|BLOG_|OPENAI_|IMAGE_)' > apps/api/.dev.vars || true

(cd apps/api && pnpm exec wrangler d1 migrations apply DB --local --persist-to "$STATE")

# Authentik stand-in on 127.0.0.1:8791, inside this container so the Workers, the verify
# container (same network namespace) and the host browser all see one issuer.
node docker/oidc-mock.mjs &

(cd apps/api && exec pnpm exec wrangler dev --port 8788 --inspector-port 9230 --ip 0.0.0.0 --persist-to "$STATE" --test-scheduled --show-interactive-dev-session=false) &
# Console Worker: built SPA + /api proxy behind the OIDC login (client secret of the mock's client).
printf 'OIDC_CLIENT_SECRET=dev-console-secret\nSESSION_SECRET=local-session-secret-0123456789abcdef\n' > apps/console/.dev.vars
(cd apps/console && exec pnpm exec wrangler dev --port 8789 --inspector-port 9232 --ip 0.0.0.0 --show-interactive-dev-session=false) &
(cd apps/router && exec pnpm exec wrangler dev --port 8787 --inspector-port 9231 --ip 0.0.0.0 --persist-to "$STATE" --show-interactive-dev-session=false) &

wait -n
echo "a worker exited" >&2
exit 1
