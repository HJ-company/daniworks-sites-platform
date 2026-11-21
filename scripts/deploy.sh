#!/usr/bin/env bash
# Deploys one environment: build → D1 migrations → shared assets → api → router → console.
# Usage: ADMIN_TOKEN=... scripts/deploy.sh staging|production
# CI runs this from .github/workflows (CLOUDFLARE_API_TOKEN in the environment). Locally wrangler's
# own login works; ADMIN_TOKEN falls back to apps/api/.dev.vars.<env>.
set -euo pipefail
cd "$(dirname "$0")/.."

ENV="${1:-}"
case "$ENV" in
  staging) API_URL="https://api-staging.dsites.kr" ;;
  production) API_URL="https://api.dsites.kr" ;;
  *) echo "usage: scripts/deploy.sh staging|production" >&2; exit 2 ;;
esac

if [ -z "${ADMIN_TOKEN:-}" ] && [ -f "apps/api/.dev.vars.$ENV" ]; then
  ADMIN_TOKEN="$(sed -n 's/^ADMIN_TOKEN=//p' "apps/api/.dev.vars.$ENV" | head -1)"
fi
if [ -z "${ADMIN_TOKEN:-}" ]; then
  echo "ADMIN_TOKEN is required to upload shared assets (env or apps/api/.dev.vars.$ENV)" >&2
  exit 2
fi

step() { printf '\n== %s\n' "$*"; }

step "build"
pnpm build
pnpm --filter console build

# Migrations first: the new api code expects the new schema. Keep migrations additive (no drops or
# renames) so the api still running until the next step keeps working against it.
step "D1 migrations ($ENV)"
pnpm --filter api exec wrangler d1 migrations apply DB --env "$ENV" --remote

# Shared assets go up before the new api is live: the new code refuses to publish or render drafts
# until its asset version is in R2. They are content-addressed (dist/shared/<version>/), so the
# upload never touches files published sites use, and the running api's upload route takes them.
# On the very first deploy there is no api yet, so they go up right after it.
upload_shared() { API_URL="$API_URL" ADMIN_TOKEN="$ADMIN_TOKEN" node scripts/upload-shared.mjs; }
uploaded=0
if curl -fsS -o /dev/null "$API_URL/health"; then
  step "shared assets ($ENV, through the running api)"
  upload_shared
  uploaded=1
fi

# api before router and console: both bind to it.
step "api ($ENV)"
pnpm --filter api exec wrangler deploy --env "$ENV"
if [ "$uploaded" = 0 ]; then
  step "shared assets ($ENV, first deploy)"
  # A brand-new route takes a little while to answer.
  for _ in $(seq 1 30); do curl -fsS -o /dev/null "$API_URL/health" && break; sleep 2; done
  upload_shared
fi
step "router ($ENV)"
pnpm --filter router exec wrangler deploy --env "$ENV"
step "console ($ENV)"
pnpm --filter console exec wrangler deploy --env "$ENV"

step "health"
curl -fsS "$API_URL/health" >/dev/null && echo "$API_URL/health ok"
