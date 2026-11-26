// Administração local: node cli.mjs <comando> <usuario>
//   reset-password <usuario>   gera uma senha temporária e encerra as sessões
//   promote <usuario>          torna admin
//   demote <usuario>           remove admin
//   list                       lista usuários
import { db } from './db.ts';
import { randomPassword } from './auth.ts';
import { hashPassword } from './password.ts';
import { deleteUserSessions, setAdmin, setPasswordHash } from './store.ts';

const [cmd, arg] = process.argv.slice(2);

if (cmd === 'list') {
  for (const u of db.prepare('SELECT username, name, is_admin FROM users ORDER BY id').all() as any[]) {
    console.log(`${u.username}\t${u.name}${u.is_admin ? '\t(admin)' : ''}`);
  }
} else if (['reset-password', 'promote', 'demote'].includes(cmd ?? '') && arg) {
  const u = db.prepare('SELECT id FROM users WHERE username = ?').get(arg.toLowerCase()) as { id: number } | undefined;
  if (!u) {
    console.error(`Usuário não encontrado: ${arg}`);
    process.exit(1);
  }
  if (cmd === 'reset-password') {
    const pw = randomPassword();
    setPasswordHash(u.id, await hashPassword(pw));
    deleteUserSessions(u.id);
    console.log(`Senha temporária de ${arg}: ${pw}\nPeça para a pessoa trocá-la no perfil.`);
  } else {
    setAdmin(u.id, cmd === 'promote');
    console.log(`${arg}: ${cmd === 'promote' ? 'agora é admin' : 'não é mais admin'}`);
  }
} else {
  console.error('Uso: cli <reset-password|promote|demote> <usuario> | list');
  process.exit(1);
}
