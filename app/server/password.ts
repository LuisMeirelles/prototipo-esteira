import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 32;

// scrypt é caro de propósito; limita quantos rodam ao mesmo tempo para não travar o servidor
let running = 0;
const waiting: (() => void)[] = [];
async function slot() {
  if (running >= 4) await new Promise<void>((r) => waiting.push(r));
  running++;
}
function release() {
  running--;
  waiting.shift()?.();
}

function derive(password: string, salt: Buffer, n = N, r = R, p = P): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password.normalize('NFKC'), salt, KEYLEN, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );
}

export async function hashPassword(password: string): Promise<string> {
  await slot();
  try {
    const salt = randomBytes(16);
    const key = await derive(password, salt);
    return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
  } finally {
    release();
  }
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !n || !r || !p || !salt || !hash) return false;
  await slot();
  try {
    const expected = Buffer.from(hash, 'base64');
    const key = await derive(password, Buffer.from(salt, 'base64'), Number(n), Number(r), Number(p));
    return key.length === expected.length && timingSafeEqual(key, expected);
  } finally {
    release();
  }
}

// hash falso: usuário inexistente gasta o mesmo tempo que um existente (não revela quais usernames existem)
export const DUMMY_HASH = `scrypt$${N}$${R}$${P}$${Buffer.alloc(16).toString('base64')}$${Buffer.alloc(KEYLEN).toString('base64')}`;
