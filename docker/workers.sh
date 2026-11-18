#!/usr/bin/env bash
# Starts the api and router Workers with shared local state (D1, R2, KV) for Docker verification.
set -euo pipefail
cd /app

STATE=/state
: "${ADMIN_TOKEN:=dev-admin-token}"

# wrangler reads secrets from .dev.vars; generate it from the container environment.
env | grep -E '^(ADMIN_TOKEN|TURNSTILE_SECRET|MAIL_|CF_|ACCESS_)' > apps/api/.dev.vars || true

(cd apps/api && pnpm exec wrangler d1 migrations apply DB --local --persist-to "$STATE")

(cd apps/api && exec pnpm exec wrangler dev --port 8788 --inspector-port 9230 --ip 0.0.0.0 --persist-to "$STATE" --show-interactive-dev-session=false) &
(cd apps/router && exec pnpm exec wrangler dev --port 8787 --inspector-port 9231 --ip 0.0.0.0 --persist-to "$STATE" --show-interactive-dev-session=false) &

wait -n
echo "a worker exited" >&2
exit 1
