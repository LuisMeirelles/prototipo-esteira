FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=development \
    PORT=3000 \
    DATA_DIR=/data
COPY package.json package-lock.json ./
RUN npm ci
RUN mkdir /data && chown node:node /data /app
USER node
EXPOSE 3000
# código-fonte vem por bind mount (server/ e web/); node --watch reinicia ao salvar
CMD ["node", "--watch", "--disable-warning=ExperimentalWarning", "server/index.ts"]
