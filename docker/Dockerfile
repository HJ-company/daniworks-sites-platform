# One image for every local service: Workers (wrangler/workerd), verification (Playwright, Lighthouse)
# and small Node helpers. Dependencies are installed inside Linux so platform binaries
# (workerd, esbuild) match the container, never the host's node_modules.
FROM mcr.microsoft.com/playwright:v1.65.1-noble

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=1 \
    WRANGLER_SEND_METRICS=false \
    WRANGLER_LOG_PATH=/tmp/wrangler-logs
RUN npm install -g pnpm@10.28.0

WORKDIR /app
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && pnpm install --frozen-lockfile
RUN pnpm build && pnpm --filter console build
