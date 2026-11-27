---
name: security-audit
description: Auditoria de segurança específica do chat interno (rede hostil). Use depois de mudar autenticação, upload, rotas, WebSocket, CSP, Docker ou frontend que renderiza texto de usuário.
---

# Auditoria de segurança do chat

Ameaça: usuário da mesma rede tentando invadir, se passar por outro, injetar script, derrubar o servidor ou ler o que não deve. Revise o diff (ou o projeto) contra esta lista e **cite arquivo:linha** de cada achado; não afirme problema sem ler o código.

## 1. Entrada → saída (XSS)
- `grep -rnE "innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function|setAttribute\('(style|on)" app/web` deve voltar vazio. Hoje o único acerto é o comentário na linha 1 de `md.js`; qualquer outro precisa ser conteúdo estático, nunca dado de usuário.
- Todo dado de usuário (nome, mensagem, snippet de resposta, menção) chega ao DOM por `textContent`/`createElement`/`renderMarkdown`. Links só `http(s)` e `rel="noopener noreferrer nofollow"`.
- CSP em `server/index.ts` continua sem `unsafe-inline`/`unsafe-eval` e com `default-src 'none'`.

## 2. Requisições e sessão
- O hook de `onRequest` em `index.ts` ainda exige `Origin` exato + `X-Requested-With` para não-GET e checa `Origin`+sessão em `/ws`.
- Toda rota de `api.ts` começa com `me()`; `/media/:id` exige sessão e respeita mídia pendente (só do dono).
- Cookie `__Host-sid` com `HttpOnly`, `Secure`, `SameSite=Lax`. Token só como hash no banco. Nova sessão a cada login; troca de senha derruba as outras.

## 3. Autorização
- Cada rota que muda recurso valida dono/admin. Edição é só do dono. Nenhuma confiança em IDs do corpo sem checar quem é o dono.

## 4. Injeção e validação
- SQL só parametrizado (procure `${` dentro de `prepare(`: só `MSG_COLS`, `USER_COLS` e `ph()` são aceitáveis).
- IDs validados por regex; tamanhos limitados (`cleanBody`, `cleanName`, `bodyLimit`, `maxPayload`).

## 5. Upload
- Magic bytes (`sniff`), re-encode WebP, limite de bytes e pixels, nome gerado no servidor, `Content-Type` fixo e `nosniff` na resposta, sem SVG. Mídia servida com `content-security-policy: default-src 'none'; sandbox`.

## 6. Abuso
- Rate limit em todo endpoint que escreve e nos de `/auth`; limites de conexões WS por usuário; `scrypt` limitado por semáforo; mensagens de erro de login iguais para usuário existente e inexistente.

## 7. Segredos e containers
- Nada de segredo em código, Dockerfile, compose ou logs. `.env` fora do git (`.gitignore`) e do contexto de build (`app/.dockerignore`).
- `prod/docker-compose.yml`: `read_only`, `cap_drop: ALL`, `no-new-privileges`, usuário não-root na imagem, `app` sem `ports`. Caddy é o único que publica portas.

## 8. Ponte local e terminal (aba Local)
- `app/web/bridge.mjs`: só `GET /health` e `POST /tty/*`; nada de rota que execute comando, leia arquivo ou liste pasta; `spawn` sem shell e com programa fixo; `Origin`, `Host` e token conferidos antes de qualquer rota; tamanhos e números validados (`MAX_BODY`, `MAX_INPUT`, `dim()`); limite de terminais; o `claude` morre quando a conexão fecha.
- `app/web/vendor/xterm.mjs`: não carregar addons de clipboard/links; o patch `__xtStyle` continua o único desvio do original; a CSP não ganhou `unsafe-inline`.
- `connect-src` só com `'self'`, `wss://host` e `http://127.0.0.1:*`.
- `test/bridge.mjs` cobre 401/403/404/400/429 da ponte; confirme que continua passando.

## 9. Teste dinâmico
Rode `npm test` em `app/` e confirme que os casos de ataque do `test/smoke.mjs` seguem passando. Para controle novo, escreva o caso de ataque primeiro.

## Entrega
Liste achados por severidade (crítico/alto/médio/baixo), cada um com arquivo:linha, cenário de ataque concreto e correção sugerida. Diga também o que **não** foi possível verificar (ex.: comportamento no navegador ou nos containers).
