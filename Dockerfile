FROM node:20-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
ARG CONVEX_DEPLOY_ON_BUILD=false
ARG CONVEX_SELF_HOSTED_URL=""
ARG CONVEX_SELF_HOSTED_ADMIN_KEY=""
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN if [ "$CONVEX_DEPLOY_ON_BUILD" = "true" ]; then \
      if [ -z "$CONVEX_SELF_HOSTED_URL" ] || [ -z "$CONVEX_SELF_HOSTED_ADMIN_KEY" ]; then \
        echo "CONVEX_DEPLOY_ON_BUILD=true, but CONVEX_SELF_HOSTED_URL or CONVEX_SELF_HOSTED_ADMIN_KEY is missing" >&2; \
        exit 1; \
      fi; \
      printf 'CONVEX_SELF_HOSTED_URL=%s\nCONVEX_SELF_HOSTED_ADMIN_KEY=%s\n' \
        "$CONVEX_SELF_HOSTED_URL" \
        "$CONVEX_SELF_HOSTED_ADMIN_KEY" \
        > /tmp/convex-deploy.env; \
      npx convex deploy --env-file /tmp/convex-deploy.env; \
      rm -f /tmp/convex-deploy.env; \
    else \
      echo "Skipping Convex deploy during image build"; \
    fi
RUN npm run build

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000

CMD ["node", "server.js"]
