#!/usr/bin/env node
// Ponte local: liga os terminais "Local" do chat ao Claude Code CLI desta máquina.
// Uso: node bridge.mjs https://IP_DO_CHAT [--port 47800]
// O painel "Local" do chat mostra um comando que baixa este arquivo de /bridge.mjs, confere o SHA-256
// (calculado no navegador, que validou o HTTPS) e só então o executa. O arquivo é público de propósito:
// não tem segredo, e a integridade vem do hash, não do sigilo.
//
// Roda na máquina de quem usa, sem dependências. Escuta só em 127.0.0.1 e entrega ao `claude`
// o que a pessoa digitar no painel, com PERMISSÃO TOTAL (--permission-mode bypassPermissions)
// no diretório em que esta ponte foi iniciada. Por isso a defesa está toda aqui:
//  - só aceita requisições cujo Origin seja exatamente o do chat (um site qualquer aberto no
//    navegador não consegue falar com a ponte);
//  - exige o token aleatório mostrado ao iniciar (a pessoa o cola no painel; o servidor do chat
//    nunca o vê);
//  - confere o Host (barra DNS rebinding);
//  - o prompt vai pelo stdin, nunca como argumento (um prompt iniciado por "-" viraria flag).
import { spawn } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { statSync } from 'node:fs';
import { open, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve as resolvePath } from 'node:path';

const CLAUDE = process.env.CLAUDE_BIN || 'claude';
const MAX_BODY = 64 * 1024;
const MAX_PROMPT = 32000;
const MAX_RUNS = 4; // um por painel, com folga
// Pasta de trabalho atual: começa onde a ponte foi iniciada e acompanha os `cd` dados no modo `!`.
// O claude e o shell sempre rodam nela.
let cwd = process.cwd();
const MAX_SHELL = 4000;
const SHELL_TIMEOUT_MS = 120_000;
const MAX_SHELL_OUT = 1024 * 1024; // depois disso a saída é cortada, para não encher a memória do navegador
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

const args = process.argv.slice(2);
let origin;
let wantedPort = 0;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port') wantedPort = Number(args[++i]);
  else if (!origin) {
    try {
      origin = new URL(args[i]).origin;
    } catch {
      fail(`Origin inválido: ${args[i]}`);
    }
  }
}
if (!origin || origin === 'null') fail('Uso: node bridge.mjs https://IP_DO_CHAT [--port N]');
if (!Number.isInteger(wantedPort) || wantedPort < 0 || wantedPort > 65535) fail('Porta inválida');

const token = randomBytes(24).toString('base64url');
const tokenBuf = Buffer.from(token);
function tokenOk(header) {
  const m = /^Bearer (\S+)$/.exec(header ?? '');
  if (!m) return false;
  const given = Buffer.from(m[1]);
  return given.length === tokenBuf.length && timingSafeEqual(given, tokenBuf);
}

let running = 0;

function json(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('too_large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

// Tab no painel: lista entradas do diretório a partir do que a pessoa digitou (relativo à pasta da ponte).
// Mesmo nível de confiança do `claude` com permissão total; ainda assim só devolve nomes, nunca conteúdo.
async function complete(res, body, cors) {
  const prefix = body?.prefix;
  if (typeof prefix !== 'string' || prefix.length > 1000) return json(res, 400, { error: 'invalid_body' }, cors);
  const expanded = prefix === '~' || prefix.startsWith('~/') ? homedir() + prefix.slice(1) : prefix;
  const full = resolvePath(cwd, expanded);
  const dir = expanded === '' || expanded.endsWith('/') ? full : dirname(full);
  const base = expanded === '' || expanded.endsWith('/') ? '' : full.slice(dir.length + 1);
  let items = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    items = entries
      .filter((e) => e.name.startsWith(base) && (base.startsWith('.') || !e.name.startsWith('.')))
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
      .sort()
      .slice(0, 50);
  } catch {
    // diretório inexistente ou sem permissão: sem sugestões
  }
  return json(res, 200, { items, base }, cors);
}

// Modo shell (`!comando`): roda na pasta da ponte e devolve a saída em NDJSON. O comando vai como
// argumento de `-c` porque é exatamente o que a pessoa quer executar; a barreira é Origin + token.
function shell(res, body, cors) {
  const command = body?.command;
  if (typeof command !== 'string' || !command.trim() || command.length > MAX_SHELL) {
    return json(res, 400, { error: 'invalid_body' }, cors);
  }
  if (running >= MAX_RUNS) return json(res, 429, { error: 'busy' }, cors);
  running++;
  // fd 3 devolve a pasta em que o comando terminou, para que `cd x && ls` (ou só `cd x`) valha para os
  // próximos comandos e para o claude. Vai depois de uma quebra de linha: comentário no fim não engole.
  const script = `${command}\n__rc=$?\npwd -P >&3 2>/dev/null\nexit $__rc`;
  const child = spawn(process.env.SHELL || '/bin/sh', ['-c', script], { stdio: ['ignore', 'pipe', 'pipe', 'pipe'], cwd });
  let endDir = '';
  child.stdio[3].on('data', (d) => {
    endDir = (endDir + d).slice(0, 4096);
  });
  res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store', ...cors });
  let sent = 0;
  const emit = (stream) => (d) => {
    if (sent > MAX_SHELL_OUT) return;
    sent += d.length;
    res.write(JSON.stringify({ type: 'out', stream, data: d.toString().slice(0, 20000) }) + '\n');
    if (sent > MAX_SHELL_OUT) {
      res.write(JSON.stringify({ type: 'out', stream: 'stderr', data: '\n[saída cortada]\n' }) + '\n');
      child.kill('SIGTERM');
    }
  };
  child.stdout.on('data', emit('stdout'));
  child.stderr.on('data', emit('stderr'));
  const timer = setTimeout(() => child.kill('SIGKILL'), SHELL_TIMEOUT_MS);
  let done = false;
  const finish = (message, code) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    running--;
    if (message) res.write(JSON.stringify({ type: 'bridge_error', message }) + '\n');
    else {
      const dir = endDir.trim();
      try {
        if (dir && statSync(dir).isDirectory()) cwd = dir;
      } catch {
        // pasta sumiu no meio do caminho: mantém a anterior
      }
      res.write(JSON.stringify({ type: 'exit', code, cwd }) + '\n');
    }
    res.end();
  };
  child.on('error', (e) => finish(String(e.message)));
  child.on('close', (code) => finish('', code));
  res.on('close', () => {
    if (!done) child.kill('SIGTERM');
  });
}

// --- histórico das conversas do claude desta pasta ---
// O claude grava cada conversa em ~/.claude/projects/<pasta com tudo que não é letra/número virando "-">/<uuid>.jsonl.
// A ponte só lê esses arquivos (o nome vem de um UUID validado, então não há caminho controlado por quem chama)
// e devolve o que o painel precisa para redesenhar a conversa, sem o resto (pensamento, anexos, telemetria).
const MAX_TRANSCRIPT_BYTES = 8 * 1024 * 1024;
const MAX_TRANSCRIPT_EVENTS = 400;
const MAX_TEXT = 4000;

function sessionsDir() {
  const base = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
  return join(base, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));
}

// lê no máximo `max` bytes do começo (ou do fim) do arquivo
async function readSlice(file, max, fromEnd) {
  const fh = await open(file, 'r');
  try {
    const { size } = await fh.stat();
    const len = Math.min(size, max);
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, fromEnd ? size - len : 0);
    return { text: buf.toString('utf8'), partial: size > len };
  } finally {
    await fh.close();
  }
}

function promptText(message) {
  const c = message?.content;
  const text = typeof c === 'string' ? c : Array.isArray(c) ? c.map((b) => (b?.type === 'text' ? b.text : '')).join(' ') : '';
  return typeof text === 'string' ? text.trim() : '';
}

async function sessions(res, cors) {
  const dir = sessionsDir();
  let files = [];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.jsonl') && UUID.test(f.slice(0, -6)));
  } catch {
    return json(res, 200, { sessions: [] }, cors);
  }
  const withTime = [];
  for (const f of files) {
    try {
      withTime.push({ id: f.slice(0, -6), mtime: (await stat(join(dir, f))).mtimeMs });
    } catch {
      // sumiu no meio da leitura
    }
  }
  withTime.sort((a, b) => b.mtime - a.mtime);
  const out = [];
  for (const { id, mtime } of withTime.slice(0, 15)) {
    let title = '';
    try {
      const { text } = await readSlice(join(dir, `${id}.jsonl`), 128 * 1024, false);
      for (const line of text.split('\n')) {
        let o;
        try {
          o = JSON.parse(line);
        } catch {
          continue;
        }
        if (o?.type !== 'user' || o.isSidechain) continue;
        const t = promptText(o.message);
        if (t && !t.startsWith('<')) {
          title = t.replace(/\s+/g, ' ').slice(0, 80);
          break;
        }
      }
    } catch {
      // arquivo ilegível: lista sem título
    }
    if (title) out.push({ id, mtime, title });
  }
  return json(res, 200, { sessions: out }, cors);
}

async function transcript(res, body, cors) {
  const id = body?.session;
  if (typeof id !== 'string' || !UUID.test(id)) return json(res, 400, { error: 'invalid_body' }, cors);
  let slice;
  try {
    slice = await readSlice(join(sessionsDir(), `${id}.jsonl`), MAX_TRANSCRIPT_BYTES, true);
  } catch {
    return json(res, 404, { error: 'not_found' }, cors);
  }
  const lines = slice.text.split('\n');
  if (slice.partial) lines.shift(); // primeira linha do trecho pode estar cortada ao meio
  const clipStr = (v) => (typeof v === 'string' && v.length > MAX_TEXT ? `${v.slice(0, MAX_TEXT)}…` : v);
  const events = [];
  for (const line of lines) {
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if ((o?.type !== 'user' && o?.type !== 'assistant') || o.isSidechain || !o.message) continue;
    const c = o.message.content;
    let content;
    if (typeof c === 'string') content = clipStr(c);
    else if (Array.isArray(c)) {
      content = c
        .filter((b) => b && ['text', 'tool_use', 'tool_result'].includes(b.type))
        .map((b) => ({
          type: b.type,
          text: clipStr(b.text),
          name: b.name,
          input: b.type === 'tool_use' ? { command: clipStr(b.input?.command), file_path: b.input?.file_path, pattern: b.input?.pattern, path: b.input?.path, url: b.input?.url, description: clipStr(b.input?.description) } : undefined,
          content: b.type === 'tool_result' ? (typeof b.content === 'string' ? clipStr(b.content) : Array.isArray(b.content) ? b.content.map((x) => ({ text: clipStr(x?.text) })) : '') : undefined,
          is_error: b.is_error,
        }));
    } else continue;
    events.push({ type: o.type, message: { content } });
  }
  return json(res, 200, { events: events.slice(-MAX_TRANSCRIPT_EVENTS) }, cors);
}

const server = createServer(async (req, res) => {
  const port = server.address().port;
  if (req.headers.origin !== origin) return json(res, 403, { error: 'forbidden' });
  if (req.headers.host !== `127.0.0.1:${port}` && req.headers.host !== `localhost:${port}`) {
    return json(res, 403, { error: 'forbidden' });
  }
  const cors = {
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'GET, POST',
    // Chrome pede isso para página pública falar com o loopback
    'access-control-allow-private-network': 'true',
    vary: 'Origin',
  };
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    return res.end();
  }
  if (!tokenOk(req.headers.authorization)) return json(res, 401, { error: 'unauthorized' }, cors);

  const path = (req.url ?? '').split('?')[0];
  if (req.method === 'GET' && path === '/health') {
    return json(res, 200, { ok: true, cwd }, cors);
  }
  if (req.method !== 'POST' || !['/chat', '/shell', '/complete', '/sessions', '/transcript'].includes(path)) {
    return json(res, 404, { error: 'not_found' }, cors);
  }

  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return json(res, 400, { error: 'invalid_body' }, cors);
  }
  if (path === '/complete') return complete(res, body, cors);
  if (path === '/sessions') return sessions(res, cors);
  if (path === '/transcript') return transcript(res, body, cors);
  if (path === '/shell') return shell(res, body, cors);
  const prompt = body?.prompt;
  const session = body?.session ?? null;
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > MAX_PROMPT) {
    return json(res, 400, { error: 'invalid_body' }, cors);
  }
  if (session !== null && (typeof session !== 'string' || !UUID.test(session))) {
    return json(res, 400, { error: 'invalid_body' }, cors);
  }
  if (running >= MAX_RUNS) return json(res, 429, { error: 'busy' }, cors);

  const cliArgs = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'bypassPermissions'];
  if (session) cliArgs.push('--resume', session);

  running++;
  const child = spawn(CLAUDE, cliArgs, { stdio: ['pipe', 'pipe', 'pipe'], cwd });
  let stderr = '';
  child.stderr.on('data', (d) => {
    stderr = (stderr + d).slice(-2000);
  });
  res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store', ...cors });
  child.stdout.pipe(res, { end: false });
  child.stdin.on('error', () => {});
  child.stdin.end(prompt);

  let done = false;
  const finish = (message) => {
    if (done) return;
    done = true;
    running--;
    if (message) res.write(JSON.stringify({ type: 'bridge_error', message }) + '\n');
    res.end();
  };
  child.on('error', (e) => finish(e.code === 'ENOENT' ? 'claude não encontrado no PATH desta máquina' : String(e.message)));
  child.on('close', (code) => finish(code ? stderr.trim() || `claude saiu com código ${code}` : ''));
  // pane interrompeu (Esc) ou fechou a página: não deixa o agente rodando sozinho
  res.on('close', () => {
    if (!done) child.kill('SIGTERM');
  });
});

server.listen(wantedPort, '127.0.0.1', () => {
  const { port } = server.address();
  console.log(`Ponte local ligada em 127.0.0.1:${port} (permissão total, diretório: ${cwd})`);
  console.log(`Aceita só o chat em ${origin}.`);
  console.log('');
  console.log(`Código: ${port}.${token}`);
  console.log('');
  console.log('Cole o código no painel "Local" do chat. Ctrl+C encerra a ponte.');
});
