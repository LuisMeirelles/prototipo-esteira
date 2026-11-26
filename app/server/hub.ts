import type { WebSocket } from 'ws';
import { getUser, publicUser, sessionUser, type PublicUser } from './store.ts';

interface Client {
  ws: WebSocket;
  userId: number;
  token: string;
  alive: boolean;
  lastTyping: number;
}

const clients = new Set<Client>();
const MAX_PER_USER = 5;

export function broadcast(msg: unknown, exceptUser?: number) {
  const data = JSON.stringify(msg);
  for (const c of clients) {
    if (c.userId !== exceptUser && c.ws.readyState === 1) c.ws.send(data);
  }
}

export function onlineUsers(): PublicUser[] {
  const out: PublicUser[] = [];
  for (const id of new Set([...clients].map((c) => c.userId))) {
    const u = getUser(id);
    if (u) out.push(publicUser(u));
  }
  return out;
}

export function addClient(ws: WebSocket, userId: number, token: string) {
  const mine = [...clients].filter((c) => c.userId === userId);
  if (mine.length >= MAX_PER_USER) mine[0]!.ws.close(4008, 'too many connections');

  const c: Client = { ws, userId, token, alive: true, lastTyping: 0 };
  const wasOnline = mine.length > 0;
  clients.add(c);
  ws.send(JSON.stringify({ t: 'presence', online: onlineUsers() }));
  if (!wasOnline) broadcast({ t: 'presence', online: onlineUsers() });

  ws.on('pong', () => (c.alive = true));
  ws.on('message', (raw, isBinary) => {
    if (isBinary) return ws.close(1003);
    let m: { t?: unknown };
    try {
      m = JSON.parse(raw.toString());
    } catch {
      return ws.close(1003);
    }
    // único evento aceito do cliente
    if (m.t === 'typing' && Date.now() - c.lastTyping > 2000) {
      c.lastTyping = Date.now();
      broadcast({ t: 'typing', userId }, userId);
    }
  });
  ws.on('close', () => {
    clients.delete(c);
    if (![...clients].some((x) => x.userId === userId)) broadcast({ t: 'presence', online: onlineUsers() });
  });
}

/** Fecha as conexões de uma sessão (logout). */
export function dropSession(token: string) {
  for (const c of clients) if (c.token === token) c.ws.close(4001, 'logout');
}

// keepalive + revalida a sessão (expirou ou foi revogada => derruba o socket)
setInterval(() => {
  for (const c of clients) {
    if (!c.alive || !sessionUser(c.token)) {
      c.ws.terminate();
      continue;
    }
    c.alive = false;
    c.ws.ping();
  }
}, 30_000).unref();
