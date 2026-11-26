---
description: Docker, Caddy e build de produção.
paths:
  - "prod/**"
  - "dev/**"
  - "app/build.mjs"
  - ".env.example"
---

# Docker e deploy

- Compose sempre com `--env-file ../.env`, rodando dentro de `prod/` ou `dev/`. O `.env` nunca entra na imagem nem no git.
- `HOST_IP` e `PUBLIC_ORIGIN` têm que ser o IP real de acesso. `HOST_IP` errado faz o Caddy gerar certificado para outro IP e responder 200 vazio (tela em branco).
- Produção (`prod/`): imagem multi-stage (check + build → runtime só com `sharp` + `server.mjs` + `cli.mjs` + `web/`), usuário `node`, `read_only`, `tmpfs /tmp`, `cap_drop: ALL`, `no-new-privileges`, volume só em `/data`, **sem `ports` no `app`**. O Caddy é o único que publica 80/443 e usa `tls internal` com `default_sni` (navegador não envia SNI para IP).
- Desenvolvimento (`dev/`): `node --watch` sobre `server/` e `web/` montados read-only. Não tem build. O Caddy do dev publica em `${DEV_HTTP_PORT:-8080}`/`${DEV_HTTPS_PORT:-8443}` (a produção fica com 80/443), então os dois podem rodar juntos. O `PUBLIC_ORIGIN` do dev é montado no compose como `https://${HOST_IP}:${DEV_HTTPS_PORT}` (o `Origin` é checado exatamente, porta incluída); o do `.env` só vale na produção.
- `HEALTHCHECK` consulta `GET /` do app. Se mudar a raiz ou o servidor de estáticos, ajuste o `Dockerfile`.
- Variável de ambiente nova: `config.ts` + `.env.example` + os dois `docker-compose.yml` (com `${VAR:?mensagem}` se obrigatória) + `README.md`.
- `build.mjs` gera `dist/server.mjs` e `dist/cli.mjs` (sharp fica `external` por ser binário nativo) e `dist/web/` com hash no nome (`-[A-Z0-9]{8}`); `index.ts` serve esses arquivos com `immutable` pelo padrão do nome. Se mudar o padrão de hash, ajuste `setHeaders` em `server/index.ts`.
- Dependência nova de runtime: se for nativa, vai `external` no esbuild e precisa ser instalada no estágio `deps` do `prod/Dockerfile`. Prefira não adicionar dependências.
- Dados: `chat_data` (banco SQLite + `media/`) e `caddy_data` (CA e certificado: apagar obriga todos a aceitar o certificado de novo). Nunca rode `docker compose down -v` em produção sem backup.
- Subir ou reiniciar produção afeta quem está usando: só faça quando o usuário pedir. Veja a skill `/deploy-prod`.
