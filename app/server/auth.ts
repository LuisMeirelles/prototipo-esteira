import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config.ts';
import { allow } from './limits.ts';
import { DUMMY_HASH, hashPassword, verifyPassword } from './password.ts';
import { broadcast } from './hub.ts';
import { createSession, createUser, findUserForLogin, publicUser, RESERVED_USERNAMES } from './store.ts';

export const SESSION_COOKIE = '__Host-sid';
export const USERNAME_RE = /^[a-z0-9_.-]{3,24}$/;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

export function setSessionCookie(reply: FastifyReply, token: string) {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: config.sessionTtlMs / 1000,
  });
}

function safeEqual(a: string, b: string) {
  // compara hashes de tamanho fixo para não vazar o tamanho do código
  const x = Buffer.from(a.padEnd(256).slice(0, 256));
  const y = Buffer.from(b.padEnd(256).slice(0, 256));
  return timingSafeEqual(x, y) && a.length === b.length;
}

export function registerAuth(app: FastifyInstance) {
  const bad = (reply: FastifyReply, error: string, code = 400) => reply.code(code).send({ error });

  app.post('/auth/register', async (req: FastifyRequest, reply) => {
    if (!allow(`reg:${req.ip}`, 6, 10 * 60_000)) return bad(reply, 'rate_limited', 429);
    const b = (req.body ?? {}) as { username?: unknown; password?: unknown; invite?: unknown };

    if (typeof b.invite !== 'string' || !safeEqual(b.invite.trim(), config.inviteCode)) {
      return bad(reply, 'invalid_invite', 403);
    }
    const username = typeof b.username === 'string' ? b.username.trim().toLowerCase() : '';
    if (!USERNAME_RE.test(username) || RESERVED_USERNAMES.has(username)) return bad(reply, 'invalid_username');
    const password = b.password;
    if (typeof password !== 'string' || password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
      return bad(reply, 'invalid_password');
    }
    if (password.toLowerCase() === username) return bad(reply, 'invalid_password');

    const user = createUser(username, await hashPassword(password));
    if (!user) return bad(reply, 'username_taken', 409);
    setSessionCookie(reply, createSession(user.id));
    broadcast({ t: 'user', user: publicUser(user) }); // quem está online passa a poder mencionar a nova pessoa
    return { ok: true };
  });

  app.post('/auth/login', async (req, reply) => {
    if (!allow(`login:${req.ip}`, 10, 60_000)) return bad(reply, 'rate_limited', 429);
    const b = (req.body ?? {}) as { username?: unknown; password?: unknown };
    const username = typeof b.username === 'string' ? b.username.trim().toLowerCase().slice(0, 64) : '';
    const password = typeof b.password === 'string' ? b.password.slice(0, PASSWORD_MAX) : '';
    if (!username || !password) return bad(reply, 'invalid_credentials', 401);
    // limite por conta contra tentativa de adivinhar a senha vindo de vários IPs
    if (!allow(`loginu:${username}`, 20, 15 * 60_000)) return bad(reply, 'rate_limited', 429);

    const user = findUserForLogin(username);
    const ok = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH);
    if (!user || !ok) return bad(reply, 'invalid_credentials', 401);
    setSessionCookie(reply, createSession(user.id));
    return { ok: true };
  });
}

export const randomPassword = () => randomBytes(12).toString('base64url');
