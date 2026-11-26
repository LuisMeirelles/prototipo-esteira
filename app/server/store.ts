import { createHash, randomBytes } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { db, tx } from './db.ts';
import { config } from './config.ts';

export interface UserRow {
  id: number;
  username: string;
  name: string;
  avatar_id: string | null;
  is_admin: number;
}
export interface PublicUser {
  id: number;
  username: string;
  name: string;
  avatar: string | null;
}
export interface MessageView {
  id: number;
  userId: number;
  body: string;
  replyTo: { id: number; userId: number; snippet: string | null } | null;
  createdAt: number;
  editedAt: number | null;
  deleted: boolean;
  mentions: { username: string; id: number }[];
  everyone: boolean;
  images: { id: string; w: number; h: number }[];
  reactions: { emoji: string; userIds: number[] }[];
}

const now = () => Date.now();

/* ---------- nomes ---------- */

// Apenas letras latinas, números e pontuação simples: impede homóglifos (cirílico etc.),
// caracteres de controle e bidi que permitiriam se passar por outra pessoa.
export function cleanName(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(/[^\p{Script=Latin}\p{N} ._'-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 32)
    .trim();
}
const nameKey = (n: string) => n.normalize('NFKC').toLowerCase();

function freeName(base: string, selfId: number | null): string | null {
  const taken = db.prepare('SELECT id FROM users WHERE name_key = ?');
  for (let i = 1; i <= 50; i++) {
    const cand = i === 1 ? base : `${base.slice(0, 29)} ${i}`;
    const row = taken.get(nameKey(cand)) as { id: number } | undefined;
    if (!row || row.id === selfId) return cand;
  }
  return null;
}

/* ---------- usuários ---------- */

export function publicUser(u: UserRow): PublicUser {
  return { id: u.id, username: u.username, name: u.name, avatar: u.avatar_id };
}

const USER_COLS = 'id, username, name, avatar_id, is_admin';

export function getUser(id: number): UserRow | undefined {
  return db.prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`).get(id) as unknown as UserRow | undefined;
}

export function findUserForLogin(username: string) {
  return db.prepare(`SELECT ${USER_COLS}, password_hash FROM users WHERE username = ?`).get(username) as unknown as
    | (UserRow & { password_hash: string })
    | undefined;
}

/** Retorna undefined se o usuário já existe. A primeira conta criada vira admin. */
export function createUser(username: string, passwordHash: string): UserRow | undefined {
  return tx(() => {
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) return undefined;
    const name = freeName(cleanName(username) || 'Usuario', null);
    if (!name) throw new Error('sem nome livre');
    const first = (db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c === 0;
    const r = db
      .prepare(
        'INSERT INTO users (username, password_hash, is_admin, name, name_key, created_at) VALUES (?,?,?,?,?,?)',
      )
      .run(username, passwordHash, first ? 1 : 0, name, nameKey(name), now());
    return getUser(Number(r.lastInsertRowid))!;
  });
}

export function setPasswordHash(userId: number, hash: string) {
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, userId);
}

export function setAdmin(userId: number, on: boolean) {
  db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(on ? 1 : 0, userId);
}

/** Encerra as sessões do usuário, exceto (opcionalmente) a atual. */
export function deleteUserSessions(userId: number, exceptToken?: string) {
  if (exceptToken) {
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(userId, hashToken(exceptToken));
  } else {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }
}

/** Retorna false se o nome já pertence a outra pessoa. */
export function renameUser(id: number, rawName: string): boolean {
  const name = cleanName(rawName);
  if (name.length < 2) return false;
  return tx(() => {
    const taken = db.prepare('SELECT id FROM users WHERE name_key = ?').get(nameKey(name)) as { id: number } | undefined;
    if (taken && taken.id !== id) return false;
    db.prepare('UPDATE users SET name = ?, name_key = ? WHERE id = ?').run(name, nameKey(name), id);
    return true;
  });
}

export function setAvatar(userId: number, mediaId: string): string | null {
  const old = (db.prepare('SELECT avatar_id FROM users WHERE id = ?').get(userId) as { avatar_id: string | null }).avatar_id;
  db.prepare('UPDATE users SET avatar_id = ? WHERE id = ?').run(mediaId, userId);
  if (old) removeMedia(old);
  return old;
}

export function listUsers(): PublicUser[] {
  return (db.prepare(`SELECT ${USER_COLS} FROM users ORDER BY name_key`).all() as unknown as UserRow[]).map(publicUser);
}

/* ---------- sessões ---------- */

const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

export function createSession(userId: number): string {
  const token = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?,?,?,?)').run(
    hashToken(token),
    userId,
    now(),
    now() + config.sessionTtlMs,
  );
  return token;
}

export function sessionUser(token: string): UserRow | undefined {
  return db
    .prepare(
      `SELECT u.id, u.username, u.name, u.avatar_id, u.is_admin FROM sessions s
       JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .get(hashToken(token), now()) as unknown as UserRow | undefined;
}

export function deleteSession(token: string) {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}

export function purgeSessions() {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now());
}

/* ---------- mídia ---------- */

export function mediaPath(id: string) {
  return join(config.dataDir, 'media', `${id}.webp`);
}

export function addMedia(id: string, userId: number, kind: 'image' | 'avatar', w: number, h: number) {
  db.prepare('INSERT INTO media (id, user_id, kind, width, height, created_at) VALUES (?,?,?,?,?,?)').run(
    id,
    userId,
    kind,
    w,
    h,
    now(),
  );
}

export function removeMedia(id: string) {
  db.prepare('DELETE FROM media WHERE id = ?').run(id);
  unlink(mediaPath(id)).catch(() => {});
}

export function getMedia(id: string) {
  return db.prepare('SELECT id, user_id, kind, message_id FROM media WHERE id = ?').get(id) as
    | { id: string; user_id: number; kind: string; message_id: number | null }
    | undefined;
}

/** Remove uploads que nunca foram anexados a uma mensagem. */
export function purgeOrphanMedia() {
  const rows = db
    .prepare("SELECT id FROM media WHERE kind = 'image' AND message_id IS NULL AND created_at < ?")
    .all(now() - 3600_000) as { id: string }[];
  for (const r of rows) removeMedia(r.id);
}

/* ---------- mensagens ---------- */

interface MsgRow {
  id: number;
  user_id: number;
  body: string;
  reply_to: number | null;
  created_at: number;
  edited_at: number | null;
  deleted_at: number | null;
}

const EVERYONE = new Set(['todos', 'all']);
export const RESERVED_USERNAMES = EVERYONE;

/** Tokens @usuario do texto (ignora código). Cada token vira candidatos do mais longo ao mais curto. */
function mentionCandidates(body: string): string[][] {
  const text = body.replace(/```[\s\S]*?```|`[^`\n]+`/g, ' ');
  const out: string[][] = [];
  for (const m of text.matchAll(/(?<![\w@.-])@([a-z0-9_.-]{3,24})/gi)) {
    let t = m[1]!.toLowerCase();
    const cands = [t];
    while (/[.-]$/.test(t) && t.length > 3) {
      t = t.slice(0, -1);
      cands.push(t);
    }
    out.push(cands);
  }
  return out;
}

const ph = (n: number) => Array(n).fill('?').join(',');

function buildViews(rows: MsgRow[]): { messages: MessageView[]; users: Record<number, PublicUser> } {
  if (rows.length === 0) return { messages: [], users: {} };
  const ids = rows.map((r) => r.id);

  const media = db
    .prepare(`SELECT id, message_id, width, height FROM media WHERE message_id IN (${ph(ids.length)}) ORDER BY created_at`)
    .all(...ids) as { id: string; message_id: number; width: number; height: number }[];
  const reacts = db
    .prepare(`SELECT message_id, user_id, emoji FROM reactions WHERE message_id IN (${ph(ids.length)}) ORDER BY rowid`)
    .all(...ids) as { message_id: number; user_id: number; emoji: string }[];

  const replyIds = [...new Set(rows.map((r) => r.reply_to).filter((x): x is number => x != null))];
  const replies = new Map<number, MsgRow>();
  if (replyIds.length) {
    const rr = db
      .prepare('SELECT id, user_id, body, reply_to, created_at, edited_at, deleted_at FROM messages WHERE id IN (' + ph(replyIds.length) + ')')
      .all(...replyIds) as unknown as MsgRow[];
    for (const r of rr) replies.set(r.id, r);
  }

  const perMsg = rows.map((r) => (r.deleted_at ? [] : mentionCandidates(r.body)));
  const allCands = [...new Set(perMsg.flat(2))].filter((c) => !EVERYONE.has(c));
  const byName = new Map<string, number>();
  if (allCands.length) {
    const found = db
      .prepare(`SELECT id, username FROM users WHERE username IN (${ph(allCands.length)})`)
      .all(...allCands) as unknown as { id: number; username: string }[];
    for (const u of found) byName.set(u.username, u.id);
  }

  const userIds = new Set<number>();
  const messages = rows.map((r, idx): MessageView => {
    userIds.add(r.user_id);
    const mentions: { username: string; id: number }[] = [];
    let everyone = false;
    for (const cands of perMsg[idx]!) {
      const hit = cands.find((c) => EVERYONE.has(c) || byName.has(c));
      if (!hit) continue;
      if (EVERYONE.has(hit)) everyone = true;
      else if (!mentions.some((x) => x.username === hit)) mentions.push({ username: hit, id: byName.get(hit)! });
    }
    const deleted = r.deleted_at != null;
    let replyTo: MessageView['replyTo'] = null;
    if (r.reply_to != null) {
      const p = replies.get(r.reply_to);
      if (p) {
        userIds.add(p.user_id);
        replyTo = { id: p.id, userId: p.user_id, snippet: p.deleted_at ? null : p.body.slice(0, 120) };
      }
    }
    const byEmoji = new Map<string, number[]>();
    if (!deleted) {
      for (const x of reacts) {
        if (x.message_id !== r.id) continue;
        const list = byEmoji.get(x.emoji) ?? [];
        list.push(x.user_id);
        byEmoji.set(x.emoji, list);
      }
    }
    return {
      id: r.id,
      userId: r.user_id,
      body: deleted ? '' : r.body,
      replyTo,
      createdAt: r.created_at,
      editedAt: r.edited_at,
      deleted,
      mentions,
      everyone,
      images: deleted ? [] : media.filter((m) => m.message_id === r.id).map((m) => ({ id: m.id, w: m.width, h: m.height })),
      reactions: [...byEmoji].map(([emoji, userIds]) => ({ emoji, userIds })),
    };
  });

  const users: Record<number, PublicUser> = {};
  for (const id of userIds) {
    const u = getUser(id);
    if (u) users[id] = publicUser(u);
  }
  return { messages, users };
}

const MSG_COLS = 'id, user_id, body, reply_to, created_at, edited_at, deleted_at';

export function listMessages(before: number | null, limit: number) {
  const rows = (
    before
      ? db.prepare(`SELECT ${MSG_COLS} FROM messages WHERE id < ? ORDER BY id DESC LIMIT ?`).all(before, limit)
      : db.prepare(`SELECT ${MSG_COLS} FROM messages ORDER BY id DESC LIMIT ?`).all(limit)
  ) as unknown as MsgRow[];
  const out = buildViews(rows.reverse());
  return { ...out, hasMore: rows.length === limit };
}

export function getMessageView(id: number) {
  const row = db.prepare(`SELECT ${MSG_COLS} FROM messages WHERE id = ?`).get(id) as MsgRow | undefined;
  if (!row) return undefined;
  const { messages, users } = buildViews([row]);
  return { message: messages[0]!, users };
}

export function rawMessage(id: number) {
  return db.prepare(`SELECT ${MSG_COLS} FROM messages WHERE id = ?`).get(id) as MsgRow | undefined;
}

/** Retorna null se alguma imagem não pertence ao usuário ou já foi usada. */
export function createMessage(userId: number, body: string, replyTo: number | null, imageIds: string[]): number | null {
  return tx(() => {
    for (const mid of imageIds) {
      const m = db
        .prepare("SELECT 1 FROM media WHERE id = ? AND user_id = ? AND kind = 'image' AND message_id IS NULL")
        .get(mid, userId);
      if (!m) return null;
    }
    const r = db
      .prepare('INSERT INTO messages (user_id, body, reply_to, created_at) VALUES (?,?,?,?)')
      .run(userId, body, replyTo, now());
    const id = Number(r.lastInsertRowid);
    for (const mid of imageIds) db.prepare('UPDATE media SET message_id = ? WHERE id = ?').run(id, mid);
    return id;
  });
}

export function editMessage(id: number, body: string) {
  db.prepare('UPDATE messages SET body = ?, edited_at = ? WHERE id = ? AND deleted_at IS NULL').run(body, now(), id);
}

export function deleteMessage(id: number) {
  const imgs = db.prepare('SELECT id FROM media WHERE message_id = ?').all(id) as { id: string }[];
  tx(() => {
    db.prepare("UPDATE messages SET body = '', deleted_at = ? WHERE id = ?").run(now(), id);
    db.prepare('DELETE FROM reactions WHERE message_id = ?').run(id);
  });
  for (const i of imgs) removeMedia(i.id);
}

/* ---------- reações ---------- */

const MAX_EMOJIS_PER_MESSAGE = 12;
const MAX_REACTIONS_PER_USER = 3;

export function toggleReaction(messageId: number, userId: number, emoji: string, on: boolean): boolean {
  if (on) {
    const distinct = db
      .prepare('SELECT COUNT(DISTINCT emoji) AS c FROM reactions WHERE message_id = ?')
      .get(messageId) as { c: number };
    const has = db.prepare('SELECT 1 FROM reactions WHERE message_id = ? AND emoji = ?').get(messageId, emoji);
    if (!has && distinct.c >= MAX_EMOJIS_PER_MESSAGE) return false;
    // sem teto por usuário, uma pessoa sozinha enche a mensagem de emojis
    const mine = db
      .prepare('SELECT COUNT(*) AS c FROM reactions WHERE message_id = ? AND user_id = ?')
      .get(messageId, userId) as { c: number };
    const mineHas = db
      .prepare('SELECT 1 FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?')
      .get(messageId, userId, emoji);
    if (!mineHas && mine.c >= MAX_REACTIONS_PER_USER) return false;
    db.prepare('INSERT OR IGNORE INTO reactions (message_id, user_id, emoji) VALUES (?,?,?)').run(messageId, userId, emoji);
  } else {
    db.prepare('DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?').run(messageId, userId, emoji);
  }
  return true;
}
