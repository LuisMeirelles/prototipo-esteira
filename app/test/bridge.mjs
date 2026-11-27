// Testa a ponte local (web/bridge.mjs) com um `claude` de mentira num pty de verdade. Rode com `npm test`.
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ORIGIN = 'https://10.0.0.5';
let fails = 0;
const ok = (c, msg) => { console.log(c ? 'PASS' : 'FAIL', msg); if (!c) fails++; };

const dir = mkdtempSync(join(tmpdir(), 'bridge-test-'));
const mark = join(dir, 'morto');
const child = spawn(process.execPath, ['web/bridge.mjs', ORIGIN], {
  env: { ...process.env, CLAUDE_BIN: resolve('test/fake-claude.mjs'), MARK_FILE: mark },
  stdio: ['ignore', 'pipe', 'inherit'],
});

const code = await new Promise((res) => {
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d;
    const m = /Código: (\d+)\.(\S+)/.exec(buf);
    if (m) res([m[1], m[2]]);
  });
});
const [port, token] = code;
const base = `http://127.0.0.1:${port}`;
const good = { origin: ORIGIN, authorization: `Bearer ${token}`, 'content-type': 'application/json' };
const post = (path, body, headers = good) => fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });

try {
  ok((await fetch(`${base}/health`, { headers: { authorization: `Bearer ${token}` } })).status === 403, 'ponte: sem Origin → 403');
  ok((await fetch(`${base}/health`, { headers: { ...good, origin: 'https://evil.test' } })).status === 403, 'ponte: Origin de outro site → 403');
  // o fetch do Node ignora o cabeçalho Host; http.request manda o valor falso de verdade
  const rawHost = (host) => new Promise((res) => {
    const q = request({ host: '127.0.0.1', port, path: '/health', headers: { ...good, host } }, (r) => { r.resume(); res(r.statusCode); });
    q.end();
  });
  ok((await rawHost('evil.test')) === 403, 'ponte: Host estranho (DNS rebinding) → 403');
  ok((await rawHost(`127.0.0.1:${port}`)) === 200, 'ponte: Host de loopback legítimo → 200');
  ok((await fetch(`${base}/health`, { headers: { origin: ORIGIN } })).status === 401, 'ponte: sem token → 401');
  ok((await fetch(`${base}/health`, { headers: { origin: ORIGIN, authorization: 'Bearer errado' } })).status === 401, 'ponte: token errado → 401');
  const h = await fetch(`${base}/health`, { headers: good });
  ok(h.status === 200 && (await h.json()).ok === true, 'ponte: health com token e Origin certos');
  const pre = await fetch(`${base}/tty/start`, { method: 'OPTIONS', headers: { origin: ORIGIN } });
  ok(pre.status === 204 && pre.headers.get('access-control-allow-origin') === ORIGIN, 'ponte: preflight só libera o Origin do chat');

  // a ponte só abre terminal: nada de chat, shell, completar caminho nem ler conversas
  for (const path of ['/chat', '/shell', '/complete', '/sessions', '/transcript']) {
    ok((await post(path, { command: 'echo x', prompt: 'oi', prefix: '', session: 'aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb' })).status === 404, `ponte: ${path} não existe mais → 404`);
  }

  // aba TTY: o "claude" roda num pty real (ajudante em Python); teclas por POST, saída em NDJSON/base64
  const tt = await post('/tty/start', { cols: 90, rows: 20 });
  const rd = tt.body.pipeThrough(new TextDecoderStream()).getReader();
  let tbuf = '';
  let tout = '';
  let tid = '';
  let pending = null; // uma leitura só por vez: uma que perde a corrida perderia o pedaço quando resolvesse
  const pump = async (until, ms = 8000) => {
    const end = Date.now() + ms;
    while (Date.now() < end && !until()) {
      pending ??= rd.read();
      const r = await Promise.race([pending, new Promise((res) => setTimeout(() => res({ timeout: true }), 500))]);
      if (r.timeout) continue;
      pending = null;
      if (r.done) break;
      if (r.value) {
        tbuf += r.value;
        for (let i = tbuf.indexOf('\n'); i >= 0; i = tbuf.indexOf('\n')) {
          const ev = JSON.parse(tbuf.slice(0, i));
          tbuf = tbuf.slice(i + 1);
          if (ev.type === 'ready') tid = ev.id;
          if (ev.type === 'data') tout += Buffer.from(ev.d, 'base64').toString();
        }
      }
    }
  };
  await pump(() => tid);
  ok(tt.status === 200 && tid.length > 10, 'ponte: /tty/start abre o terminal e devolve o id');
  const tin = (body, headers = good) => post('/tty/input', body, headers);
  ok((await tin({ id: tid, data: 'ola\n' })).status === 200, 'ponte: /tty/input aceita teclas');
  ok((await tin({ id: tid, data: '\x04' })).status === 200, 'ponte: /tty/input aceita Ctrl-D');
  await pump(() => tout.includes('recebi: ola'));
  ok(tout.includes('recebi: ola'), 'ponte: o que se digita chega ao programa e a saída volta (pty real)');
  ok((await post('/tty/resize', { id: tid, cols: 120, rows: 40 })).status === 200, 'ponte: /tty/resize aceita tamanho válido');
  ok((await post('/tty/resize', { id: tid, cols: 5000, rows: 40 })).status === 400, 'ponte: /tty/resize com tamanho absurdo → 400');
  ok((await tin({ id: tid, data: 'x'.repeat(33000) })).status === 400, 'ponte: /tty/input grande demais → 400');
  ok((await tin({ id: 'nao-existe', data: 'a' })).status === 404, 'ponte: /tty/input com id desconhecido → 404');
  ok((await tin({ id: tid, data: 'a' }, { origin: ORIGIN, 'content-type': 'application/json' })).status === 401, 'ponte: /tty/input sem token → 401');
  ok((await tin({ id: tid, data: 'a' }, { ...good, origin: 'https://evil.test' })).status === 403, 'ponte: /tty/input com Origin errado → 403');
  ok((await post('/tty/start', {}, { origin: ORIGIN, 'content-type': 'application/json' })).status === 401, 'ponte: /tty/start sem token → 401');
  await post('/tty/stop', { id: tid });
  await pump(() => false, 1500);
  ok((await tin({ id: tid, data: 'a' })).status === 404, 'ponte: /tty/stop encerra e libera o id');
  const many = [];
  for (let i = 0; i < 4; i++) many.push(await post('/tty/start', {}));
  ok(many.map((m) => m.status).join() === '200,200,200,429', 'ponte: no máximo 3 terminais ao mesmo tempo (4º → 429)');
  for (const m of many) m.body?.cancel().catch(() => {});
  await new Promise((r) => setTimeout(r, 800)); // deixa a ponte soltar os terminais antes do próximo teste

  // fechar a conexão derruba o claude (o pty recebe SIGHUP)
  const ctrl = new AbortController();
  const s = await fetch(`${base}/tty/start`, { method: 'POST', headers: good, body: '{}', signal: ctrl.signal });
  const sr = s.body.pipeThrough(new TextDecoderStream()).getReader();
  let sid = '';
  while (!sid) {
    const { value, done } = await sr.read();
    if (done) break;
    sid = JSON.parse(value.split('\n')[0]).id ?? '';
  }
  await post('/tty/input', { id: sid, data: 'dorme\n\x04' });
  await new Promise((r) => setTimeout(r, 800));
  ctrl.abort();
  for (let i = 0; i < 30 && !existsSync(mark); i++) await new Promise((r) => setTimeout(r, 100));
  ok(existsSync(mark), 'ponte: fechar a conexão encerra o claude');
} finally {
  child.kill();
  rmSync(dir, { recursive: true, force: true });
}
console.log(fails ? `\n${fails} falha(s)` : '\ntudo certo');
process.exit(fails ? 1 : 0);
