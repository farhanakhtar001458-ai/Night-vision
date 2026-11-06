# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --create-home --uid 10001 droidlinkx
WORKDIR /app
COPY --from=build --chown=droidlinkx:droidlinkx /app/node_modules ./node_modules
COPY --from=build --chown=droidlinkx:droidlinkx /app/dist ./dist
COPY --from=build --chown=droidlinkx:droidlinkx /app/package.json ./package.json
COPY --chown=droidlinkx:droidlinkx src/database ./src/database
RUN mkdir -p /app/storage/files && chown -R droidlinkx:droidlinkx /app/storage
USER droidlinkx
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8080/api/health || exit 1
CMD ["node", "dist/index.js"]
