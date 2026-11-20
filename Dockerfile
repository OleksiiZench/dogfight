FROM node:26-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/
COPY shared/package.json shared/
RUN npm ci

FROM deps AS build
COPY tsconfig.json tsconfig.base.json ./
COPY client/index.html client/
COPY client/vite.config.ts client/
COPY client/vite-env.d.ts client/
COPY client/src client/src
COPY client/public client/public
COPY shared/src shared/src
RUN npm run build

FROM node:26-alpine AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    LOG_LEVEL=info \
    VERSION=dev
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/
COPY shared/package.json shared/
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/client/dist client/dist
COPY server/src server/src
COPY server/data server/data
COPY shared/src shared/src
RUN addgroup -S app && adduser -S app -G app \
    && mkdir -p /app/.logs \
    && chown -R app:app /app
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "server/src/index.ts"]
