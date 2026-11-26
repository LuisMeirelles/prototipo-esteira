import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config.ts';
import { broadcast, dropSession, onlineUsers } from './hub.ts';
import { ImageError, processImage } from './images.ts';
import { PASSWORD_MAX, PASSWORD_MIN } from './auth.ts';
import { allow } from './limits.ts';
import { hashPassword, verifyPassword } from './password.ts';
import {
  addMedia,
  createMessage,
  deleteMessage,
  deleteSession,
  deleteUserSessions,
  findUserForLogin,
  setPasswordHash,
  editMessage,
  getMedia,
  getMessageView,
  getUser,
  listMessages,
  listUsers,
  mediaPath,
  publicUser,
  rawMessage,
  renameUser,
  setAvatar,
  toggleReaction,
  type UserRow,
} from './store.ts';

declare module 'fastify' {
  interface FastifyRequest {
    user: UserRow | null;
    sessionToken: string | null;
  }
}

const ID_RE = /^\d{1,12}$/;
const MEDIA_RE = /^[A-Za-z0-9_-]{24}$/;
const EMOJI_RE = /^[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}‍️]{1,16}$/u;

function cleanBody(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > config.maxMessageLen * 2) return null;
  const s = raw
    .replace(/\r\n?/g, '\n')
    // controles (exceto \n e \t) e caracteres bidi que invertem o texto
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f‪-‮⁦-⁩]/g, '')
    .trim();
  return s.length <= config.maxMessageLen ? s : null;
}

const isAdmin = (u: UserRow) => u.is_admin === 1;

export function registerApi(app: FastifyInstance) {
  const me = (req: FastifyRequest, reply: FastifyReply): UserRow | null => {
    if (!req.user) {
      reply.code(401).send({ error: 'unauthorized' });
      return null;
    }
    return req.user;
  };
  const bad = (reply: FastifyReply, error: string, code = 400) => reply.code(code).send({ error });
  const limited = (reply: FastifyReply) => bad(reply, 'rate_limited', 429);

  app.get('/api/me', async (req, reply) => {
    const u = me(req, reply);
    if (!u) return;
    return { user: publicUser(u), admin: isAdmin(u), maxImages: config.maxImagesPerMessage, maxLen: config.maxMessageLen };
  });

  app.post('/api/logout', async (req, reply) => {
    if (req.sessionToken) {
      deleteSession(req.sessionToken);
      dropSession(req.sessionToken);
    }
    reply.clearCookie('__Host-sid', { path: '/' });
    return { ok: true };
  });

  app.get('/api/users', async (req, reply) => {
    if (!me(req, reply)) return;
    return { users: listUsers() };
  });

  /* ---------- mensagens ---------- */

  app.get('/api/messages', async (req, reply) => {
    const u = me(req, reply);
    if (!u) return;
    const q = req.query as { before?: string };
    const before = q.before && ID_RE.test(q.before) ? Number(q.before) : null;
    return { ...listMessages(before, 50), online: onlineUsers() };
  });

  app.post('/api/messages', async (req, reply) => {
    const u = me(req, reply);
    if (!u) return;
    if (!allow(`msg:${u.id}`, 15, 10_000)) return limited(reply);
    const b = (req.body ?? {}) as { body?: unknown; replyTo?: unknown; images?: unknown };

    const body = cleanBody(b.body ?? '');
    if (body === null) return bad(reply, 'invalid_body');
    const images = Array.isArray(b.images) ? b.images : [];
    if (images.length > config.maxImagesPerMessage || !images.every((i) => typeof i === 'string' && MEDIA_RE.test(i))) {
      return bad(reply, 'invalid_images');
    }
    if (new Set(images).size !== images.length) return bad(reply, 'invalid_images');
    if (!body && images.length === 0) return bad(reply, 'empty');

    let replyTo: number | null = null;
    if (b.replyTo != null) {
      if (typeof b.replyTo !== 'number' || !Number.isInteger(b.replyTo)) return bad(reply, 'invalid_reply');
      const target = rawMessage(b.replyTo);
      if (!target || target.deleted_at) return bad(reply, 'invalid_reply');
      replyTo = target.id;
    }

    const id = createMessage(u.id, body, replyTo, images as string[]);
    if (id === null) return bad(reply, 'invalid_images');
    const v = getMessageView(id)!;
    broadcast({ t: 'msg', message: v.message, users: v.users });
    return { id };
  });

  app.patch('/api/messages/:id', async (req, reply) => {
    const u = me(req, reply);
    if (!u) return;
    const { id } = req.params as { id: string };
    if (!ID_RE.test(id)) return bad(reply, 'not_found', 404);
    if (!allow(`edit:${u.id}`, 30, 60_000)) return limited(reply);

    const m = rawMessage(Number(id));
    if (!m || m.deleted_at) return bad(reply, 'not_found', 404);
    if (m.user_id !== u.id) return bad(reply, 'forbidden', 403); // nem admin edita mensagem alheia

    const body = cleanBody((req.body as { body?: unknown } | null)?.body);
    if (body === null) return bad(reply, 'invalid_body');
    const current = getMessageView(m.id)!.message;
    if (!body && current.images.length === 0) return bad(reply, 'empty');

    editMessage(m.id, body);
    const v = getMessageView(m.id)!;
    broadcast({ t: 'edit', message: v.message });
    return { ok: true };
  });

  app.delete('/api/messages/:id', async (req, reply) => {
    const u = me(req, reply);
    if (!u) return;
    const { id } = req.params as { id: string };
    if (!ID_RE.test(id)) return bad(reply, 'not_found', 404);
    if (!allow(`del:${u.id}`, 30, 60_000)) return limited(reply);

    const m = rawMessage(Number(id));
    if (!m || m.deleted_at) return bad(reply, 'not_found', 404);
    if (m.user_id !== u.id && !isAdmin(u)) return bad(reply, 'forbidden', 403);

    deleteMessage(m.id);
    broadcast({ t: 'del', id: m.id });
    return { ok: true };
  });

  const react = (on: boolean) => async (req: FastifyRequest, reply: FastifyReply) => {
    const u = me(req, reply);
    if (!u) return;
    const { id } = req.params as { id: string };
    const emoji = (req.body as { emoji?: unknown } | null)?.emoji;
    if (!ID_RE.test(id)) return bad(reply, 'not_found', 404);
    if (typeof emoji !== 'string' || !EMOJI_RE.test(emoji)) return bad(reply, 'invalid_emoji');
    if (!allow(`react:${u.id}`, 60, 60_000)) return limited(reply);

    const m = rawMessage(Number(id));
    if (!m || m.deleted_at) return bad(reply, 'not_found', 404);
    if (!toggleReaction(m.id, u.id, emoji, on)) return bad(reply, 'too_many_reactions');
    broadcast({ t: 'react', id: m.id, reactions: getMessageView(m.id)!.message.reactions });
    return { ok: true };
  };
  app.put('/api/messages/:id/reactions', react(true));
  app.delete('/api/messages/:id/reactions', react(false));

  /* ---------- upload e perfil ---------- */

  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer', bodyLimit: config.maxImageBytes },
    (_req, body, done) => done(null, body),
  );

  app.post('/api/upload', async (req, reply) => {
    const u = me(req, reply);
    if (!u) return;
    const kind = (req.query as { kind?: string }).kind;
    if (kind !== 'image' && kind !== 'avatar') return bad(reply, 'invalid_kind');
    if (!allow(`upload:${u.id}`, 12, 60_000)) return limited(reply);
    if (!Buffer.isBuffer(req.body)) return bad(reply, 'invalid_body');

    try {
      const img = await processImage(req.body, kind);
      addMedia(img.id, u.id, kind, img.width, img.height);
      if (kind === 'avatar') {
        setAvatar(u.id, img.id);
        const updated = publicUser(getUser(u.id)!);
        broadcast({ t: 'user', user: updated });
        return { user: updated };
      }
      return { id: img.id, w: img.width, h: img.height };
    } catch (e) {
      if (e instanceof ImageError) return bad(reply, 'invalid_image', 415);
      throw e;
    }
  });

  app.patch('/api/profile', async (req, reply) => {
    const u = me(req, reply);
    if (!u) return;
    if (!allow(`profile:${u.id}`, 10, 60_000)) return limited(reply);
    const name = (req.body as { name?: unknown } | null)?.name;
    if (typeof name !== 'string') return bad(reply, 'invalid_name');
    if (!renameUser(u.id, name)) return bad(reply, 'name_unavailable', 409);
    const updated = publicUser(getUser(u.id)!);
    broadcast({ t: 'user', user: updated });
    return { user: updated };
  });

  app.post('/api/password', async (req, reply) => {
    const u = me(req, reply);
    if (!u) return;
    if (!allow(`pw:${u.id}`, 8, 15 * 60_000)) return limited(reply);
    const b = (req.body ?? {}) as { current?: unknown; next?: unknown };
    if (typeof b.current !== 'string' || typeof b.next !== 'string') return bad(reply, 'invalid_password');
    if (b.next.length < PASSWORD_MIN || b.next.length > PASSWORD_MAX || b.next.toLowerCase() === u.username) {
      return bad(reply, 'invalid_password');
    }
    const row = findUserForLogin(u.username)!;
    if (!(await verifyPassword(b.current.slice(0, PASSWORD_MAX), row.password_hash))) {
      return bad(reply, 'wrong_password', 403);
    }
    setPasswordHash(u.id, await hashPassword(b.next));
    deleteUserSessions(u.id, req.sessionToken ?? undefined); // derruba os outros dispositivos
    return { ok: true };
  });

  /* ---------- mídia (autenticada) ---------- */

  app.get('/media/:id', async (req, reply) => {
    const u = me(req, reply);
    if (!u) return;
    const { id } = req.params as { id: string };
    if (!MEDIA_RE.test(id)) return bad(reply, 'not_found', 404);
    const m = getMedia(id);
    if (!m) return bad(reply, 'not_found', 404);
    // upload ainda não anexado a uma mensagem só é visível para quem enviou
    if (m.kind === 'image' && m.message_id === null && m.user_id !== u.id) return bad(reply, 'not_found', 404);

    const path = mediaPath(id);
    const st = await stat(path).catch(() => null);
    if (!st) return bad(reply, 'not_found', 404);
    return reply
      .header('content-type', 'image/webp')
      .header('content-length', st.size)
      .header('cache-control', 'private, max-age=31536000, immutable')
      .header('content-security-policy', "default-src 'none'; sandbox")
      .send(createReadStream(path));
  });
}
