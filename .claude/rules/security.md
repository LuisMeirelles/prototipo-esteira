---
description: Invariantes de segurança do chat. Vale para todo código do servidor e do frontend.
paths:
  - "app/**"
  - "prod/**"
  - "dev/**"
---

# Segurança

O modelo de ameaça é um colega da mesma rede tentando invadir. Qualquer alteração em `app/` deve preservar:

## Requisições
- Toda requisição que não é `GET`/`HEAD` passa pelo hook em `server/index.ts` que exige `Origin === PUBLIC_ORIGIN` e `X-Requested-With: chat`. Nunca crie exceção, nem para login.
- O WebSocket (`/ws`) valida `Origin` e sessão **antes** do upgrade. O único evento aceito do cliente é `typing`; frames têm no máximo 1 KB. Não adicione eventos cliente→servidor que alterem estado: use REST (com validação e rate limit).
- Toda rota `/api/*` e `/media/*` chama `me()` e devolve 401 sem sessão. Rota nova pública é exceção que precisa de justificativa explícita (hoje só `/auth/*` e arquivos estáticos).

## Autorização
- Operação sobre recurso de alguém valida dono (`m.user_id === u.id`) ou admin (`u.is_admin === 1`). Editar mensagem é **só do dono**, nem admin edita.
- Mídia ainda não anexada só é visível para quem enviou; anexar mídia exige ser dono e não ter sido usada.
- Fixar mensagem é permitido a qualquer usuário autenticado (decisão do projeto), com limite de 5 fixadas e rate limit; fixar mensagem inexistente ou apagada dá 404.
- Enquete: criar exige sessão; encerrar e remover são só do criador ou admin (403 para os outros). Votar em enquete encerrada devolve 409 e remover uma aberta também (409).
- IDs vindos de URL/corpo passam por regex (`ID_RE`, `MEDIA_RE`) antes de tocar no banco.

## Entradas
- Texto: `cleanBody` (limite de tamanho, remove controles e caracteres bidi). Nome de exibição: `cleanName` (só letras latinas, números e pontuação simples) e único (`name_key`) para impedir se passar por outra pessoa.
- Texto de enquete passa por `cleanLine` (uma linha, sem controles nem bidi; pergunta até 140, opção até 60, 2 a 4 opções distintas). Reação é um único grafema emoji, até 3 por usuário e 12 distintos por mensagem.
- Imagens: magic bytes + re-encode WebP com `sharp` (remove EXIF e payload). Nunca confiar em `Content-Type`/extensão. Sem SVG. Limite de 6 MB e de pixels. Nome do arquivo gerado no servidor.
- SQL sempre com `?`; nunca concatene valor de usuário em SQL (listas de `IN` usam placeholders gerados, ver `ph()` em `store.ts`).

## Ponte local (`app/web/bridge.mjs`, roda na máquina do usuário)
- Só existem `GET /health` e `POST /tty/start|input|resize|stop`. **Não adicione** rota que execute comando escolhido pelo navegador, leia arquivo ou liste pasta (já houve `/shell`, `/chat`, `/complete` e leitura de conversas; foram removidas de propósito). O programa executado é fixo (`claude`), sem shell.
- Toda requisição exige `Origin` exato, `Host` de loopback e token (`timingSafeEqual`); entradas numéricas e tamanhos são validados; no máximo 3 terminais.
- `/bridge.mjs` é público de propósito e o chat é a raiz de confiança dela (quem controla o servidor controla o arquivo que os usuários rodam). Não deixe esse arquivo em caminho gravável pelo app em produção.
- O token fica no `sessionStorage`, então um XSS no chat vira terminal na máquina do usuário: as regras de saída abaixo valem em dobro. Não carregue addons do xterm (clipboard, links) sem revisar.

## Saída (frontend)
- Dado de usuário vai por `textContent`/`createElement`/`renderMarkdown` (que só cria nós DOM). Proibido `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, `new Function`, `setAttribute('style'|'on*', ...)`.
- Links só `http(s)`, com `rel="noopener noreferrer nofollow"`. O Markdown não tem `[texto](url)` de propósito, para o destino do link ser sempre o que aparece escrito.
- A CSP (`server/index.ts`) é estrita: sem inline, `img-src 'self' blob:`. Não afrouxe para resolver um problema de frontend; resolva o frontend.

## Sessão e senha
- Senha: scrypt (`password.ts`), nunca logar nem retornar. Login leva o mesmo tempo para usuário existente e inexistente (`DUMMY_HASH`) e responde sempre `invalid_credentials`.
- Sessão: token aleatório, só o hash fica no banco, cookie `__Host-sid` `HttpOnly` `Secure` `SameSite=Lax`. Trocar senha derruba as outras sessões. Nova sessão a cada login.
- Limites de taxa (`limits.ts#allow`) em todo endpoint que escreve, por usuário, e por IP nos de `/auth`.

## Containers
- Produção: não-root, `read_only`, `cap_drop: ALL`, `no-new-privileges`, sem `ports` no serviço `app`. Só o Caddy publica porta. Não adicione volumes de escrita além de `/data`.
- Segredos só via `.env` (fora do git e do contexto de build). Nunca em Dockerfile, compose ou código.

Mudou algo aqui? Acrescente o teste de ataque correspondente em `app/test/smoke.mjs`.
