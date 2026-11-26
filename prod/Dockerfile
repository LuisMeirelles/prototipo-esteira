# ---- build: compila servidor e frontend ----
FROM node:24-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json build.mjs ./
COPY server ./server
COPY web ./web
RUN npm run check && npm run build

# ---- dependências de produção (só o binário nativo do sharp) ----
FROM node:24-alpine AS deps
WORKDIR /deps
RUN echo '{"name":"runtime","private":true}' > package.json
COPY --from=build /src/package-lock.json /tmp/lock.json
RUN SHARP_VERSION=$(node -p "require('/tmp/lock.json').packages['node_modules/sharp'].version") \
    && npm install --omit=dev --ignore-scripts=false --no-audit --no-fund "sharp@${SHARP_VERSION}" \
    && npm cache clean --force

# ---- imagem final ----
FROM node:24-alpine
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    WEB_DIR=/app/web
WORKDIR /app
COPY --from=deps /deps/node_modules ./node_modules
COPY --from=build /src/dist/server.mjs /src/dist/cli.mjs ./
COPY --from=build /src/dist/web ./web
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "server.mjs"]
