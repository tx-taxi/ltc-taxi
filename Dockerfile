FROM node:24-bookworm-slim AS frontend-builder
ENV CYPRESS_INSTALL_BINARY=0
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend ./
COPY adapter/generate-static-seo.cjs adapter/static-seo.config.json /app/adapter/
RUN node /app/adapter/generate-static-seo.cjs /app/frontend /app/adapter/static-seo-pages.json
COPY adapter/frontend-production-config.json ./mempool-frontend-config.json
RUN npm run generate-themes && npm run generate-config && node node_modules/@angular/cli/bin/ng.js build --configuration production --localize=false && node async-native-styles.cjs

FROM node:24-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends fonts-dejavu-core ca-certificates curl && rm -rf /var/lib/apt/lists/*
COPY adapter/package.json adapter/package-lock.json ./adapter/
RUN cd adapter && npm ci --omit=dev
COPY adapter ./adapter
COPY --from=frontend-builder /app/adapter/static-seo-pages.json ./adapter/static-seo-pages.json
COPY frontend/src/resources/branding/ltc-dark-navbar.svg ./frontend/src/resources/branding/ltc-dark-navbar.svg
COPY --from=frontend-builder /app/frontend/dist/mempool/browser ./public
COPY --from=frontend-builder /app/frontend/src/resources ./public/resources
ENV LTC_HOST=0.0.0.0
ENV LTC_STATIC_ROOT=/app/public
ENV LTC_SITE_ORIGIN=https://ltc.tx.taxi
ENV LTC_ROUTER_ORIGIN=https://tx.taxi
ENV PORT=8080
ENV LTC_DATA_DIR=/app/data
RUN mkdir -p /app/data && chown node:node /app/data
VOLUME ["/app/data"]
USER node
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=3 CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "adapter/server.cjs"]
