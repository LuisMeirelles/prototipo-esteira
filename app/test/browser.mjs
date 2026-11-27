// Teste de navegador da aba Local (terminal): `npm run test:browser`. Não faz parte do `npm test` porque
// precisa de Chrome/Chromium. Sobe um servidor estático com `app/web` e a mesma CSP do chat, duas pontes
// (uma na pasta app/, outra em app/test/) com `bash` no lugar do `claude`, e dirige o Chrome headless
// pelo protocolo CDP com teclas reais. Cobre: xterm sob a CSP, ponte compartilhada que conecta todos os
// painéis, ponte própria por painel, redimensionar, fim do processo + Enter para reiniciar e recarregar a página.
// NÃO cobre o `claude` de verdade (a TUI dele) nem Firefox/Safari.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const WEB = join(ROOT, 'web');
let fails = 0;
const ok = (c, msg) => { console.log(c ? 'PASS' : 'FAIL', msg); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  const candidates = [process.env.CHROME_BIN, 'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].filter(Boolean);
  for (const c of candidates) if (spawnSync(c, ['--version'], { stdio: 'ignore' }).status === 0) return c;
  return null;
}
const chromeBin = findChrome();
if (!chromeBin) {
  console.log('Chrome/Chromium não encontrado (defina CHROME_BIN): teste de navegador pulado.');
  process.exit(0);
}

// Mantenha igual à CSP de server/index.ts (o teste confere os trechos principais logo abaixo).
const CSP = ["default-src 'none'", "script-src 'self'", "style-src 'self'", "img-src 'self' blob:", "connect-src 'self' http://127.0.0.1:*", "font-src 'self'", "base-uri 'none'"].join('; ');
const indexTs = readFileSync(join(ROOT, 'server/index.ts'), 'utf8');
ok(indexTs.includes(`"script-src 'self'"`) && indexTs.includes(`"style-src 'self'"`) && indexTs.includes('http://127.0.0.1:*'), 'CSP do teste bate com a do servidor');

// página mínima que monta os 3 painéis reais de fake.js (as ids viram globais: p0, p1, p2)
const PAGE = `<!doctype html><meta charset=utf-8><link rel=stylesheet href=/style.css>
<div class=grid><div class=pane id=p0></div><div class=pane id=p1></div><div class=pane id=p2></div></div>
<script type=module src=/__harness.js></script>`;
const HARNESS = `import { startFakePanes } from '/fake.js'; startFakePanes([p0, p1, p2]);`;
const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html' };
const server = createServer((req, res) => {
  res.setHeader('content-security-policy', CSP);
  const path = new URL(req.url, 'http://x').pathname;
  if (path === '/') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(PAGE); }
  if (path === '/__harness.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(HARNESS); }
  const file = join(WEB, path);
  if (!file.startsWith(WEB) || !existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

const procs = [];
async function startBridge(cwd) {
  const p = spawn(process.execPath, [join(WEB, 'bridge.mjs'), ORIGIN], { cwd, env: { ...process.env, CLAUDE_BIN: 'bash' }, stdio: ['ignore', 'pipe', 'inherit'] });
  procs.push(p);
  return new Promise((res, rej) => {
    let buf = '';
    p.stdout.on('data', (d) => { buf += d; const m = /Código: (\S+)/.exec(buf); if (m) res(m[1]); });
    p.on('exit', () => rej(new Error('ponte saiu')));
  });
}

const tmp = mkdtempSync(join(tmpdir(), 'browser-test-'));
let chrome;
let ws;
try {
  const A = await startBridge(ROOT);
  const B = await startBridge(join(ROOT, 'test'));

  chrome = spawn(chromeBin, ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${tmp}`, '--window-size=1300,850', 'about:blank'], { stdio: 'ignore' });
  let port;
  for (let i = 0; i < 100 && !port; i++) {
    try { port = readFileSync(join(tmp, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch { await sleep(100); }
  }
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page'); } catch { await sleep(100); }
  }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let n = 0;
  const pending = new Map();
  const logs = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
    else if (d.method === 'Runtime.consoleAPICalled') logs.push(d.params.args.map((a) => a.value ?? a.description).join(' '));
    else if (d.method === 'Log.entryAdded') logs.push(d.params.entry.text);
  };
  const send = (method, params = {}) => new Promise((r) => { const id = ++n; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
  const waitFor = async (fn, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(150); } return null; };
  const key = (type, o) => send('Input.dispatchKeyEvent', { type, ...o });
  const type = async (text) => {
    for (const ch of text) {
      if (ch === '\n') { await key('keyDown', { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' }); await key('keyUp', { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }); }
      else { await key('keyDown', { key: ch, text: ch }); await key('keyUp', { key: ch }); }
    }
  };

  // ---- helpers de tela ----
  const clickTab = (p, text) => ev(`[...${p}.querySelectorAll('.tab')].find((t) => t.textContent === ${JSON.stringify(text)}).click()`);
  const paste = (p, code) => ev(`(() => { const i = ${p}.querySelector('.real-input'); i.value = ${JSON.stringify(code)}; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
  const title = (p) => ev(`${p}.querySelector('.tab.active .title')?.textContent`);
  const screen = async (p) => (await ev(`[...${p}.querySelectorAll('.xterm-rows > div')].map((d) => d.textContent.trimEnd()).filter(Boolean).join('\\n')`)) ?? '';
  const hasTerminal = (p) => ev(`!!${p}.querySelector('.xterm-helper-textarea')`);
  const hasPrompt = async (p) => /\$ ?$/m.test(await screen(p));
  const run = async (p, cmd) => { await ev(`${p}.querySelector('.xterm-helper-textarea').focus()`); await type(`${cmd}\n`); };
  const lineAfter = async (p, cmd, re) => waitFor(async () => (await screen(p)).split('\n').find((l) => re.test(l)));

  await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable');
  await send('Page.navigate', { url: `${ORIGIN}/` });
  await waitFor(() => ev(`!!window.p0 && !!p0.querySelector('.tab')`));

  // 1) painel 1 abre o Local antes de haver ponte e fica esperando o código
  await clickTab('p1', 'Local');
  ok(await waitFor(() => ev(`!!p1.querySelector('.real-input')`)), 'painel sem ponte mostra a tela do código');
  // 2) painel 0 conecta a ponte compartilhada: terminal abre e o painel 1 entra sozinho
  await clickTab('p0', 'Local');
  await paste('p0', A);
  ok(await waitFor(async () => (await hasTerminal('p0')) && (await hasPrompt('p0'))), 'xterm abre sob a CSP e mostra o prompt do bash');
  ok((await title('p0')) === 'app', 'aba mostra o nome da pasta da ponte');
  ok(await waitFor(async () => (await hasTerminal('p1')) && (await hasPrompt('p1'))), 'painel que esperava entra sozinho na ponte compartilhada');
  // 3) painel 2 abre depois e já usa a compartilhada
  await clickTab('p2', 'Local');
  ok(await waitFor(async () => (await hasTerminal('p2')) && (await hasPrompt('p2'))), 'painel novo usa a ponte compartilhada sem colar código');

  // 4) teclas reais, cores e tamanho
  await run('p0', 'ls --color=always /');
  ok(await lineAfter('p0', '', /\busr\b/), 'comando digitado roda e a saída volta');
  await run('p0', 'stty size');
  const size1 = await lineAfter('p0', '', /^\d+ \d+$/);
  ok(!!size1, 'o pty informa o tamanho do terminal');
  await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 500, deviceScaleFactor: 1, mobile: false });
  await sleep(1200);
  await run('p0', 'stty size');
  const size2 = await waitFor(async () => (await screen('p0')).split('\n').filter((l) => /^\d+ \d+$/.test(l)).at(-1) !== size1 && (await screen('p0')).split('\n').filter((l) => /^\d+ \d+$/.test(l)).at(-1));
  ok(!!size1 && !!size2 && size1 !== size2, `redimensionar a janela muda o tamanho do pty (${size1} → ${size2})`);

  // 5) ponte própria no painel 2 (outra pasta)
  await ev(`[...p2.querySelectorAll('.tab')].find((t) => t.textContent === 'ponte…').click()`);
  ok(await waitFor(() => ev(`!!p2.querySelector('.real-input')`)), '"ponte…" volta à tela do código');
  await ev(`[...p2.querySelectorAll('button')].find((b) => b.textContent.includes('só neste painel')).click()`);
  await paste('p2', B);
  ok(await waitFor(async () => (await title('p2')) === 'test' && (await hasTerminal('p2'))), 'painel com ponte própria abre na outra pasta');
  await run('p2', 'pwd');
  ok(!!(await lineAfter('p2', '', new RegExp(`^${join(ROOT, 'test').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`))), 'o terminal do painel 2 roda na pasta da ponte própria');
  await run('p1', 'pwd');
  ok(!!(await lineAfter('p1', '', new RegExp(`^${ROOT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`))), 'os outros painéis continuam na pasta da ponte compartilhada');

  // 6) recarregar: cada painel volta à sua ponte, sem colar nada
  await send('Page.reload');
  await waitFor(() => ev(`!!window.p0 && !!p0.querySelector('.tab')`));
  ok(await waitFor(async () => (await title('p0')) === 'app' && (await hasPrompt('p0'))), 'após recarregar, o painel 0 reconecta e abre o terminal');
  ok(await waitFor(async () => (await title('p2')) === 'test' && (await hasPrompt('p2'))), 'após recarregar, o painel 2 volta à ponte própria');

  // 7) fim do processo e reinício com Enter
  await run('p0', 'exit');
  ok(await waitFor(async () => (await screen('p0')).includes('Enter reinicia')), 'ao encerrar o processo o painel avisa que Enter reinicia');
  await ev(`p0.querySelector('.xterm-helper-textarea').focus()`);
  await type('\n');
  ok(await waitFor(async () => !(await screen('p0')).includes('Enter reinicia') && (await hasPrompt('p0'))), 'Enter reinicia o terminal');

  // 8) nada foi bloqueado pela CSP
  const bad = logs.filter((l) => /Content Security Policy|violates/i.test(l));
  ok(bad.length === 0, `nenhuma violação de CSP no console${bad.length ? `: ${bad[0].slice(0, 160)}` : ''}`);
} catch (e) {
  ok(false, `erro inesperado: ${e?.stack ?? e}`);
} finally {
  try { ws?.close(); } catch {}
  chrome?.kill();
  for (const p of procs) p.kill();
  server.close();
  await sleep(300);
  rmSync(tmp, { recursive: true, force: true });
}
console.log(fails ? `\n${fails} falha(s)` : '\ntudo certo');
process.exit(fails ? 1 : 0);
