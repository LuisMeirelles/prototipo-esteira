---
description: Convenções do servidor Node/Fastify.
paths:
  - "app/server/**"
---

# Backend

- Node 24 roda `.ts` direto (type stripping): sem `enum`, `namespace` nem parameter properties; imports locais terminam em `.ts`; tipos com `import type`. Rode `npm run check` depois de editar.
- `node:sqlite` é síncrono e do processo único: use `tx()` (BEGIN IMMEDIATE) para operações com várias escritas que precisam ser atômicas. `.get()/.all()` retornam `unknown`: converta com `as unknown as Tipo`.
- Todo SQL em `store.ts`/`db.ts`. As rotas em `api.ts` só validam, chamam o `store` e fazem `broadcast`. Não espalhe SQL pelas rotas.
- **Sem migrações automáticas.** Alterar tabela existente exige migração explícita e idempotente em `db.ts` (ex.: checar `PRAGMA table_info` e `ALTER TABLE`), porque produção tem dados reais. Colunas novas: `ADD COLUMN` com `DEFAULT`.
- Rota nova: use a skill `/add-endpoint`. Ordem fixa: autenticar → rate limit → validar entrada → autorizar sobre o recurso → agir → `broadcast` → responder.
- Mensagens vistas pelos clientes são sempre `MessageView` montada por `buildViews` (campos derivados como `mentions` são calculados lá, não gravados). Mudou o formato? Atualize `app/web/app.js` e `test/smoke.mjs`.
- Eventos WebSocket do servidor: `msg`, `edit`, `del`, `react`, `user`, `presence`, `typing`, `poll`, `pins` (lista completa de fixadas, reenviada ao fixar, desafixar, editar ou apagar uma fixada), `hello` (versão do frontend, enviada ao conectar: o cliente recarrega quando muda depois de reconectar). Evento novo exige tratar o `case` em `onWsMessage` (`app.js`).
- Erros: responder `{ error: 'codigo_curto' }` com o status certo (400/401/403/404/409/413/415/429). Nunca devolver stack ou mensagem de exceção ao cliente.
- Configuração só via `config.ts` (lê `process.env` uma vez e falha cedo se faltar algo obrigatório). Variável nova: documente em `.env.example`, nos dois `docker-compose.yml` e no `README.md`.
- Logs: pino padrão do Fastify. Nunca logar corpo de requisição, cookie, senha, token nem convite.
- Tarefas periódicas usam `setInterval(...).unref()` para não segurar o processo.
