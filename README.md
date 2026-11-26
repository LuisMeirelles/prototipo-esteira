# Chat

Chat em grupo para a rede interna. Uma única sala, contas próprias e imagens em spoiler.

- **Backend:** Node 24 + Fastify + WebSocket + SQLite (`node:sqlite`), sem ORM.
- **Frontend:** HTML/CSS/JS puro, sem framework.
- **Proxy:** Caddy com HTTPS autoassinado direto no IP.

```
app/    código-fonte (server/ e web/)
dev/    docker compose de desenvolvimento (sem build, recarrega ao salvar)
prod/   docker compose de produção (build otimizado, container endurecido)
```

## Configurar

```bash
cp .env.example .env
# edite: HOST_IP, PUBLIC_ORIGIN e INVITE_CODE (ex.: openssl rand -base64 18)
```

O `.env` fica fora do git e nunca entra nas imagens.

## Rodar

Produção:

```bash
cd prod && docker compose --env-file ../.env up -d --build
```

Desenvolvimento (código montado por volume, `node --watch`):

```bash
cd dev && docker compose --env-file ../.env up --build
```

Dev e prod usam as mesmas portas (80/443), então rode só um por vez.

Acesse `https://SEU_IP`. O certificado é autoassinado, então cada pessoa vê um aviso na primeira vez. Para não ver o aviso, instale o certificado raiz do Caddy nas máquinas:

```bash
docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./caddy-root.crt
```

## Contas

- Para criar conta, a pessoa informa usuário, senha e o `INVITE_CODE`. Passe o código só para quem deve entrar.
- **A primeira conta criada vira admin.** O admin pode apagar mensagens de qualquer pessoa.
- Usuário (login): 3 a 24 caracteres, só `a-z 0-9 . _ -`. Senha: 8 a 128 caracteres.
- Cada pessoa troca nome de exibição, foto e senha no próprio perfil. Trocar a senha desconecta os outros dispositivos.

### Administração (comandos no servidor)

```bash
# produção
docker compose exec app node --disable-warning=ExperimentalWarning cli.mjs list
docker compose exec app node --disable-warning=ExperimentalWarning cli.mjs reset-password fulano
docker compose exec app node --disable-warning=ExperimentalWarning cli.mjs promote fulano
docker compose exec app node --disable-warning=ExperimentalWarning cli.mjs demote fulano

# desenvolvimento: troque "cli.mjs" por "server/cli.ts"
```

`reset-password` gera uma senha temporária, mostra no terminal e encerra as sessões da pessoa.

Para trocar o `INVITE_CODE`, edite o `.env` e rode `docker compose up -d`. Quem já tem conta não é afetado.

## Menções, emoji e notificações

- **Menções:** digite `@` e escolha uma pessoa na lista, ou escreva `@usuario` (o mesmo usuário do login). `@todos` avisa a sala inteira. A mensagem fica destacada para quem foi mencionado.
- **Emoji:** digite `/emoji` na caixa de texto para abrir o seletor. Dá para filtrar, por exemplo `/emoji coração`, navegar com as setas e inserir com Enter ou clique.
- **Notificações:** o sino 🔔 no menu lateral alterna entre todas as mensagens, só menções e desligadas. Elas avisam com som, contador no título da aba (`(@2) Chat` quando há menção) e notificação do navegador. Só disparam quando a aba está em segundo plano. No primeiro clique o navegador pede permissão.
- **Notificação do navegador e certificado autoassinado:** alguns navegadores bloqueiam notificações em sites com certificado não confiável. Se isso acontecer, instale o certificado raiz do Caddy (comando na seção "Rodar"). O som e o contador na aba funcionam mesmo assim.

## Segurança (resumo)

- Senhas com scrypt (salt por usuário). O login leva o mesmo tempo para usuário existente e inexistente e tem limite por IP e por conta.
- Cadastro protegido por convite e com limite por IP.
- Sessão em cookie `__Host-` `HttpOnly` `Secure` `SameSite=Lax`, guardada como hash no banco.
- Anti-CSRF: `Origin` exato + cabeçalho `X-Requested-With`; WebSocket valida `Origin` e sessão antes do upgrade.
- Conteúdo de usuário nunca vai para `innerHTML`; CSP estrita, sem script/estilo inline.
- Imagens: validadas por magic bytes e re-codificadas para WebP (remove EXIF e payloads). SVG é recusado e o limite é 6 MB.
- Nomes de exibição: só letras latinas, números e pontuação simples, e únicos, para ninguém se passar por outra pessoa.
- Rate limit por IP e por usuário. Prod roda como não-root, com filesystem read-only, sem capabilities e sem porta do app exposta.

Backup: o banco e as imagens ficam no volume `chat_data` (`/data`).
