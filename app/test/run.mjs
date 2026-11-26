// Sobe um servidor descartável (porta livre, banco temporário), roda test/smoke.mjs e limpa tudo.
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const freePort = () =>
  new Promise((resolve) => {
    const s = createServer().listen(0, () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

const port = await freePort();
const dir = await mkdtemp(join(tmpdir(), 'chat-test-'));
const env = {
  ...process.env,
  PORT: String(port),
  DATA_DIR: dir,
  PUBLIC_ORIGIN: 'https://10.0.0.5',
  INVITE_CODE: 'convite-secreto-123',
  NODE_ENV: 'test',
};
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.ts'], {
  env,
  stdio: ['ignore', 'ignore', 'inherit'],
});

let code = 1;
try {
  for (let i = 0; i < 50; i++) {
    if (await fetch(`http://127.0.0.1:${port}/`).then((r) => r.ok).catch(() => false)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  code = await new Promise((resolve) => {
    const t = spawn(process.execPath, ['test/smoke.mjs'], { env: { ...env, BASE: `http://127.0.0.1:${port}` }, stdio: 'inherit' });
    t.on('exit', (c) => resolve(c ?? 1));
  });
} finally {
  server.kill();
  await rm(dir, { recursive: true, force: true });
}
process.exit(code);
