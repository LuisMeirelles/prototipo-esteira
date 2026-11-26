// Markdown mínimo e seguro: só cria nós DOM com textContent (nunca innerHTML).
// Suporta: ```bloco```, `código`, **negrito**, *itálico*, ~~riscado~~, > citação,
// listas (- / 1.) e links http(s) automáticos. Não há [texto](url) de propósito,
// para que o destino do link sempre seja o que aparece escrito.

const INLINE =
  /`([^`\n]+)`|\*\*(.+?)\*\*|~~(.+?)~~|\*(?=\S)(.+?)(?<=\S)\*|(?<![\w])_(?=\S)(.+?)(?<=\S)_(?![\w])|(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])|(?<![\w@.-])@([a-z0-9_.-]{3,24})/gi;

// contexto da renderização atual: menções resolvidas pelo servidor e o id de quem está vendo
let CTX = { mentions: new Map(), meId: 0 };
const EVERYONE = new Set(['todos', 'all']);

function mention(parent, raw) {
  let t = raw.toLowerCase();
  let rest = '';
  // "@fulano." => menciona "fulano" e deixa o ponto como texto
  for (;;) {
    if (EVERYONE.has(t) || CTX.mentions.has(t)) break;
    if (!/[.-]$/.test(t) || t.length <= 3) {
      parent.append('@' + raw);
      return;
    }
    rest = raw.slice(-1) + rest;
    raw = raw.slice(0, -1);
    t = t.slice(0, -1);
  }
  const e = el('span', '@' + raw);
  const everyone = EVERYONE.has(t);
  e.className = everyone ? 'mention everyone' : CTX.mentions.get(t) === CTX.meId ? 'mention me' : 'mention';
  parent.append(e);
  if (rest) parent.append(rest);
}

function el(tag, text) {
  const e = document.createElement(tag);
  if (text != null) e.textContent = text;
  return e;
}

function link(parent, raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    parent.append(raw);
    return;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    parent.append(raw);
    return;
  }
  const a = el('a', raw);
  a.href = u.href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer nofollow';
  parent.append(a);
}

function inline(text, parent, depth = 0) {
  let last = 0;
  INLINE.lastIndex = 0;
  for (let m; (m = INLINE.exec(text)); ) {
    if (m.index > last) parent.append(text.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[1] != null) parent.append(el('code', m[1]));
    else if (m[6] != null) link(parent, m[6]);
    else if (m[7] != null) mention(parent, m[7]);
    else {
      const inner = m[2] ?? m[3] ?? m[4] ?? m[5];
      const tag = m[2] != null ? 'strong' : m[3] != null ? 's' : 'em';
      const node = el(tag);
      if (depth < 3) inline(inner, node, depth + 1);
      else node.textContent = inner;
      parent.append(node);
    }
  }
  if (last < text.length) parent.append(text.slice(last));
}

function lines(text, parent) {
  text.split('\n').forEach((l, i) => {
    if (i) parent.append(document.createElement('br'));
    inline(l, parent);
  });
}

/** mentions: lista [{username, id}] vinda do servidor; meId: id do usuário logado. */
export function renderMarkdown(src, mentions = [], meId = 0) {
  CTX = { mentions: new Map(mentions.map((m) => [m.username, m.id])), meId };
  const root = document.createDocumentFragment();
  const rows = src.split('\n');
  let i = 0;
  while (i < rows.length) {
    const row = rows[i];

    if (/^```/.test(row)) {
      const buf = [];
      i++;
      while (i < rows.length && !/^```\s*$/.test(rows[i])) buf.push(rows[i++]);
      i++; // fecha o bloco (ou fim do texto)
      const pre = el('pre');
      pre.append(el('code', buf.join('\n')));
      root.append(pre);
      continue;
    }

    if (/^>\s?/.test(row)) {
      const buf = [];
      while (i < rows.length && /^>\s?/.test(rows[i])) buf.push(rows[i++].replace(/^>\s?/, ''));
      const q = el('blockquote');
      lines(buf.join('\n'), q);
      root.append(q);
      continue;
    }

    const ul = /^\s*[-*]\s+/.test(row);
    const ol = /^\s*\d{1,3}[.)]\s+/.test(row);
    if (ul || ol) {
      const list = el(ul ? 'ul' : 'ol');
      const re = ul ? /^\s*[-*]\s+/ : /^\s*\d{1,3}[.)]\s+/;
      while (i < rows.length && re.test(rows[i])) {
        const li = el('li');
        inline(rows[i++].replace(re, ''), li);
        list.append(li);
      }
      root.append(list);
      continue;
    }

    const buf = [];
    while (i < rows.length && rows[i] !== '' && !/^(```|>\s?|\s*[-*]\s+|\s*\d{1,3}[.)]\s+)/.test(rows[i])) buf.push(rows[i++]);
    if (buf.length) {
      const p = el('p');
      lines(buf.join('\n'), p);
      root.append(p);
    } else {
      i++; // linha vazia
    }
  }
  return root;
}
