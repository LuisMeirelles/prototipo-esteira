import { resolve } from 'node:path';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import staticFiles from '@fastify/static';
import websocket from '@fastify/websocket';
import { registerApi } from './api.ts';
import { registerAuth, SESSION_COOKIE } from './auth.ts';
import { config, origin } from './config.ts';
import { addClient } from './hub.ts';
import { allow } from './limits.ts';
import { purgeOrphanMedia, purgeSessions, sessionUser } from './store.ts';

const app = Fastify({
  logger: { level: config.isProd ? 'info' : 'debug' },
  trustProxy: true, // o app só é alcançável pelo Caddy (rede interna do Docker)
  bodyLimit: 64 * 1024,
  routerOptions: { maxParamLength: 64 },
});

await app.register(cookie);
await app.register(websocket, { options: { maxPayload: 1024 } });

const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' blob:",
  `connect-src 'self' wss://${origin.host}`,
  "font-src 'self'",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

app.decorateRequest('user', null);
app.decorateRequest('sessionToken', null);

app.addHook('onRequest', async (req, reply) => {
  reply
    .header('content-security-policy', CSP)
    .header('x-content-type-options', 'nosniff')
    .header('x-frame-options', 'DENY')
    .header('referrer-policy', 'no-referrer')
    .header('cross-origin-opener-policy', 'same-origin')
    .header('cross-origin-resource-policy', 'same-origin')
    .header('permissions-policy', 'camera=(), microphone=(), geolocation=()');

  if (!allow(`ip:${req.ip}`, 600, 60_000)) return reply.code(429).send({ error: 'rate_limited' });

  const path = req.url.split('?')[0]!;

  // Anti-CSRF: toda requisição que altera estado precisa de Origin exato + cabeçalho customizado
  // (um formulário de outro site não consegue enviar nenhum dos dois).
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    if (req.headers.origin !== config.origin || req.headers['x-requested-with'] !== 'chat') {
      return reply.code(403).send({ error: 'forbidden' });
    }
  }

  const token = req.cookies[SESSION_COOKIE];
  if (token) {
    const u = sessionUser(token);
    if (u) {
      req.user = u;
      req.sessionToken = token;
    }
  }

  if (path === '/ws') {
    // WebSocket não tem proteção de CORS: checa Origin e sessão antes do upgrade.
    if (req.headers.origin !== config.origin) return reply.code(403).send();
    if (!req.user) return reply.code(401).send();
  }
});

app.setErrorHandler((err: { statusCode?: number }, req, reply) => {
  const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
  if (status === 500) req.log.error(err);
  reply.code(status).send({ error: status === 500 ? 'internal_error' : 'bad_request' });
});

registerAuth(app);
registerApi(app);

app.get('/ws', { websocket: true }, (socket, req) => {
  addClient(socket, req.user!.id, req.sessionToken!);
});

await app.register(staticFiles, {
  root: resolve(config.webDir),
  dotfiles: 'deny',
  index: 'index.html',
  cacheControl: false,
  setHeaders(reply, path) {
    reply.header(
      'cache-control',
      /-[A-Z0-9]{8}\.(js|css)$/.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache',
    );
  },
});

setInterval(() => {
  purgeSessions();
  purgeOrphanMedia();
}, 3600_000).unref();

const stop = () => app.close().then(() => process.exit(0));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

await app.listen({ port: config.port, host: '0.0.0.0' });
