import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { config } from './config.ts';

// Identifica o frontend que este servidor entrega. Muda quando algum arquivo web muda (em produção os nomes
// já levam hash do build), então o cliente descobre que houve deploy comparando o valor depois de reconectar.
// Deploy só de servidor não muda o valor, e ninguém é recarregado à toa.
function compute(): string {
  try {
    const root = resolve(config.webDir);
    const h = createHash('sha256');
    for (const rel of readdirSync(root, { recursive: true, encoding: 'utf8' }).sort()) {
      const full = join(root, rel);
      if (!statSync(full).isFile()) continue;
      h.update(rel).update('\0').update(readFileSync(full)).update('\0');
    }
    return h.digest('hex').slice(0, 12);
  } catch {
    return 'unknown'; // sem versão confiável o cliente não recarrega
  }
}

export const WEB_VERSION = compute();
