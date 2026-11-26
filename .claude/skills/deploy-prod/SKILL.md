---
name: deploy-prod
description: Reconstrói e reinicia o chat em produção com Docker e confere se subiu saudável. Use quando o usuário pedir para reiniciar o servidor, aplicar mudanças em produção ou subir uma nova versão.
disable-model-invocation: true
---

# Deploy em produção

Reiniciar derruba as conexões WebSocket de quem está online (os clientes reconectam sozinhos). Só execute quando o usuário pediu.

1. Antes de subir: em `app/`, rode `npm run check && npm test && npm run build`. Não suba se algo falhar.
2. Em `prod/`:
   ```bash
   docker compose --env-file ../.env up -d --build
   ```
   O `--env-file ../.env` é obrigatório. Não leia nem imprima o `.env`. Se o compose reclamar de variável obrigatória faltando, diga qual ao usuário em vez de inventar valor.
3. Espere uns segundos e confira:
   ```bash
   docker compose --env-file ../.env ps --format '{{.Service}} {{.Status}}'
   docker compose --env-file ../.env logs app --tail 30
   docker compose --env-file ../.env exec -T app node -e "fetch('http://127.0.0.1:3000/').then(r=>console.log(r.status))"
   ```
   O `app` deve aparecer `(healthy)` e responder 200. Procure erros nos logs (`"level":50`).
4. Relate o resultado. Se o frontend mudou, as páginas abertas recarregam sozinhas (aviso de versão pelo WebSocket); quem tiver rascunho vê a faixa "nova versão disponível". Ctrl+F5 só é preciso para quem estava com uma página anterior ao `hello`.

## Se algo der errado

- **Tela em branco no navegador, mas o app saudável:** `HOST_IP`/`PUBLIC_ORIGIN` do `.env` diferem do IP usado no navegador. O Caddy responde 200 vazio. Peça ao usuário para corrigir o `.env` e subir de novo.
- **`app` reiniciando:** veja `logs app`. Causa comum: variável obrigatória ausente (`INVITE_CODE`, `PUBLIC_ORIGIN`).
- **`unhealthy`:** o healthcheck consulta `GET /` dentro do container; veja o `HEALTHCHECK` em `prod/Dockerfile`.
- **Porta 80/443 ocupada:** outro serviço está nela (o `dev/` usa 8080/8443 e não colide). Veja quem com `ss -ltnp | grep -E ':(80|443)\b'` e peça ao usuário antes de parar qualquer coisa.

## Nunca

- `docker compose down -v` em produção (apaga o banco de mensagens e a CA do Caddy).
- Expor a porta 3000 do `app`.
- Editar `.env` por conta própria.
