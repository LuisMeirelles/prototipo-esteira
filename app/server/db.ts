import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.ts';

mkdirSync(join(config.dataDir, 'media'), { recursive: true });

export const db = new DatabaseSync(join(config.dataDir, 'chat.db'));

// Migração (idempotente): uma enquete antiga, de teste e ligada a mensagens, deixou polls/poll_options/poll_votes
// com outro schema. Só apaga quando o schema é o antigo (polls com message_id), para nunca descartar enquetes atuais.
if (db.prepare("SELECT 1 FROM pragma_table_info('polls') WHERE name = 'message_id'").get()) {
  db.exec('DROP TABLE IF EXISTS poll_votes; DROP TABLE IF EXISTS poll_options; DROP TABLE polls;');
}

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
  PRAGMA synchronous = NORMAL;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL UNIQUE,
    avatar_id TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    body TEXT NOT NULL,
    reply_to INTEGER REFERENCES messages(id),
    created_at INTEGER NOT NULL,
    edited_at INTEGER,
    deleted_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS media (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    kind TEXT NOT NULL CHECK (kind IN ('image', 'avatar')),
    message_id INTEGER REFERENCES messages(id),
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS media_message ON media(message_id);

  CREATE TABLE IF NOT EXISTS reactions (
    message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    emoji TEXT NOT NULL,
    PRIMARY KEY (message_id, user_id, emoji)
  );

  -- enquete atual (a migração acima já removeu as tabelas antigas de mesmo nome, se havia)
  CREATE TABLE IF NOT EXISTS polls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    question TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    closed_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS poll_options (
    poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
    idx INTEGER NOT NULL,
    label TEXT NOT NULL,
    PRIMARY KEY (poll_id, idx)
  );
  -- um voto por usuário: trocar de opção é um UPSERT na mesma linha
  CREATE TABLE IF NOT EXISTS poll_votes (
    poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    option_idx INTEGER NOT NULL,
    PRIMARY KEY (poll_id, user_id)
  );
`);

// Migração (idempotente): bancos que criaram polls antes de existir o encerramento não têm closed_at.
if (!db.prepare("SELECT 1 FROM pragma_table_info('polls') WHERE name = 'closed_at'").get()) {
  db.exec('ALTER TABLE polls ADD COLUMN closed_at INTEGER');
}

export function tx<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
