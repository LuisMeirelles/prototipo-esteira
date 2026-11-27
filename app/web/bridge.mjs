#!/usr/bin/env node
// Ponte local: liga a aba Local do chat ao Claude Code CLI desta máquina, num terminal de verdade.
// Uso: node bridge.mjs https://IP_DO_CHAT [--port 47800]
// O painel "Local" do chat mostra um comando que baixa este arquivo de /bridge.mjs, confere o SHA-256
// (calculado no navegador, que validou o HTTPS) e só então o executa. O arquivo é público de propósito:
// não tem segredo, e a integridade vem do hash, não do sigilo.
//
// Roda na máquina de quem usa, sem dependências (precisa de python3 para o pseudo-terminal). Escuta só
// em 127.0.0.1 e abre o `claude` interativo na pasta em que esta ponte foi iniciada. A defesa está toda aqui:
//  - só aceita requisições cujo Origin seja exatamente o do chat (um site qualquer aberto no
//    navegador não consegue falar com a ponte);
//  - exige o token aleatório mostrado ao iniciar (a pessoa o cola no painel; o servidor do chat
//    nunca o vê);
//  - confere o Host (barra DNS rebinding);
//  - o comando executado é fixo (o `claude`): nada vindo do navegador vira comando ou argumento.
import { spawn } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

const CLAUDE = process.env.CLAUDE_BIN || 'claude';
// maior que MAX_INPUT com folga: no JSON um caractere de controle ocupa até 6 bytes (\u00XX)
const MAX_BODY = 256 * 1024;
const cwd = process.cwd();

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

// --- terminal de verdade (aba TTY) ---
// O `claude` interativo roda num pseudo-terminal. Node não tem pty nativo e esta ponte não tem dependências,
// então um ajudante em Python (módulo `pty` da biblioteca padrão, Linux/macOS) abre o pty e repassa:
//  stdin → teclas, stdout → saída, fd 3 → "R colunas linhas" para redimensionar.
// O navegador recebe a saída em NDJSON (bytes em base64) e manda teclas por POST: sem WebSocket.
// Não passa --permission-mode: é o `claude` normal da pessoa, que pergunta e permite alternar na própria interface.
// Esta é a ÚNICA função da ponte (sem /chat nem /shell): quanto menos rotas, menos o que um token vazado alcança.
const PTY_PY = `
import os, pty, sys, select, struct, fcntl, termios, signal
cols, rows = int(sys.argv[1]), int(sys.argv[2])
cmd = sys.argv[3:]
pid, fd = pty.fork()
if pid == 0:
    try:
        fcntl.ioctl(0, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))
        os.environ['TERM'] = 'xterm-256color'
        os.execvp(cmd[0], cmd)
    except Exception as e:
        os.write(2, ('nao consegui iniciar ' + cmd[0] + ': ' + str(e) + '\\r\\n').encode())
        os._exit(127)
def wr(f, d):
    while d:
        n = os.write(f, d)
        d = d[n:]
stdin_open = True
ctl_open = True
ctl = b''
while True:
    r, _, _ = select.select([fd] + ([3] if ctl_open else []) + ([0] if stdin_open else []), [], [])
    if fd in r:
        try:
            d = os.read(fd, 65536)
        except OSError:
            d = b''
        if not d:
            break
        wr(1, d)
    if 0 in r:
        d = os.read(0, 65536)
        if not d:
            os.close(fd)
            sys.exit(0)
        wr(fd, d)
    if 3 in r:
        d = os.read(3, 4096)
        if not d:
            ctl_open = False
        ctl += d
        while b'\\n' in ctl:
            line, ctl = ctl.split(b'\\n', 1)
            p = line.split()
            if len(p) == 3 and p[0] == b'R':
                try:
                    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', int(p[2]), int(p[1]), 0, 0))
                    os.kill(pid, signal.SIGWINCH)
                except Exception:
                    pass
_, st = os.waitpid(pid, 0)
sys.exit(os.waitstatus_to_exitcode(st) & 255)
`;
const MAX_TTYS = 3; // um por painel Local
const MAX_INPUT = 32 * 1024;
const ttys = new Map(); // id → processo ajudante

const dim = (v, min, max, dflt) => (Number.isInteger(v) && v >= min && v <= max ? v : dflt);

function ttyStart(res, body, cors) {
  const cols = dim(body?.cols, 20, 500, 100);
  const rows = dim(body?.rows, 5, 200, 30);
  if (ttys.size >= MAX_TTYS) return json(res, 429, { error: 'busy' }, cors);
  const id = randomBytes(12).toString('base64url');
  const child = spawn('python3', ['-c', PTY_PY, String(cols), String(rows), CLAUDE], {
    stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
    cwd,
  });
  ttys.set(id, child);
  res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store', ...cors });
  res.write(JSON.stringify({ type: 'ready', id }) + '\n');
  let stderr = '';
  child.stderr.on('data', (d) => {
    stderr = (stderr + d).slice(-2000);
  });
  child.stdout.on('data', (d) => res.write(JSON.stringify({ type: 'data', d: d.toString('base64') }) + '\n'));
  child.stdin.on('error', () => {});
  child.stdio[3].on('error', () => {});
  let done = false;
  const finish = (message, code) => {
    if (done) return;
    done = true;
    ttys.delete(id);
    if (message) res.write(JSON.stringify({ type: 'bridge_error', message }) + '\n');
    else res.write(JSON.stringify({ type: 'exit', code, error: code ? stderr.trim().slice(-300) : '' }) + '\n');
    res.end();
  };
  child.on('error', (e) => finish(e.code === 'ENOENT' ? 'python3 não encontrado nesta máquina (a aba TTY precisa dele)' : String(e.message)));
  child.on('close', (code) => finish('', code));
  // página fechada ou recarregada: encerra o claude em vez de deixá-lo rodando sem ninguém
  res.on('close', () => {
    if (!done) child.kill('SIGTERM');
  });
}

function ttyControl(res, path, body, cors) {
  const child = typeof body?.id === 'string' ? ttys.get(body.id) : undefined;
  if (!child) return json(res, 404, { error: 'not_found' }, cors);
  if (path === '/tty/input') {
    if (typeof body.data !== 'string' || body.data.length > MAX_INPUT) return json(res, 400, { error: 'invalid_body' }, cors);
    child.stdin.write(body.data);
  } else if (path === '/tty/resize') {
    const cols = dim(body.cols, 20, 500, 0);
    const rows = dim(body.rows, 5, 200, 0);
    if (!cols || !rows) return json(res, 400, { error: 'invalid_body' }, cors);
    child.stdio[3].write(`R ${cols} ${rows}\n`);
  } else if (path === '/tty/stop') {
    child.kill('SIGTERM');
  } else {
    return json(res, 404, { error: 'not_found' }, cors);
  }
  return json(res, 200, { ok: true }, cors);
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
  if (req.method !== 'POST' || !['/tty/start', '/tty/input', '/tty/resize', '/tty/stop'].includes(path)) {
    return json(res, 404, { error: 'not_found' }, cors);
  }

  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return json(res, 400, { error: 'invalid_body' }, cors);
  }
  if (path === '/tty/start') return ttyStart(res, body, cors);
  return ttyControl(res, path, body, cors);
});

server.listen(wantedPort, '127.0.0.1', () => {
  const { port } = server.address();
  console.log(`Ponte local ligada em 127.0.0.1:${port} (diretório: ${cwd})`);
  console.log(`Aceita só o chat em ${origin}.`);
  console.log('');
  console.log(`Código: ${port}.${token}`);
  console.log('');
  console.log('Cole o código no painel "Local" do chat. Ctrl+C encerra a ponte.');
});
