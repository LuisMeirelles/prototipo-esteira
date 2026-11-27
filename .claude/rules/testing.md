---
description: Como testar mudanças neste projeto.
paths:
  - "app/test/**"
  - "app/server/**"
  - "app/web/**"
---

# Testes

- `npm test` (em `app/`) sobe o servidor em porta livre com banco temporário, roda `test/smoke.mjs`, depois `test/bridge.mjs` (a ponte local, com `test/fake-claude.mjs` num pty real; precisa de `python3`) e apaga tudo. Não precisa de Docker nem de `.env`. Termina com `TUDO OK` ou `N FALHAS` e o código de saída reflete isso.
- O teste cobre API, WebSocket, autenticação, autorização, CSRF, upload e limites. **Não cobre a interface**: veja o frontend no navegador antes de dizer que funciona.
- Todo comportamento novo ganha asserções em `test/smoke.mjs` (`ok(condição, 'descrição')`), e todo controle de segurança novo ganha o caso de ataque: sem sessão (401), outro usuário (403), `Origin` errado (403), entrada inválida (400), abuso (429).
- Os limites de taxa são por IP; o teste varia o IP com o cabeçalho `x-forwarded-for` (o app tem `trustProxy`) para não esbarrar no limite de cadastro. Use o parâmetro `ip` de `req()` ao criar muitos usuários.
- Quem escreve teste novo não deve depender da ordem de mensagens de outros trechos: crie os próprios dados.
- Para ver o frontend de verdade (a aba Local, por exemplo), dá para subir um servidor estático que sirva `app/web` com a mesma CSP do chat e dirigir o Chrome headless (`google-chrome --headless=new --remote-debugging-port=...`) por CDP, com teclas reais; use `CLAUDE_BIN=bash` na ponte para ter um terminal de teste. Não confunda com o `claude` real: ele ainda precisa de uma passada manual.
- Falha de teste não se resolve afrouxando a asserção nem o controle de segurança: corrija o código, ou explique por que a expectativa mudou.
- Antes de concluir: `npm run check` e `npm test`. Para produção, também `npm run build` (o bundle pode quebrar mesmo com o dev passando) e, se o Docker mudou, subir e olhar `docker compose ps` / logs.
