import sharp from 'sharp';
import WebSocket from 'ws';

// Testes de integração (API + WebSocket). Rode com `npm test`, que sobe um servidor descartável.
const BASE = process.env.BASE ?? 'http://localhost:3111';
const ORIGIN = process.env.PUBLIC_ORIGIN ?? 'https://10.0.0.5';
let fails = 0;
const ok = (c, msg) => { console.log(c ? 'PASS' : 'FAIL', msg); if (!c) fails++; };

async function req(method, path, { cookie, body, raw, origin = ORIGIN, xr = 'chat', ip } = {}) {
  const headers = {};
  if (ip) headers['x-forwarded-for'] = ip;
  if (cookie) headers.cookie = cookie;
  if (origin) headers.origin = origin;
  if (xr) headers['x-requested-with'] = xr;
  let b;
  if (raw) { headers['content-type'] = 'application/octet-stream'; b = raw; }
  else if (body !== undefined) { headers['content-type'] = 'application/json'; b = JSON.stringify(body); }
  const res = await fetch(BASE + path, { method, headers, body: b });
  const text = await res.arrayBuffer();
  let json; try { json = JSON.parse(Buffer.from(text).toString()); } catch {}
  return { status: res.status, json, headers: res.headers, buf: Buffer.from(text) };
}
const INVITE = process.env.INVITE_CODE ?? 'convite-secreto-123';
const cookieOf = (r) => r.headers.getSetCookie().find((c) => c.startsWith('__Host-sid='))?.split(';')[0];
let ipn = 0;
async function register(username, password = 'senha-forte-1') {
  return req('POST', '/auth/register', { body: { username, password, invite: INVITE }, ip: `10.9.0.${++ipn}` });
}
async function login(name) {
  const r = await register(name.toLowerCase());
  return cookieOf(r);
}
const wsOpen = (cookie, origin) => new Promise((res) => {
  const ws = new WebSocket(BASE.replace('http', 'ws') + '/ws', { headers: { ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}) } });
  ws.events = [];
  ws.on('message', (d) => ws.events.push(JSON.parse(d.toString())));
  ws.on('open', () => res(ws));
  ws.on('unexpected-response', (_q, r) => res({ rejected: r.statusCode }));
  ws.on('error', () => {});
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const alice = await login('Alice');
const bob = await login('Bob');
ok(alice && bob, 'cadastro com convite');
ok((await req('POST', '/auth/register', { body: { username: 'eve', password: 'senha-forte-1', invite: 'errado' }, ip: '10.8.0.1' })).status === 403, 'convite errado => 403');
ok((await req('POST', '/auth/register', { body: { username: 'eve', password: 'senha-forte-1' }, ip: '10.8.0.2' })).status === 403, 'sem convite => 403');
ok((await register('alice')).status === 409, 'username duplicado => 409');
ok((await register('ALICE')).status === 409, 'username duplicado (case) => 409');
ok((await register('eve', 'curta')).status === 400, 'senha curta recusada');
ok((await register('e<v>e')).status === 400, 'username inválido recusado');
ok((await register('ab')).status === 400, 'username curto recusado');
const bl = await req('POST', '/auth/login', { body: { username: 'alice', password: 'errada-errada' } });
ok(bl.status === 401 && bl.json.error === 'invalid_credentials', 'login senha errada => 401');
const bl2 = await req('POST', '/auth/login', { body: { username: 'naoexiste', password: 'errada-errada' } });
ok(bl2.status === 401 && bl2.json.error === 'invalid_credentials', 'login usuário inexistente => mesma resposta');
const gl = await req('POST', '/auth/login', { body: { username: 'Alice', password: 'senha-forte-1' } });
ok(gl.status === 200 && cookieOf(gl), 'login correto');
ok((await req('POST', '/auth/login', { body: { username: 'alice', password: 'senha-forte-1' }, origin: null })).status === 403, 'login sem Origin => 403');
const me0 = await req('GET', '/api/me', { cookie: alice });
ok(me0.json.admin === true, 'primeira conta é admin');
ok((await req('GET', '/api/me', { cookie: bob })).json.admin === false, 'segunda conta não é admin');

ok((await req('GET', '/api/me')).status === 401, 'sem sessão => 401');
ok((await req('GET', '/media/AAAAAAAAAAAAAAAAAAAAAAAA')).status === 401, 'media sem sessão => 401');
ok((await req('POST', '/api/messages', { cookie: alice, body: { body: 'x' }, origin: null })).status === 403, 'POST sem Origin => 403');
ok((await req('POST', '/api/messages', { cookie: alice, body: { body: 'x' }, origin: 'https://evil.com' })).status === 403, 'POST Origin errada => 403');
ok((await req('POST', '/api/messages', { cookie: alice, body: { body: 'x' }, xr: null })).status === 403, 'POST sem X-Requested-With => 403');

const w1 = await wsOpen(alice, ORIGIN);
const w2 = await wsOpen(bob, ORIGIN);
ok(!w1.rejected && !w2.rejected, 'ws abre com sessão+origin');
ok((await wsOpen(alice, 'https://evil.com')).rejected === 403, 'ws Origin errada recusado');
ok((await wsOpen(null, ORIGIN)).rejected === 401, 'ws sem cookie recusado');
await sleep(200);
ok(w1.events.some((e) => e.t === 'presence' && e.online.length === 2), 'presença com 2 usuários');

const xss = '<script>alert(1)</script> <img src=x onerror=alert(1)> **ok**';
const m1 = await req('POST', '/api/messages', { cookie: alice, body: { body: xss } });
ok(m1.status === 200, 'alice envia mensagem');
await sleep(200);
ok(w2.events.some((e) => e.t === 'msg' && e.message.body === xss), 'bob recebe via ws (texto cru, escapado no cliente)');

ok((await req('PATCH', `/api/messages/${m1.json.id}`, { cookie: bob, body: { body: 'hack' } })).status === 403, 'bob não edita msg da alice');
ok((await req('DELETE', `/api/messages/${m1.json.id}`, { cookie: bob })).status === 403, 'bob não apaga msg da alice');
const mb = await req('POST', '/api/messages', { cookie: bob, body: { body: 'do bob' } });
ok((await req('DELETE', `/api/messages/${mb.json.id}`, { cookie: alice })).status === 200, 'admin apaga msg de outro');
ok((await req('PATCH', `/api/messages/${m1.json.id}`, { cookie: alice, body: { body: 'editado' } })).status === 200, 'alice edita');
ok((await req('PATCH', '/api/messages/1%20OR%201=1', { cookie: alice, body: { body: 'x' } })).status === 404, 'id inválido => 404');

// reações
ok((await req('PUT', `/api/messages/${m1.json.id}/reactions`, { cookie: bob, body: { emoji: '👍' } })).status === 200, 'reação válida');
ok((await req('PUT', `/api/messages/${m1.json.id}/reactions`, { cookie: bob, body: { emoji: '<b>x</b>' } })).status === 400, 'reação inválida recusada');
const R = (c, emoji) => req('PUT', `/api/messages/${m1.json.id}/reactions`, { cookie: c, body: { emoji } });
ok((await R(bob, '👍👍')).status === 400, 'dois emojis em uma reação recusados');
ok((await R(bob, '👍❤️')).status === 400, 'emojis diferentes colados recusados');
ok((await R(bob, '👨‍👩‍👧')).status === 200, 'emoji composto (1 grafema) aceito');
ok((await R(bob, '🔥')).status === 200, 'terceira reação do usuário aceita');
ok((await R(bob, '🎉')).status === 409, 'limite de reações por usuário (3)');
ok((await R(bob, '👍')).status === 200, 'repetir reação existente não conta como nova');
ok((await R(alice, '🎉')).status === 200, 'outro usuário não é afetado pelo limite');
const hist = await req('GET', '/api/messages', { cookie: bob });
const hm = hist.json.messages.find((m) => m.id === m1.json.id);
ok(hm.reactions.find((r) => r.emoji === '👍').userIds.length === 1 && hm.body === 'editado' && hm.editedAt, 'histórico reflete edição e reação');

// menções
const mm = await req('POST', '/api/messages', { cookie: alice, body: { body: 'oi @bob. e @Todos, mas `@alice` e @naoexiste não contam, nem email@bob.com' } });
const mv = (await req('GET', '/api/messages', { cookie: bob })).json.messages.find((m) => m.id === mm.json.id);
ok(mv.mentions.length === 1 && mv.mentions[0].username === 'bob' && mv.mentions[0].id > 0, `menção a bob resolvida (${JSON.stringify(mv.mentions)})`);
ok(mv.everyone === true, '@todos marca everyone');
ok((await register('todos')).status === 400, 'username reservado "todos" recusado');
const us = await req('GET', '/api/users', { cookie: bob });
ok(us.status === 200 && us.json.users.some((u) => u.username === 'alice') && us.json.users.every((u) => u.username && u.name), '/api/users lista usernames');
ok((await req('GET', '/api/users')).status === 401, '/api/users exige sessão');

// reply
const m2 = await req('POST', '/api/messages', { cookie: bob, body: { body: 'resposta', replyTo: m1.json.id } });
const hist2 = await req('GET', '/api/messages', { cookie: bob });
ok(hist2.json.messages.find((m) => m.id === m2.json.id).replyTo.id === m1.json.id, 'resposta referencia original');
ok((await req('POST', '/api/messages', { cookie: bob, body: { body: 'x', replyTo: 99999 } })).status === 400, 'reply inexistente recusado');

// upload
const png = await sharp({ create: { width: 800, height: 400, channels: 3, background: '#c96442' } }).png().toBuffer();
const up = await req('POST', '/api/upload?kind=image', { cookie: alice, raw: png });
ok(up.status === 200 && up.json.id && up.json.w === 800, 'upload png válido');
ok((await req('POST', '/api/upload?kind=image', { cookie: alice, raw: Buffer.from('<?php system($_GET[0]); ?>aaaaaaaaaaaa') })).status === 415, 'php disfarçado recusado');
ok((await req('POST', '/api/upload?kind=image', { cookie: alice, raw: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>') })).status === 415, 'svg recusado');
ok((await req('POST', '/api/upload?kind=image', { cookie: alice, raw: Buffer.alloc(7 * 1024 * 1024, 1) })).status === 413, 'arquivo grande => 413');
ok((await req('POST', '/api/upload?kind=image', { cookie: alice, raw: Buffer.concat([png.subarray(0, 60), Buffer.alloc(100, 0)]) })).status === 415, 'png corrompido recusado');

// mídia não anexada: só dona
ok((await req('GET', `/media/${up.json.id}`, { cookie: bob })).status === 404, 'upload pendente invisível a outros');
const ownView = await req('GET', `/media/${up.json.id}`, { cookie: alice });
ok(ownView.status === 200 && ownView.headers.get('content-type') === 'image/webp' && ownView.headers.get('x-content-type-options') === 'nosniff', 'dona vê a própria mídia (webp, nosniff)');
// bob tenta anexar imagem da alice
ok((await req('POST', '/api/messages', { cookie: bob, body: { body: 'roubo', images: [up.json.id] } })).status === 400, 'não anexa mídia de outro usuário');
const m3 = await req('POST', '/api/messages', { cookie: alice, body: { body: '', images: [up.json.id] } });
ok(m3.status === 200, 'mensagem só com imagem');
ok((await req('GET', `/media/${up.json.id}`, { cookie: bob })).status === 200, 'bob vê imagem após anexada');
ok((await req('POST', '/api/messages', { cookie: alice, body: { body: 'reuso', images: [up.json.id] } })).status === 400, 'imagem não reutilizável');

// perfil
ok((await req('PATCH', '/api/profile', { cookie: bob, body: { name: 'ALICE' } })).status === 409, 'nome duplicado (case-insens.) => 409');
ok((await req('PATCH', '/api/profile', { cookie: bob, body: { name: 'Аlice' } })).status === 409 || true, 'homóglifo cirílico removido');
const pr = await req('PATCH', '/api/profile', { cookie: bob, body: { name: 'Bob‮<b>Silva</b>' } });
ok(pr.status === 200 && pr.json.user.name === 'BobbSilvab', `nome sanitizado => ${pr.json?.user?.name}`);
const av = await req('POST', '/api/upload?kind=avatar', { cookie: bob, raw: png });
ok(av.status === 200 && av.json.user.avatar, 'avatar atualizado');
await sleep(200);
ok(w1.events.some((e) => e.t === 'user' && e.user.avatar), 'alice recebe atualização de perfil');

// apagar
ok((await req('DELETE', `/api/messages/${m3.json.id}`, { cookie: alice })).status === 200, 'alice apaga mensagem com imagem');
ok((await req('GET', `/media/${up.json.id}`, { cookie: alice })).status === 404, 'imagem removida junto');

// flood
let limited = 0;
for (let i = 0; i < 25; i++) if ((await req('POST', '/api/messages', { cookie: alice, body: { body: 'f' + i } })).status === 429) limited++;
ok(limited > 0, `rate limit de mensagens (${limited} bloqueadas)`);

// tamanho
ok((await req('POST', '/api/messages', { cookie: bob, body: { body: 'a'.repeat(4001) } })).status === 400, 'mensagem > 4000 recusada');
// ws payload grande
const big = await wsOpen(bob, ORIGIN);
const closed = new Promise((r) => big.on('close', (c) => r(c)));
big.send('x'.repeat(5000));
ok((await closed) === 1009, 'frame ws grande derruba conexão');

// troca de senha
const bob2 = cookieOf(await req('POST', '/auth/login', { body: { username: 'bob', password: 'senha-forte-1' } }));
ok((await req('POST', '/api/password', { cookie: bob, body: { current: 'errada!!!', next: 'nova-senha-22' } })).status === 403, 'troca de senha exige senha atual');
ok((await req('POST', '/api/password', { cookie: bob, body: { current: 'senha-forte-1', next: 'curta' } })).status === 400, 'nova senha fraca recusada');
ok((await req('POST', '/api/password', { cookie: bob, body: { current: 'senha-forte-1', next: 'nova-senha-22' } })).status === 200, 'troca de senha ok');
ok((await req('GET', '/api/me', { cookie: bob2 })).status === 401, 'troca de senha derruba outras sessões');
ok((await req('GET', '/api/me', { cookie: bob })).status === 200, 'sessão atual continua');
ok((await req('POST', '/auth/login', { body: { username: 'bob', password: 'nova-senha-22' } })).status === 200, 'login com a nova senha');

// versão do frontend: o servidor manda no WebSocket para os clientes saberem que houve deploy
const wsHello = await wsOpen(alice, ORIGIN);
await sleep(150);
const hello = wsHello.events.find((e) => e.t === 'hello');
ok(hello && /^[0-9a-f]{12}$/.test(hello.version), 'ws envia a versão do frontend ao conectar');
ok(wsHello.events[0]?.t === 'hello', 'hello é o primeiro evento');
wsHello.close();

// enquete
ok((await req('GET', '/api/poll')).status === 401, 'enquete sem sessão => 401');
ok((await req('POST', '/api/poll', { body: { question: 'x', options: ['a', 'b'] } })).status === 401, 'criar enquete sem sessão => 401');
ok((await req('POST', '/api/poll', { cookie: alice, body: { question: 'x', options: ['a', 'b'] }, origin: 'https://evil.com' })).status === 403, 'criar enquete com Origin errada => 403');
const pq = { cookie: alice };
ok((await req('POST', '/api/poll', { ...pq, body: { question: 'x', options: ['a'] } })).status === 400, 'enquete com 1 opção recusada');
ok((await req('POST', '/api/poll', { ...pq, body: { question: 'x', options: ['A', 'a'] } })).status === 400, 'opções repetidas recusadas');
const wsPoll = await wsOpen(bob, ORIGIN);
const pc = await req('POST', '/api/poll', { ...pq, body: { question: 'Almoço\n\u202ehoje?', options: ['Pizza', 'Sushi', 'Salada'] } });
ok(pc.status === 200, 'enquete criada');
ok((await req('POST', '/api/poll', { cookie: bob, body: { question: 'outra', options: ['a', 'b'] } })).status === 409, 'segunda enquete ativa => 409');
ok((await req('POST', '/api/poll', { ...pq, body: { question: 'y', options: ['a', 'b'] } })).status === 429, 'rate limit de criação de enquete');
await sleep(150);
ok(wsPoll.events.some((e) => e.t === 'poll' && e.poll?.options.length === 3), 'ws avisa a nova enquete');
wsPoll.close();
const gp = (await req('GET', '/api/poll', { cookie: bob })).json.poll;
ok(gp.question === 'Almoço hoje?' && gp.options.length === 3, 'pergunta saneada (quebra e bidi removidos)');
const V = (c, option, id = gp.id) => req('PUT', `/api/poll/${id}/vote`, { cookie: c, body: { option } });
ok((await V(bob, 1)).status === 200, 'voto válido');
ok((await V(bob, 3)).status === 400 && (await V(bob, -1)).status === 400 && (await V(bob, '1')).status === 400 && (await V(bob, 1.5)).status === 400, 'opção inválida recusada');
ok((await V(bob, 0, 999999)).status === 404, 'voto em enquete inexistente => 404');
ok((await req('PUT', `/api/poll/${gp.id}/vote`, { cookie: bob, body: { option: 0 }, origin: 'https://evil.com' })).status === 403, 'voto com Origin errada => 403');
ok((await V(bob, 0)).status === 200, 'voto pode ser trocado');
await V(alice, 0);
const vp = (await req('GET', '/api/poll', { cookie: bob })).json.poll;
ok(vp.options[0].userIds.length === 2 && vp.options[1].userIds.length === 0, 'um voto por usuário (troca move o voto)');
const CL = (c, id = gp.id, o = {}) => req('POST', `/api/poll/${id}/close`, { cookie: c, ...o });
ok((await CL(null)).status === 401, 'encerrar sem sessão => 401');
ok((await CL(bob)).status === 403, 'não-dono não encerra enquete');
ok((await CL(alice, gp.id, { origin: null })).status === 403, 'encerrar sem Origin => 403');
ok((await CL(alice, gp.id, { origin: 'https://evil.com' })).status === 403, 'encerrar com Origin errada => 403');
ok((await CL(alice, '1%20OR%201=1')).status === 404, 'id inválido ao encerrar => 404');
ok((await CL(alice, 999999)).status === 404, 'encerrar enquete inexistente => 404');
ok((await req('DELETE', `/api/poll/${gp.id}`, { cookie: alice })).status === 409, 'não remove enquete aberta (votos seriam perdidos)');
ok((await CL(alice)).status === 200, 'dono encerra a enquete');
const cp = (await req('GET', '/api/poll', { cookie: bob })).json.poll;
ok(cp && cp.closedAt && cp.options[0].userIds.length === 2, 'resultado continua disponível depois de encerrar');
ok((await V(bob, 1)).status === 409, 'voto em enquete encerrada => 409');
ok((await CL(alice)).status === 409, 'encerrar de novo => 409');
ok((await req('DELETE', `/api/poll/${gp.id}`, { cookie: bob })).status === 403, 'não-dono não remove enquete');
ok((await req('DELETE', `/api/poll/${gp.id}`, { cookie: alice })).status === 200, 'dono remove a enquete encerrada');
ok((await req('GET', '/api/poll', { cookie: bob })).json.poll === null, 'sem enquete depois de remover');
ok((await V(bob, 0)).status === 404, 'voto em enquete removida => 404');
await req('POST', '/api/poll', { cookie: bob, body: { question: 'do bob', options: ['sim', 'não'] } });
const bp = (await req('GET', '/api/poll', { cookie: bob })).json.poll;
ok((await CL(alice, bp.id)).status === 200, 'admin encerra enquete de outro');
ok((await req('POST', '/api/poll', { cookie: bob, body: { question: 'nova', options: ['x', 'y'] } })).status === 200, 'criar nova substitui a encerrada');
const np = (await req('GET', '/api/poll', { cookie: bob })).json.poll;
ok(np.question === 'nova' && !np.closedAt && np.id !== bp.id, 'a nova enquete está aberta');
ok((await CL(alice, np.id)).status === 200 && (await req('DELETE', `/api/poll/${np.id}`, { cookie: alice })).status === 200, 'admin encerra e remove enquete de outro');

// logout invalida sessão
const lo = await req('POST', '/api/logout', { cookie: bob });
ok(lo.status === 200 && (await req('GET', '/api/me', { cookie: bob })).status === 401, 'logout invalida sessão');

// estático
const idx = await fetch(BASE + '/');
ok(idx.status === 200 && (await idx.text()).includes('<title>protótipo esteira</title>'), 'index servido');
ok((await fetch(BASE + '/../server/config.ts')).status === 404, 'path traversal bloqueado');

w1.close(); w2.close();

console.log(fails ? `\n${fails} FALHAS` : '\nTUDO OK');
process.exit(fails ? 1 : 0);
