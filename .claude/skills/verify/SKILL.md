---
name: verify
description: Verifica o projeto do chat antes de dar uma tarefa por concluída (typecheck, testes de integração e build de produção). Use depois de qualquer mudança em app/ ou antes de commitar.
---

# Verificar o chat

Rode em `app/` e pare no primeiro problema real:

1. `npm run check` — typecheck. Corrija erros de tipo na origem, sem `any` nem `@ts-ignore` para silenciar.
2. `npm test` — sobe servidor e banco descartáveis e roda `test/smoke.mjs`. Precisa terminar em `TUDO OK`. Em falha, leia qual `FAIL` apareceu, entenda se o código ou a expectativa está errado e corrija o código; não afrouxe a asserção nem o controle de segurança.
3. `npm run build` — só se mexeu em `server/`, `web/` ou `build.mjs`. O bundle de produção pode quebrar mesmo com o dev passando (imports, dependências nativas, regex do hash dos arquivos).

Depois confira o que os testes **não** cobrem:

- Mudou `app/web/`? O teste não toca na interface. Se conseguir abrir um navegador, veja a tela (login, enviar mensagem, spoiler de imagem, `/emoji`, `@`). Se não conseguir, diga claramente que o frontend não foi verificado visualmente. Não peça ao usuário para confiar.
- Mudou Docker/Caddy? Isso só se valida subindo os containers: use `/deploy-prod` (só com o usuário pedindo).
- Mudou algo de segurança? Rode também `/security-audit`.

Relate no final: o que passou, o que falhou, o que **não** foi verificado.
