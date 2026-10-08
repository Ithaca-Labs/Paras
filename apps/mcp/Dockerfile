# syntax=docker/dockerfile:1
# Build context is the repo root: docker build -f apps/mcp/Dockerfile .
FROM node:22-slim AS builder
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm --filter @paras/mcp build \
 && npm_config_shamefully_hoist=true pnpm --filter @paras/mcp deploy --legacy --prod /out

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=builder /out/node_modules ./node_modules
COPY --from=builder /out/dist ./dist
USER node
EXPOSE 3002
CMD ["node", "dist/index.js"]
