---
description: Convenções do frontend em JS puro.
paths:
  - "app/web/**"
---

# Frontend

- Sem framework e sem dependências no navegador (única exceção: o xterm.js copiado e remendado em `web/vendor/`, usado só pela aba TTY; veja `CLAUDE.md`). Módulos ES nativos (`app.js` importa `md.js` e `emojis.js`); em produção o esbuild junta e minifica. Não use APIs que exijam bundler (imports de `node_modules`, JSX, TypeScript).
- Construa DOM com os helpers `h(tag, classe, texto)` e `$(id)` de `app.js`. **Nunca** `innerHTML` com dado de usuário (nome, mensagem, snippet de resposta, nome de arquivo). Veja `.claude/rules/security.md`.
- CSP bloqueia estilo e script inline: nada de `style="..."` no HTML nem `onclick=`. Estilo dinâmico só por `el.style.prop = valor`. Novo `id` usado em `app.js` precisa existir em `index.html` (um `$()` nulo no topo do módulo derruba a página inteira em branco).
- Cores via variáveis CSS de `style.css` (`--bg`, `--bg2`, `--line`, `--orange`, `--red`...). O tema é um só, escuro, no estilo de terminal de agente de código. Não hardcode cor fora dessas variáveis.
- Layout: grade 2×2. O chat é o único painel real; os outros três são terminais decorativos (`fake.js`), só no navegador e sem requisições ao servidor do chat (a aba **Local** fala só com a ponte em `127.0.0.1`, veja `CLAUDE.md`). Abaixo de 760px aparece só o chat. Mantenha acessível: `button` para ação clicável, `aria-label` em botões só de ícone, foco visível.
- Camuflagem: a sessão fake que cobre o chat (`#camo`) é mostrada e escondida sempre por `cover()`. Contador de não vistas, favicon, pílula e linha `novas mensagens` dependem de `watching()`: ao mexer neles, preserve que só zera quando o chat está de fato à vista.
- Aviso de deploy: `hello` guarda a versão da página e `onServerVersion` mostra a faixa "nova versão disponível" quando muda depois de reconectar. Nunca recarrega sozinho (o painel Local e rascunhos não podem ser interrompidos).
- Imagens enviadas são **sempre spoiler** (borradas até o clique); depois de revelada, o clique abre o lightbox. Não mostre imagem de mensagem sem esse envoltório.
- Mensagens: o servidor é a fonte da verdade. Ações (enviar, editar, reagir, apagar) chamam a API e a UI atualiza pelos eventos do WebSocket, sem atualização otimista que possa divergir.
- Texto da interface em português do Brasil. Mensagens de erro mapeadas por código em `ERRORS`/`AUTH_ERRORS`.
- Markdown: ao estender `md.js`, só crie nós por `createElement`/`textContent`, valide protocolo de link e mantenha o limite de profundidade da recursão. Menções recebem a lista resolvida pelo servidor (`m.mentions`); o cliente não adivinha quem existe.
- `:nome` (emoji), `/` (comandos) e `@` são sugestões acima da caixa (`updateSuggest`/`suggestKey`). O texto de ajuda fica no `.hint` abaixo da caixa: se criar um atalho ou comando novo, documente lá.
- Depois de mudar o frontend, **olhe no navegador**: o teste automatizado não cobre a interface. Se não puder abrir, diga que não verificou.
