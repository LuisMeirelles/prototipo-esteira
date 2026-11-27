// Testa a ponte local (bridge/bridge.mjs) com um `claude` de mentira. Rode com `npm test`.
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
const chat = (body, headers = good) => fetch(`${base}/chat`, { method: 'POST', headers, body: JSON.stringify(body) });

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
  const pre = await fetch(`${base}/chat`, { method: 'OPTIONS', headers: { origin: ORIGIN } });
  ok(pre.status === 204 && pre.headers.get('access-control-allow-origin') === ORIGIN, 'ponte: preflight só libera o Origin do chat');

  const r = await chat({ prompt: '--help' });
  const lines = (await r.text()).trim().split('\n').map((l) => JSON.parse(l));
  ok(r.status === 200 && lines.length === 3, 'ponte: /chat repassa os eventos');
  ok(lines[1].message.content[0].text === 'recebi: --help', 'ponte: prompt chega pelo stdin');
  ok(!lines[0].args.includes('--help') && lines[0].args.includes('bypassPermissions'), 'ponte: prompt não vira argumento; permissão total ligada');
  const r2 = await chat({ prompt: 'oi', session: '11111111-2222-3333-4444-555555555555' });
  ok((await r2.text()).includes('"--resume","11111111-2222-3333-4444-555555555555"'), 'ponte: retoma a sessão pelo id');

  ok((await chat({ prompt: 'oi', session: '--dangerous' })).status === 400, 'ponte: session que não é UUID → 400');
  ok((await chat({ prompt: '' })).status === 400, 'ponte: prompt vazio → 400');
  ok((await chat({ prompt: 'x'.repeat(33000) })).status === 400, 'ponte: prompt grande demais → 400');
  ok((await chat({ prompt: 'oi' }, { origin: ORIGIN, 'content-type': 'application/json' })).status === 401, 'ponte: /chat sem token → 401');

  const f = await chat({ prompt: 'falha' });
  ok((await f.text()).includes('"bridge_error"'), 'ponte: erro do claude vira bridge_error');

  // modo shell e Tab: mesmas barreiras do /chat
  const post = (path, body, headers = good) => fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const sh = await post('/shell', { command: 'echo oi; echo erro >&2; exit 3' });
  const shLines = (await sh.text()).trim().split('\n').map((l) => JSON.parse(l));
  ok(shLines.some((l) => l.type === 'out' && l.stream === 'stdout' && l.data.includes('oi')), 'ponte: /shell devolve a saída');
  ok(shLines.some((l) => l.type === 'out' && l.stream === 'stderr' && l.data.includes('erro')), 'ponte: /shell separa stderr');
  ok(shLines.at(-1).type === 'exit' && shLines.at(-1).code === 3, 'ponte: /shell informa o código de saída');
  ok((await post('/shell', { command: 'echo x' }, { origin: ORIGIN, 'content-type': 'application/json' })).status === 401, 'ponte: /shell sem token → 401');
  ok((await post('/shell', { command: 'echo x' }, { ...good, origin: 'https://evil.test' })).status === 403, 'ponte: /shell com Origin errado → 403');
  ok((await post('/shell', { command: '' })).status === 400, 'ponte: /shell vazio → 400');
  ok((await post('/shell', { command: 'x'.repeat(4001) })).status === 400, 'ponte: /shell grande demais → 400');
  ok((await post('/shell', { command: ['ls'] })).status === 400, 'ponte: /shell com tipo errado → 400');
  const cp = await post('/complete', { prefix: 'test/fake-c' });
  ok((await cp.json()).items.includes('fake-claude.mjs'), 'ponte: /complete lista nomes pelo prefixo');
  const cd = await post('/complete', { prefix: 'te' });
  ok((await cd.json()).items.includes('test/'), 'ponte: /complete marca diretório com /');
  ok((await post('/complete', { prefix: 'x'.repeat(1001) })).status === 400, 'ponte: /complete prefixo grande demais → 400');
  ok((await post('/complete', { prefix: 'test/' }, { origin: ORIGIN, 'content-type': 'application/json' })).status === 401, 'ponte: /complete sem token → 401');

  const ctrl = new AbortController();
  const s = await fetch(`${base}/chat`, { method: 'POST', headers: good, body: JSON.stringify({ prompt: 'dorme' }), signal: ctrl.signal });
  await s.body.getReader().read();
  ctrl.abort();
  for (let i = 0; i < 30 && !existsSync(mark); i++) await new Promise((r) => setTimeout(r, 100));
  ok(existsSync(mark), 'ponte: fechar a conexão encerra o claude');
} finally {
  child.kill();
  rmSync(dir, { recursive: true, force: true });
}
console.log(fails ? `\n${fails} falha(s)` : '\ntudo certo');
process.exit(fails ? 1 : 0);
