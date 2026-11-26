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

Dev e prod podem rodar juntos: a produção publica em 80/443 e o dev em **8080/8443** (mude com `DEV_HTTP_PORT` e `DEV_HTTPS_PORT`). No dev o `PUBLIC_ORIGIN` é montado a partir de `HOST_IP` e da porta, então o valor do `.env` não é usado lá.

Acesse `https://SEU_IP` (no dev, `https://SEU_IP:8443`). O certificado é autoassinado, então cada pessoa vê um aviso na primeira vez. Para não ver o aviso, instale o certificado raiz do Caddy nas máquinas:

```bash
docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./caddy-root.crt
```

## Contas

- Para criar conta, a pessoa informa usuário, senha e o `INVITE_CODE`. Passe o código só para quem deve entrar.
- **A primeira conta criada vira admin.** O admin pode apagar mensagens de qualquer pessoa e encerrar ou remover a enquete de qualquer pessoa.
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

## Comandos

Digite `/` na caixa de texto para ver a lista: `/img` (anexar imagem), `/enquete`, `/camuflagem`, `/perfil`, `/notif` e `/sair`.

## Menções, emoji e notificações

- **Menções:** digite `@` e escolha uma pessoa na lista, ou escreva `@usuario` (o mesmo usuário do login). `@todos` avisa a sala inteira. A mensagem fica destacada para quem foi mencionado.
- **Emoji:** digite `:` e o nome, sem espaços (por exemplo `:fire`), para abrir a lista a partir de 2 letras. Navegue com as setas e insira com Enter, Tab ou clique. Fechar com `:fire:` insere direto quando o nome é exato (ou um apelido que só um emoji tem). Os nomes são em inglês, no padrão do Slack/GitHub (`:joy:`, `:thumbsup:`, `:heart_eyes:`).
- **Notificações:** `/notif` alterna entre todas as mensagens, só menções e desligadas (e, na primeira vez, pede permissão ao navegador). Som e notificação do sistema só disparam com a aba em segundo plano ou a janela sem foco; o contador de não vistas é descrito em "Mensagens não vistas".
- **Notificação do navegador e certificado autoassinado:** alguns navegadores bloqueiam notificações em sites com certificado não confiável. Se isso acontecer, instale o certificado raiz do Caddy (comando na seção "Rodar"). O som e o contador na aba funcionam mesmo assim.

## Enquete

- `/enquete` abre o formulário: uma pergunta (até 140 caracteres) e de 2 a 4 opções diferentes (até 60). Qualquer pessoa cria, mas só existe **uma enquete aberta por vez**.
- Enquanto existe uma, aparece a aba "enquete" ao lado de "Local" (com um `●` se você ainda não votou). Clique na opção ou aperte 1 a 4 para votar; o voto é público e pode ser trocado até o encerramento.
- Só quem criou ou o admin encerra. O resultado aparece para todos (a aba de cada um abre sozinha), com o vencedor destacado, e ninguém mais vota. Depois, quem criou ou o admin pode remover a enquete encerrada; criar outra também a substitui.
- Limites: 3 criações a cada 10 minutos por pessoa, 30 votos por minuto.

## Camuflagem

`/camuflagem` liga ou desliga. Ligada, quando o mouse sai do painel do chat ele é coberto por uma sessão decorativa igual aos outros três terminais, e o chat volta quando o mouse volta (inclusive ao sair da janela do navegador). Fica ligada por padrão e a preferência é guardada no navegador de cada pessoa. Só vale com mouse e em telas acima de 760px; em telas de toque ou estreitas não há outros terminais para imitar.

## Mensagens não vistas

- Conta como não vista a mensagem de outra pessoa que chega com a guia oculta, a janela sem foco, o chat camuflado ou a aba de enquete aberta. Também entram as que chegaram com a conexão fora do ar (até as últimas 50).
- Onde aparece: título da guia (`(3) protótipo esteira`, `(@3)` com menção), bolinha no favicon e uma pílula sobre o painel camuflado.
- Dentro do chat, uma linha `── novas mensagens ──` marca a primeira não vista e a rolagem vai até ela quando você volta. A linha some quando você envia uma mensagem ou chega outra leva de não vistas.
- Chat coberto sozinho (guia visível e com foco) não toca som nem dispara notificação do sistema.

## Atualização automática

Ao conectar, o servidor envia a versão do frontend (hash dos arquivos web). Depois de um deploy, a página reconecta, vê a versão nova e recarrega sozinha. Com texto digitado, imagem anexada ou janela aberta, mostra a faixa "nova versão disponível" em vez de recarregar. Deploy só de servidor não muda a versão e não recarrega ninguém.

## Segurança (resumo)

- Senhas com scrypt (salt por usuário). O login leva o mesmo tempo para usuário existente e inexistente e tem limite por IP e por conta.
- Cadastro protegido por convite e com limite por IP.
- Sessão em cookie `__Host-` `HttpOnly` `Secure` `SameSite=Lax`, guardada como hash no banco.
- Anti-CSRF: `Origin` exato + cabeçalho `X-Requested-With`; WebSocket valida `Origin` e sessão antes do upgrade.
- Conteúdo de usuário nunca vai para `innerHTML`; CSP estrita, sem script/estilo inline.
- Imagens: validadas por magic bytes e re-codificadas para WebP (remove EXIF e payloads). SVG é recusado e o limite é 6 MB.
- Nomes de exibição: só letras latinas, números e pontuação simples, e únicos, para ninguém se passar por outra pessoa.
- Reações: um único emoji (um grafema), até 3 por pessoa e 12 emojis diferentes por mensagem.
- Rate limit por IP e por usuário. Prod roda como não-root, com filesystem read-only, sem capabilities e sem porta do app exposta.

Backup: o banco e as imagens ficam no volume `chat_data` (`/data`).
