---
name: add-endpoint
description: Checklist para criar ou alterar uma rota da API do chat (REST ou evento WebSocket) sem abrir brechas. Use ao adicionar funcionalidade que o cliente aciona no servidor.
---

# Adicionar um endpoint

Rotas ficam em `app/server/api.ts` (autenticadas) ou `auth.ts` (sem sessão). SQL fica em `store.ts`.

## Passos

1. **Contrato.** Defina método, caminho, corpo, resposta e códigos de erro. Mutação é `POST/PUT/PATCH/DELETE` (o hook de CSRF em `index.ts` já cobre todas); leitura é `GET`.
2. **Autenticar:** `const u = me(req, reply); if (!u) return;` como primeira linha.
3. **Rate limit:** `if (!allow('chave:' + u.id, max, janelaMs)) return limited(reply);` com chave própria por ação. Endpoint de `/auth` limita também por IP.
4. **Validar toda entrada** antes de usá-la: tipo, tamanho, regex de ID (`ID_RE`/`MEDIA_RE`), lista de valores permitidos. Texto livre passa por `cleanBody`; nome por `cleanName`. Rejeite com `bad(reply, 'codigo_curto')`.
5. **Autorizar sobre o recurso:** o dono é quem pode? admin também? Compare `user_id` do recurso com `u.id`. Recurso inexistente e recurso de outro respondem de forma que não vaze existência quando importar (404).
6. **Agir via `store.ts`:** função nova lá, com SQL parametrizado; várias escritas dentro de `tx()`.
7. **Notificar:** se outros clientes precisam ver, `broadcast({ t: '...', ... })` e trate o evento em `onWsMessage` (`app.js`). O cliente que agiu também atualiza pelo evento, não por estado otimista.
8. **Responder** `{ ok: true }` ou o recurso. Erros inesperados deixam o `setErrorHandler` responder 500 genérico; não devolva `e.message`.
9. **Frontend:** função em `app.js` usando `api(...)`; mensagem de erro por código em `ERRORS`. Se for upload, use `application/octet-stream` e passe por `processImage`.
10. **Teste** em `app/test/smoke.mjs`: caminho feliz **e** ataque (sem sessão → 401, outro usuário → 403, `Origin` errado → 403, entrada inválida → 400, flood → 429).
11. **Documente** em `README.md` se for visível ao usuário e rode `/verify`.

## Evento WebSocket cliente→servidor

Evite. Hoje só `typing` é aceito. Se realmente precisar, valide `t`, limite a taxa por conexão (como `lastTyping` em `hub.ts`) e nunca confie em `userId` vindo do cliente: use o da conexão.
