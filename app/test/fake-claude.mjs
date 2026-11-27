#!/usr/bin/env node
// Dublê do `claude` para testar a ponte: ecoa os argumentos e o stdin em eventos stream-json.
import { writeFileSync } from 'node:fs';
let prompt = '';
process.stdin.setEncoding('utf8');
for await (const c of process.stdin) prompt += c;
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
if (prompt === 'dorme') {
  process.on('SIGTERM', () => {
    writeFileSync(process.env.MARK_FILE, 'morto');
    process.exit(143);
  });
  out({ type: 'system', subtype: 'init' });
  setTimeout(() => {}, 30000);
} else if (prompt === 'falha') {
  console.error('boom');
  process.exit(2);
} else {
  out({ type: 'system', subtype: 'init', session_id: '11111111-2222-3333-4444-555555555555', model: 'dublê', args: process.argv.slice(2) });
  out({ type: 'assistant', message: { content: [{ type: 'text', text: `recebi: ${prompt}` }] } });
  out({ type: 'result', is_error: false, total_cost_usd: 0.01 });
}
