---
name: admin-users
description: Administra usuários do chat pela CLI do servidor (listar, redefinir senha, promover ou rebaixar admin). Use quando alguém esquecer a senha ou o usuário pedir para mudar quem é admin.
---

# Administrar usuários

Não há gerenciamento de usuários na UI. A CLI roda dentro do container e mexe direto no banco. A **primeira conta criada vira admin**.

## Comandos (produção, dentro de `prod/`)

```bash
CLI="docker compose --env-file ../.env exec app node --disable-warning=ExperimentalWarning cli.mjs"
$CLI list                       # usuário, nome de exibição e (admin)
$CLI reset-password fulano      # gera senha temporária e derruba as sessões
$CLI promote fulano             # torna admin
$CLI demote fulano              # remove admin
```

Em desenvolvimento (`dev/`), troque `cli.mjs` por `server/cli.ts`.

## Cuidados

- `reset-password` imprime a senha temporária no terminal: repasse só para quem pediu e peça que troque no perfil (Perfil → Trocar senha). Não grave essa senha em arquivo, commit nem mensagem pública.
- O argumento é o **usuário de login** (minúsculo), não o nome de exibição.
- Antes de `demote`, confirme que sobra ao menos um admin (`list`).
- Para trocar o código de convite: edite `INVITE_CODE` no `.env` (o usuário faz isso; não edite o `.env` por conta própria) e rode `docker compose --env-file ../.env up -d`. Contas existentes não são afetadas.
- Apagar conta não é suportado de propósito (as mensagens referenciam o usuário).
