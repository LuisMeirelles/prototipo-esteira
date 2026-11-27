# Chat interno

Chat em grupo (uma única sala) para a rede interna, acessado por IP sem DNS, em Docker. A rede é hostil: quem usa pode tentar invadir. **Segurança vem antes de conveniência.** Idioma da UI, mensagens e comentários: português do Brasil.

## Stack

Node 24 + Fastify 5 + `@fastify/websocket` + SQLite (`node:sqlite`, sem ORM) · frontend em HTML/CSS/JS puro (sem framework, sem bundler em dev) · Caddy com HTTPS autoassinado no IP · `sharp` para imagens · esbuild só no build de produção.

## Estrutura

```
app/server/   API, WebSocket, auth, banco (TypeScript rodado direto pelo Node)
app/web/      index.html, app.js, md.js, emojis.js, fake.js (terminais decorativos e camuflagem), style.css, bridge.mjs (ponte local, baixada pelos usuários)
app/test/     smoke.mjs (integração) e run.mjs (sobe servidor descartável)
app/build.mjs build de produção (dist/server.mjs, dist/cli.mjs, dist/web/ com hash)
dev/          compose de desenvolvimento (bind mount, node --watch)
prod/         compose de produção (build multi-stage, container endurecido, Caddyfile)
.env          fora do git: HOST_IP, PUBLIC_ORIGIN, INVITE_CODE
```

Mapa do servidor: `index.ts` (hooks globais: headers, CSRF, sessão, WS) · `auth.ts` (cadastro/login) · `api.ts` (rotas `/api/*` e `/media/*`) · `store.ts` (todo o SQL e a montagem de views) · `hub.ts` (WebSocket, presença) · `version.ts` (versão do frontend, enviada no `hello`) · `images.ts` · `password.ts` · `limits.ts` · `config.ts` · `cli.ts` (admin).

## Comandos

Dentro de `app/`:

| Comando | O que faz |
|---|---|
| `npm run check` | Typecheck (`tsc --noEmit`) |
| `npm test` | Integração completa com servidor descartável (porta e banco temporários) |
| `npm run build` | Build de produção em `dist/` |
| `npm run dev` | Servidor local com `--watch` (precisa de `INVITE_CODE` e `PUBLIC_ORIGIN` no ambiente) |

Docker (sempre com `--env-file ../.env`, dentro de `prod/` ou `dev/`): `docker compose --env-file ../.env up -d --build`. A produção usa 80/443 e o dev 8080/8443 (`DEV_HTTP_PORT`/`DEV_HTTPS_PORT`), então podem rodar juntos; o dev é acessado em `https://HOST_IP:8443`. Skills: `/verify`, `/deploy-prod`, `/add-endpoint`, `/security-audit`, `/admin-users`.

## Convenções

- TypeScript sem enums nem parameter properties (`erasableSyntaxOnly`); imports com extensão `.ts`; `import type` para tipos.
- Todo SQL fica em `store.ts` (ou `db.ts`), sempre parametrizado. Sem migrações: o schema é `CREATE TABLE IF NOT EXISTS`, então **mudar tabela existente exige migração explícita** (o banco de produção tem dados reais). As migrações existentes ficam em `db.ts`, idempotentes.
- Frontend: nunca `innerHTML` com dado de usuário; texto vai por `textContent`/`createElement`. Sem `style=` ou `<script>` inline (a CSP bloqueia); estilo dinâmico só via `el.style.prop = ...`.
- Erros da API são códigos curtos (`{ error: 'invalid_body' }`); o frontend traduz para mensagens em `ERRORS`/`AUTH_ERRORS` em `app.js`.
- Comentários explicam o porquê (decisão, risco), não o quê.

## Invariantes de segurança (não quebrar)

Detalhes em `.claude/rules/security.md`. Resumo: toda requisição que altera estado exige `Origin` exato + `X-Requested-With: chat`; o WebSocket valida `Origin` e sessão antes do upgrade; toda rota `/api` e `/media` exige sessão; dono ou admin é checado em todo acesso a recurso; imagens são validadas por magic bytes e re-codificadas para WebP; nada de SVG; rate limit em todo endpoint que escreve.

## Painéis "Local" (Claude Code do usuário)

Os 3 terminais decorativos têm a aba **Local** (`LocalPane` em `fake.js`): o painel mostra um comando de uma linha (`curl -k` de `/bridge.mjs` + conferência do SHA-256 calculado no navegador + `node`); o usuário o roda na própria máquina (precisa de Node 24 e do `claude`), cola o código `porta.token` no painel e conversa com o `claude` dele, **com permissão total** (`bypassPermissions`, decisão do projeto) na pasta onde a ponte foi iniciada. O navegador fala direto com `http://127.0.0.1:porta`; o servidor do chat não participa nem vê o conteúdo. A ponte só aceita o `Origin` do chat, exige o token e confere o `Host`; o prompt vai pelo stdin. A CSP ganhou `http://127.0.0.1:*` em `connect-src` só por isso. Safari bloqueia esse acesso (mixed content). `/bridge.mjs` é público de propósito (sem segredo; a integridade vem do hash). Testes: `test/bridge.mjs` (usa `test/fake-claude.mjs`).

## Armadilhas conhecidas

- `PUBLIC_ORIGIN`/`HOST_IP` no `.env` precisam ser o IP real de acesso. Se `HOST_IP` não bate com o IP usado no navegador, o Caddy responde 200 com corpo vazio (tela em branco).
- O cookie de sessão é `__Host-sid` com `Secure`: só funciona por HTTPS. Para testar à mão sem Caddy, use o `npm test`.
- O app confia em `X-Forwarded-For` (`trustProxy: true`) porque só o Caddy o alcança. Nunca publique a porta 3000 do app.
- `.env` contém segredos: não leia, imprima nem comite.
- O healthcheck da imagem de produção consulta `GET /`. Se mudar a rota raiz, ajuste `prod/Dockerfile`.
- Reiniciar produção derruba as conexões WebSocket (o cliente reconecta, recarrega o histórico e, se a versão do frontend mudou, recarrega a página sozinho ou mostra a faixa de nova versão). Páginas abertas antes de existir o `hello` precisam de Ctrl+F5 uma vez.
- Não há gerenciamento de usuários na UI: admin é por CLI (`/admin-users`). A primeira conta criada vira admin.

## Como trabalhar aqui

1. Antes de dar uma tarefa por pronta: `npm run check` e `npm test` (skill `/verify`).
2. Mudou rota, upload, auth ou algo exposto? Rode também `/security-audit` e acrescente casos ao `test/smoke.mjs`, inclusive o caso de ataque (outro usuário, sem sessão, `Origin` errado).
3. Não afirme que algo funciona na interface sem tê-lo visto rodar. O teste automatizado cobre API e WebSocket, não o frontend: diga explicitamente o que não foi verificado no navegador.
4. Não suba produção sem pedir ou sem o usuário ter pedido (`/deploy-prod`).
