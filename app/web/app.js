import { renderMarkdown } from './md.js';
import { norm, searchEmojis } from './emojis.js';
import { SPINNER, startFakePanes } from './fake.js';

const $ = (id) => document.getElementById(id);
const MAX_IMG_BYTES = 6 * 1024 * 1024;
const IMG_MAX = 240;
const BASE_TITLE = 'protótipo esteira';
// cores de terminal para os nomes (escolhida pelo id, estável entre sessões)
const NAME_COLORS = ['#56a8f5', '#6aab73', '#e0b95a', '#cf8e6d', '#c77dbb', '#2fbcb4', '#f2777a', '#9d8cf0'];

const state = {
  me: null,
  admin: false,
  maxImages: 4,
  users: new Map(),
  messages: [],
  els: new Map(),
  replyTo: null,
  pending: [],
  revealed: new Set(),
  hasMore: false,
  loadingOlder: false,
  ws: null,
  wsOk: false,
  wsTries: 0,
  typing: new Map(),
  lastTypingSent: 0,
  unread: 0,
  unreadMention: 0,
  notif: 'all',
  poll: null,
};
let stopFake = null;

/* ---------- utilidades ---------- */

class ApiError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

async function api(method, path, body, raw) {
  const opts = { method, headers: { 'X-Requested-With': 'chat' } };
  if (raw) {
    opts.body = raw;
    opts.headers['Content-Type'] = 'application/octet-stream';
  } else if (body !== undefined) {
    opts.body = JSON.stringify(body);
    opts.headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && state.me) showLogin();
  if (!res.ok) throw new ApiError(res.status, data.error || 'error');
  return data;
}

const ERRORS = {
  rate_limited: 'calma: muitas ações seguidas, tente de novo em instantes',
  invalid_image: 'imagem inválida ou formato não suportado (PNG, JPG, GIF ou WebP)',
  name_unavailable: 'nome indisponível: use letras, números e pelo menos 2 caracteres',
  forbidden: 'você não pode fazer isso',
  poll_exists: 'já existe uma enquete ativa: abra a aba ou peça para encerrá-la',
  invalid_poll: 'use uma pergunta (até 140) e de 2 a 4 opções diferentes (até 60 caracteres)',
  invalid_option: 'opção inválida',
  not_found: 'a enquete não existe mais',
  poll_closed: 'a enquete já foi encerrada',
  poll_open: 'encerre a enquete antes de removê-la',
  too_many_reactions: 'limite de reações atingido nesta mensagem',
  invalid_emoji: 'use um único emoji',
};
let toastTimer;
function toast(err) {
  const msg = typeof err === 'string' ? err : (err instanceof ApiError && ERRORS[err.code]) || 'algo deu errado';
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 4000);
}

const timeFmt = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
const dayKey = (ts) => new Date(ts).toDateString();
function dayLabel(ts) {
  const d = new Date(ts);
  if (d.toDateString() === new Date().toDateString()) return 'hoje';
  if (d.toDateString() === new Date(Date.now() - 86400000).toDateString()) return 'ontem';
  return dayFmt.format(d);
}

function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/* ---------- usuários / avatar ---------- */

const userOf = (id) => state.users.get(id) ?? { id, name: 'alguém', avatar: null };
const remember = (u) => u && state.users.set(u.id, u);
const colorOf = (id) => NAME_COLORS[id % NAME_COLORS.length];

function fillAvatar(span, user) {
  span.replaceChildren();
  span.style.background = colorOf(user.id);
  if (user.avatar) {
    const img = new Image();
    img.alt = '';
    img.src = `/media/${user.avatar}`;
    img.addEventListener('error', () => span.replaceChildren(document.createTextNode(user.name.slice(0, 1).toUpperCase())));
    span.append(img);
  } else {
    span.textContent = user.name.slice(0, 1).toUpperCase();
  }
}
function avatarEl(user, cls = '') {
  const s = h('span', `av ${cls}`.trim());
  fillAvatar(s, user);
  return s;
}

/* ---------- renderização de mensagens ---------- */

function imageEl(img) {
  const s = Math.min(IMG_MAX / img.w, IMG_MAX / img.h, 1);
  const b = h('button', 'spoiler');
  b.type = 'button';
  b.style.width = `${Math.max(48, Math.round(img.w * s))}px`;
  b.style.maxWidth = '100%';
  b.style.aspectRatio = `${img.w} / ${img.h}`;
  const i = new Image();
  i.alt = 'imagem enviada';
  i.src = `/media/${img.id}`;
  i.loading = 'lazy';
  i.draggable = false;
  b.append(i, h('span', 'label', '▒ SPOILER ▒'));
  const reveal = () => b.classList.add('revealed');
  if (state.revealed.has(img.id)) reveal();
  else b.setAttribute('aria-label', 'imagem escondida (spoiler): clique para revelar');
  b.addEventListener('click', () => {
    if (!b.classList.contains('revealed')) {
      state.revealed.add(img.id);
      reveal();
      b.removeAttribute('aria-label');
    } else {
      const lb = $('lightbox');
      lb.querySelector('img').src = `/media/${img.id}`;
      lb.hidden = false;
    }
  });
  return b;
}

function actBtn(label, title, fn) {
  const b = h('button', 'act', label);
  b.type = 'button';
  b.title = title;
  b.setAttribute('aria-label', title);
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    fn();
  });
  return b;
}

function buildMsg(m, prev) {
  const wrap = h('div', 'mwrap');
  wrap.dataset.id = m.id;
  if (!prev || dayKey(prev.createdAt) !== dayKey(m.createdAt)) wrap.append(h('div', 'day', `── ${dayLabel(m.createdAt)} ──`));

  const u = userOf(m.userId);
  const first = !prev || prev.userId !== m.userId || m.createdAt - prev.createdAt > 5 * 60000 || !!m.replyTo || !!wrap.firstChild;
  const row = h('div', first ? 'msg first' : 'msg');
  if (!m.deleted && mentionsMe(m)) row.classList.add('mentioned');

  if (first) {
    const head = h('div', 'mhead');
    const name = h('span', 'name', u.name);
    name.style.color = colorOf(u.id);
    head.append(h('span', 'chev', '❯'), avatarEl(u), name, h('span', 'time', timeFmt.format(m.createdAt)));
    if (m.editedAt && !m.deleted) head.append(h('span', 'edited', '(editado)'));
    row.append(head);
  }

  if (m.replyTo) {
    const ref = h('div', 'reply-ref');
    ref.append(h('span', null, `↪ ${userOf(m.replyTo.userId).name}: ${m.replyTo.snippet ?? 'mensagem apagada'}`));
    ref.addEventListener('click', () => scrollToMsg(m.replyTo.id));
    row.append(ref);
  }

  if (m.deleted) {
    row.append(h('div', 'body deleted', '(mensagem apagada)'));
  } else {
    if (m.body) {
      const body = h('div', 'body');
      body.append(renderMarkdown(m.body, m.mentions, state.me.id));
      row.append(body);
    }
    if (m.images.length) {
      const box = h('div', 'images');
      for (const img of m.images) box.append(imageEl(img));
      row.append(box);
    }
    const acts = h('div', 'acts');
    acts.append(actBtn('↩', 'responder', () => setReply(m)));
    if (m.userId === state.me.id) acts.append(actBtn('✎', 'editar', () => startEdit(m, wrap)));
    if (m.userId === state.me.id || state.admin) acts.append(actBtn('✕', 'apagar', () => removeMsg(m)));
    row.append(acts);
    row.addEventListener('dblclick', (e) => {
      if (!e.target.closest('button, a, textarea')) setReply(m);
    });
  }
  wrap.append(row);
  return wrap;
}

function rebuild(id) {
  const i = state.messages.findIndex((x) => x.id === id);
  const old = state.els.get(id);
  if (i < 0 || !old) return;
  const el = buildMsg(state.messages[i], state.messages[i - 1]);
  old.replaceWith(el);
  state.els.set(id, el);
}

const scroller = $('scroller');
const list = $('messages');
const nearBottom = () => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 60;
const toBottom = () => {
  scroller.scrollTop = scroller.scrollHeight;
};

function appendMessage(m) {
  if (state.els.has(m.id)) return;
  const stick = nearBottom() || m.userId === state.me.id;
  const el = buildMsg(m, state.messages.at(-1));
  state.messages.push(m);
  state.els.set(m.id, el);
  list.append(el);
  if (stick) {
    toBottom();
    hideJump();
  } else {
    $('jump').hidden = false;
  }
  renderStatus();
  notifyIfNeeded(m);
}

function hideJump() {
  $('jump').hidden = true;
}
$('jump').addEventListener('click', () => {
  toBottom();
  hideJump();
});

function updateTitle() {
  document.title = state.unread ? `(${state.unreadMention ? '@' : ''}${state.unread}) ${BASE_TITLE}` : BASE_TITLE;
}
function clearUnread() {
  state.unread = state.unreadMention = 0;
  updateTitle();
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) clearUnread();
});
window.addEventListener('focus', clearUnread);

function scrollToMsg(id) {
  const el = state.els.get(id);
  if (!el) return toast('mensagem mais antiga: role para cima para carregar');
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  const row = el.querySelector('.msg');
  row.classList.remove('flash');
  void row.offsetWidth;
  row.classList.add('flash');
}

async function loadOlder() {
  if (state.loadingOlder || !state.hasMore || !state.messages.length) return;
  state.loadingOlder = true;
  try {
    const data = await api('GET', `/api/messages?before=${state.messages[0].id}`);
    Object.values(data.users).forEach(remember);
    state.hasMore = data.hasMore;
    const oldFirst = state.messages[0];
    const before = scroller.scrollHeight;
    const frag = document.createDocumentFragment();
    data.messages.forEach((m, i) => {
      const el = buildMsg(m, data.messages[i - 1]);
      state.els.set(m.id, el);
      frag.append(el);
    });
    list.prepend(frag);
    state.messages.unshift(...data.messages);
    rebuild(oldFirst.id);
    scroller.scrollTop += scroller.scrollHeight - before;
    renderStatus();
  } catch (e) {
    toast(e);
  } finally {
    state.loadingOlder = false;
  }
}
scroller.addEventListener('scroll', () => {
  if (nearBottom()) hideJump();
  if (scroller.scrollTop < 120) loadOlder();
});

/* ---------- ações em mensagens ---------- */

async function removeMsg(m) {
  if (!confirm('apagar esta mensagem?')) return;
  try {
    await api('DELETE', `/api/messages/${m.id}`);
  } catch (e) {
    toast(e);
  }
}

function startEdit(m, wrap) {
  const body = wrap.querySelector('.body');
  const box = h('div', 'edit-box');
  const ta = h('textarea');
  ta.value = m.body;
  ta.maxLength = 4000;
  ta.spellcheck = false;
  const row = h('div', 'edit-row');
  const save = h('button', 'link', '[salvar]');
  const cancel = h('button', 'link', '[cancelar]');
  save.type = cancel.type = 'button';
  row.append(h('span', 'dim', 'enter salva · esc cancela'), save, cancel);
  box.append(ta, row);
  if (body) body.replaceWith(box);
  else wrap.querySelector('.msg').append(box);
  ta.focus();
  const doSave = async () => {
    try {
      await api('PATCH', `/api/messages/${m.id}`, { body: ta.value });
      rebuild(m.id);
    } catch (e) {
      toast(e);
    }
  };
  cancel.addEventListener('click', () => rebuild(m.id));
  save.addEventListener('click', doSave);
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') rebuild(m.id);
    else if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      doSave();
    }
  });
}

/* ---------- prompt (composer) ---------- */

const input = $('input');

function setReply(m) {
  state.replyTo = m;
  $('reply-text').textContent = `↪ respondendo a ${userOf(m.userId).name}: ${m.body.slice(0, 70) || '[imagem]'}`;
  $('reply-bar').hidden = false;
  input.focus();
}
function clearReply() {
  state.replyTo = null;
  $('reply-bar').hidden = true;
}
$('reply-cancel').addEventListener('click', clearReply);

const canSend = () => !state.pending.some((p) => p.uploading) && (input.value.trim() || state.pending.some((p) => p.id));
function autosize() {
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
}
input.addEventListener('input', () => {
  autosize();
  updateSuggest();
  if (Date.now() - state.lastTypingSent > 2500 && state.ws?.readyState === 1 && input.value && !input.value.startsWith('/')) {
    state.lastTypingSent = Date.now();
    state.ws.send('{"t":"typing"}');
  }
});
input.addEventListener('click', updateSuggest);
input.addEventListener('blur', closeSuggest);
input.addEventListener('keydown', (e) => {
  if (sugg.type && !e.isComposing && suggestKey(e)) return;
  if (e.key === 'Escape' && state.replyTo) return clearReply();
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    send();
  }
});

function renderPreviews() {
  const box = $('previews');
  box.replaceChildren();
  box.hidden = state.pending.length === 0;
  state.pending.forEach((p, i) => {
    const d = h('span', p.uploading ? 'preview loading' : 'preview');
    const img = new Image();
    img.alt = '';
    img.src = p.url;
    const x = h('button', 'link', '✕');
    x.type = 'button';
    x.setAttribute('aria-label', 'remover imagem');
    x.addEventListener('click', () => {
      URL.revokeObjectURL(p.url);
      state.pending = state.pending.filter((q) => q !== p);
      renderPreviews();
    });
    d.append(img, h('span', null, p.uploading ? `img ${i + 1} enviando…` : `img ${i + 1}`), x);
    box.append(d);
  });
}

async function addFiles(files) {
  for (const file of files) {
    if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) {
      toast('apenas imagens PNG, JPG, GIF ou WebP');
      continue;
    }
    if (file.size > MAX_IMG_BYTES) {
      toast('imagem acima de 6 MB');
      continue;
    }
    if (state.pending.length >= state.maxImages) {
      toast(`no máximo ${state.maxImages} imagens por mensagem`);
      break;
    }
    const p = { url: URL.createObjectURL(file), uploading: true, id: null };
    state.pending.push(p);
    renderPreviews();
    try {
      p.id = (await api('POST', '/api/upload?kind=image', undefined, file)).id;
    } catch (e) {
      state.pending = state.pending.filter((q) => q !== p);
      URL.revokeObjectURL(p.url);
      toast(e);
    }
    p.uploading = false;
    renderPreviews();
  }
}
$('file-input').addEventListener('change', (e) => {
  addFiles([...e.target.files]);
  e.target.value = '';
});
input.addEventListener('paste', (e) => {
  const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
  if (files.length) {
    e.preventDefault();
    addFiles(files);
  }
});
const composer = $('composer');
for (const ev of ['dragenter', 'dragover']) {
  document.addEventListener(ev, (e) => {
    if (e.dataTransfer?.types.includes('Files')) {
      e.preventDefault();
      composer.classList.add('drag');
    }
  });
}
document.addEventListener('dragleave', (e) => {
  if (!e.relatedTarget) composer.classList.remove('drag');
});
document.addEventListener('drop', (e) => {
  e.preventDefault();
  composer.classList.remove('drag');
  addFiles([...(e.dataTransfer?.files ?? [])]);
});

let sending = false;
async function send() {
  const cmd = /^\/([a-zà-ú]+)\s*$/i.exec(input.value);
  if (cmd) {
    const c = COMMANDS.find((x) => x.name === cmd[1].toLowerCase());
    if (!c) return toast(`comando desconhecido: /${cmd[1]} (digite / para ver a lista)`);
    if (c.run) {
      input.value = '';
      autosize();
      return c.run();
    }
  }
  if (sending || !canSend()) return;
  sending = true;
  try {
    await api('POST', '/api/messages', {
      body: input.value,
      replyTo: state.replyTo?.id ?? null,
      images: state.pending.filter((p) => p.id).map((p) => p.id),
    });
    input.value = '';
    closeSuggest();
    autosize();
    state.pending.forEach((p) => URL.revokeObjectURL(p.url));
    state.pending = [];
    renderPreviews();
    clearReply();
  } catch (e) {
    toast(e);
  } finally {
    sending = false;
  }
}

/* ---------- digitando / status ---------- */

function renderTyping() {
  const names = [...state.typing.keys()].map((id) => userOf(id).name);
  const t = $('typing');
  t.hidden = names.length === 0;
  $('typing-text').textContent =
    names.length === 1
      ? ` ${names[0]} digitando…`
      : names.length === 2
        ? ` ${names[0]} e ${names[1]} digitando…`
        : names.length
          ? ' várias pessoas digitando…'
          : '';
}
let spinI = 0;
setInterval(() => {
  if (!$('typing').hidden && !document.hidden && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    $('typing-spin').textContent = SPINNER[++spinI % SPINNER.length];
  }
}, 130);

function renderStatus() {
  const n = state.messages.length;
  $('status').textContent = `▸ ${n} ${n === 1 ? 'mensagem' : 'mensagens'}${state.hasMore ? '+' : ''} · ${state.wsOk ? 'conectado' : 'reconectando…'}`;
}
const NOTIF_LABEL = { all: 'todas', mentions: 'só menções', off: 'off' };
function renderFooter() {
  $('footer').textContent = `Default · ${state.me.name} · #geral · notif: ${NOTIF_LABEL[state.notif]}`;
  $('cwd').textContent = `~/chat/${state.me.name.toLowerCase().replace(/\s+/g, '-')}`;
}

/* ---------- WebSocket ---------- */

function applyUserUpdate(u) {
  remember(u);
  if (u.id === state.me.id) {
    state.me = u;
    renderFooter();
  }
  for (const m of state.messages) {
    if (m.userId === u.id || m.replyTo?.userId === u.id) rebuild(m.id);
  }
}

function onWsMessage(ev) {
  let e;
  try {
    e = JSON.parse(ev.data);
  } catch {
    return;
  }
  switch (e.t) {
    case 'msg':
      Object.values(e.users).forEach(remember);
      state.typing.delete(e.message.userId);
      renderTyping();
      appendMessage(e.message);
      break;
    case 'edit': {
      const i = state.messages.findIndex((m) => m.id === e.message.id);
      if (i >= 0) {
        state.messages[i] = e.message;
        rebuild(e.message.id);
      }
      break;
    }
    case 'del': {
      const m = state.messages.find((x) => x.id === e.id);
      if (m) {
        Object.assign(m, { body: '', images: [], reactions: [], deleted: true });
        rebuild(m.id);
      }
      for (const x of state.messages) {
        if (x.replyTo?.id === e.id) {
          x.replyTo.snippet = null;
          rebuild(x.id);
        }
      }
      if (state.replyTo?.id === e.id) clearReply();
      break;
    }
    case 'user':
      applyUserUpdate(e.user);
      break;
    case 'poll':
      setPoll(e.poll);
      break;
    case 'typing':
      clearTimeout(state.typing.get(e.userId));
      state.typing.set(
        e.userId,
        setTimeout(() => {
          state.typing.delete(e.userId);
          renderTyping();
        }, 3500),
      );
      renderTyping();
      break;
    // 'presence' e 'react' continuam existindo no servidor, mas esta interface não os usa
  }
}

function connect() {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  state.ws = ws;
  ws.addEventListener('open', async () => {
    const reconnected = state.wsTries > 0;
    state.wsOk = true;
    state.wsTries = 0;
    renderStatus();
    if (reconnected) {
      await loadHistory(); // recupera o que perdeu enquanto offline
      await loadPoll();
    }
  });
  ws.addEventListener('message', onWsMessage);
  ws.addEventListener('close', (e) => {
    state.wsOk = false;
    renderStatus();
    if (!state.me || e.code === 4001) return;
    state.wsTries++;
    setTimeout(connect, Math.min(1000 * 2 ** state.wsTries, 15000));
  });
}

async function loadHistory() {
  const data = await api('GET', '/api/messages');
  Object.values(data.users).forEach(remember);
  state.hasMore = data.hasMore;
  state.messages = [];
  state.els.clear();
  list.replaceChildren();
  for (const m of data.messages) {
    const el = buildMsg(m, state.messages.at(-1));
    state.messages.push(m);
    state.els.set(m.id, el);
    list.append(el);
  }
  renderStatus();
  toBottom();
  hideJump();
}

/* ---------- perfil e sessão ---------- */

const modal = $('profile-modal');
function openProfile() {
  fillAvatar($('profile-avatar'), state.me);
  $('profile-name').value = state.me.name;
  $('profile-error').hidden = true;
  modal.hidden = false;
  $('profile-name').focus();
}
$('profile-close').addEventListener('click', () => (modal.hidden = true));
modal.addEventListener('mousedown', (e) => {
  if (e.target === modal) modal.hidden = true;
});
$('avatar-btn').addEventListener('click', () => $('avatar-input').click());
$('avatar-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (file.size > MAX_IMG_BYTES) return toast('imagem acima de 6 MB');
  try {
    const r = await api('POST', '/api/upload?kind=avatar', undefined, file);
    applyUserUpdate(r.user);
    fillAvatar($('profile-avatar'), state.me);
  } catch (err) {
    toast(err);
  }
});
$('profile-save').addEventListener('click', async () => {
  const err = $('profile-error');
  err.hidden = true;
  try {
    const r = await api('PATCH', '/api/profile', { name: $('profile-name').value });
    applyUserUpdate(r.user);
    modal.hidden = true;
    input.focus();
  } catch (e) {
    err.textContent = (e instanceof ApiError && ERRORS[e.code]) || 'não foi possível salvar';
    err.hidden = false;
  }
});
$('profile-name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('profile-save').click();
});

async function logout() {
  try {
    await api('POST', '/api/logout');
  } catch {}
  location.reload();
}

$('lightbox').addEventListener('click', () => ($('lightbox').hidden = true));
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  $('lightbox').hidden = true;
  modal.hidden = true;
});

/* ---------- comandos (/), menções (@) e emoji (/emoji) ---------- */

const mentionsMe = (m) => m.everyone || m.mentions.some((x) => x.id === state.me.id);

const COMMANDS = [
  { name: 'emoji', desc: 'abre os emojis (ex.: /emoji coração)', run: null },
  { name: 'img', desc: 'anexa uma imagem (ou cole / arraste)', run: () => $('file-input').click() },
  { name: 'enquete', desc: 'cria uma enquete (ou abre a ativa)', run: openPollCreate },
  { name: 'perfil', desc: 'nome, foto e senha', run: openProfile },
  { name: 'notif', desc: 'notificações: todas · só menções · off', run: cycleNotif },
  { name: 'sair', desc: 'encerra a sessão', run: logout },
];

const sugg = { type: null, start: 0, end: 0, items: [], index: 0 };
const cmdPop = $('cmd-pop');
const mentionPop = $('mention-pop');
const emojiPop = $('emoji-pop');
const EMOJI_COLS = 8;

function closeSuggest() {
  sugg.type = null;
  cmdPop.hidden = mentionPop.hidden = emojiPop.hidden = true;
}

function updateSuggest() {
  const pos = input.selectionStart;
  if (pos !== input.selectionEnd) return closeSuggest();
  const before = input.value.slice(0, pos);

  // "/emoji" ou "/emoji coração": seletor com busca
  let m = /(^|\s)\/emoji(?:[ \t]+(\S*))?$/i.exec(before);
  if (m) {
    const items = searchEmojis(m[2] ?? '').slice(0, 160);
    Object.assign(sugg, { type: 'emoji', start: pos - (m[0].length - m[1].length), end: pos, items, index: 0 });
    cmdPop.hidden = mentionPop.hidden = true;
    return renderEmojiPop();
  }

  // "/": lista de comandos
  m = /^\/([a-zà-ú]*)$/i.exec(before);
  if (m) {
    const items = COMMANDS.filter((c) => c.name.startsWith(m[1].toLowerCase()));
    if (items.length) {
      Object.assign(sugg, { type: 'cmd', start: 0, end: pos, items, index: 0 });
      emojiPop.hidden = mentionPop.hidden = true;
      return renderCmdPop();
    }
  }

  // "@fu": sugere pessoas
  m = /(^|[\s(])@([a-z0-9_.-]{0,24})$/i.exec(before);
  if (m) {
    const q = norm(m[2]);
    const items = [...state.users.values()]
      .filter((u) => u.id !== state.me.id && (u.username.startsWith(q) || norm(u.name).includes(q)))
      .slice(0, 6)
      .map((u) => ({ username: u.username, name: u.name, user: u }));
    if ('todos'.startsWith(q)) items.push({ username: 'todos', name: 'todos — avisa a sala inteira', user: null });
    if (items.length) {
      Object.assign(sugg, { type: 'mention', start: pos - m[2].length - 1, end: pos, items, index: 0 });
      emojiPop.hidden = cmdPop.hidden = true;
      return renderMentionPop();
    }
  }
  closeSuggest();
}

function listRow(i, ...kids) {
  const row = h('div', i === sugg.index ? 'item active' : 'item');
  row.append(...kids);
  row.addEventListener('mousedown', (e) => {
    e.preventDefault();
    acceptSuggest(i);
  });
  return row;
}

function renderCmdPop() {
  cmdPop.replaceChildren();
  sugg.items.forEach((c, i) => cmdPop.append(listRow(i, h('span', 'item-name', `/${c.name}`), h('span', 'item-sub', c.desc))));
  cmdPop.hidden = false;
}

function renderMentionPop() {
  mentionPop.replaceChildren();
  sugg.items.forEach((it, i) => {
    mentionPop.append(listRow(i, it.user ? avatarEl(it.user) : h('span', 'av', '@'), h('span', 'item-name', it.name), h('span', 'item-sub', `@${it.username}`)));
  });
  mentionPop.hidden = false;
}

function renderEmojiPop() {
  emojiPop.replaceChildren();
  emojiPop.append(h('div', 'pop-head', '/emoji · digite para filtrar (ex.: /emoji coração) · setas navegam · ↵ insere'));
  if (!sugg.items.length) emojiPop.append(h('div', 'pop-empty', 'nenhum emoji encontrado'));
  sugg.items.forEach((it, i) => {
    const b = h('button', i === sugg.index ? 'active' : '', it.char);
    b.type = 'button';
    b.tabIndex = -1;
    b.addEventListener('mousedown', (e) => {
      e.preventDefault();
      acceptSuggest(i);
    });
    emojiPop.append(b);
  });
  emojiPop.hidden = false;
  emojiPop.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
}

function acceptSuggest(i) {
  const it = sugg.items[i];
  if (!it) return;
  const type = sugg.type;
  if (type === 'cmd') {
    closeSuggest();
    if (it.run) {
      input.value = '';
      autosize();
      return it.run();
    }
    input.setRangeText('/emoji ', 0, input.value.length, 'end'); // abre o seletor
    input.focus();
    return updateSuggest();
  }
  input.setRangeText(type === 'emoji' ? it.char : `@${it.username} `, sugg.start, sugg.end, 'end');
  closeSuggest();
  input.focus();
  autosize();
}

/** Teclado com o popup aberto. Retorna true se a tecla foi consumida. */
function suggestKey(e) {
  const emoji = sugg.type === 'emoji';
  const n = sugg.items.length;
  const rerender = () => (emoji ? renderEmojiPop() : sugg.type === 'cmd' ? renderCmdPop() : renderMentionPop());
  const move = (d) => {
    if (!n) return;
    sugg.index = Math.max(0, Math.min(n - 1, sugg.index + d));
    rerender();
  };
  switch (e.key) {
    case 'ArrowDown': move(emoji ? EMOJI_COLS : 1); break;
    case 'ArrowUp': move(emoji ? -EMOJI_COLS : -1); break;
    case 'ArrowRight': if (!emoji) return closeSuggest(), false; move(1); break;
    case 'ArrowLeft': if (!emoji) return closeSuggest(), false; move(-1); break;
    case 'Enter':
    case 'Tab':
      if (!n) return false;
      acceptSuggest(sugg.index);
      break;
    case 'Escape': closeSuggest(); break;
    default: return false;
  }
  e.preventDefault();
  return true;
}

/* ---------- notificações (/notif) ---------- */

const NOTIF_MODES = ['all', 'mentions', 'off'];
try {
  const v = localStorage.getItem('notif');
  if (NOTIF_MODES.includes(v)) state.notif = v;
} catch {}

async function cycleNotif() {
  if ('Notification' in window && Notification.permission === 'default') {
    // o navegador só aceita o pedido de permissão a partir de uma ação do usuário
    try {
      await Notification.requestPermission();
    } catch {}
    return toast(
      Notification.permission === 'granted'
        ? `notificações do navegador ativadas (${NOTIF_LABEL[state.notif]}). /notif troca o modo`
        : 'o navegador não liberou notificações do sistema; você ainda vê o contador na aba e ouve o som',
    );
  }
  state.notif = NOTIF_MODES[(NOTIF_MODES.indexOf(state.notif) + 1) % NOTIF_MODES.length];
  try {
    localStorage.setItem('notif', state.notif);
  } catch {}
  renderFooter();
  toast(`notificações: ${NOTIF_LABEL[state.notif]}`);
}

let audioCtx;
function beep() {
  try {
    audioCtx ??= new AudioContext();
    audioCtx.resume();
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(880, t);
    osc.frequency.setValueAtTime(1175, t + 0.1);
    gain.gain.setValueAtTime(0.04, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + 0.31);
  } catch {}
}

function notifyIfNeeded(m) {
  if (m.userId === state.me.id) return;
  if (!(document.hidden || !document.hasFocus())) return;
  const mine = mentionsMe(m);
  // o contador na aba sempre conta; som e notificação seguem a preferência
  state.unread++;
  if (mine) state.unreadMention++;
  updateTitle();
  if (state.notif === 'off' || (state.notif === 'mentions' && !mine)) return;

  beep();
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const u = userOf(m.userId);
    const n = new Notification(mine ? `${u.name} mencionou você` : u.name, {
      body: m.body.replace(/\s+/g, ' ').slice(0, 140) || '[imagem]',
      icon: u.avatar ? `/media/${u.avatar}` : undefined,
      tag: `chat-${m.id}`,
      silent: true, // o som já é o nosso
    });
    n.onclick = () => {
      window.focus();
      n.close();
      scrollToMsg(m.id);
    };
    if (!mine) setTimeout(() => n.close(), 8000);
  } catch {}
}

async function loadUsers() {
  try {
    (await api('GET', '/api/users')).users.forEach(remember);
  } catch {}
}

/* ---------- enquete ---------- */

const chatPane = $('chat-pane');
const pollView = $('poll-view');
const pollModal = $('poll-modal');
let pollShown = false;

function showView(poll) {
  pollShown = poll && !!state.poll;
  chatPane.classList.toggle('show-poll', pollShown);
  pollView.hidden = !pollShown;
  $('tab-chat').classList.toggle('active', !pollShown);
  $('tab-poll').classList.toggle('active', pollShown);
  if (pollShown) renderPoll();
  else input.focus();
}

async function loadPoll() {
  try {
    setPoll((await api('GET', '/api/poll')).poll);
  } catch {}
}

function setPoll(p) {
  const had = state.poll;
  state.poll = p;
  $('tab-poll').hidden = !p;
  if (had && !p) {
    if (pollShown) toast('a enquete foi removida');
    showView(false);
  }
  // encerrada por alguém (criador ou admin): abre o resultado para todos
  const justClosed = p && p.closedAt && had && had.id === p.id && !had.closedAt;
  if (p) {
    // quem votou mas ainda não está no cache (conta nova) aparece como "alguém" até recarregar
    const ids = p.options.flatMap((o) => o.userIds).concat(p.userId);
    if (ids.some((id) => !state.users.has(id))) loadUsers().then(renderPoll);
    renderPoll();
    if (justClosed) {
      toast('enquete encerrada: veja o resultado');
      showView(true);
    }
  }
}

function renderPoll() {
  const p = state.poll;
  if (!p) return;
  const mine = p.options.findIndex((o) => o.userIds.includes(state.me.id));
  const title = $('tab-poll-title');
  const closed = !!p.closedAt;
  title.textContent = closed ? 'resultado' : 'enquete';
  $('tab-poll').querySelector('.dot')?.remove();
  if (!closed && mine < 0) $('tab-poll').append(h('span', 'dot', '●')); // ainda não votou
  if (!pollShown) return;

  const total = p.options.reduce((n, o) => n + o.userIds.length, 0);
  const box = h('div');
  const top = Math.max(0, ...p.options.map((o) => o.userIds.length));
  const winners = closed && top > 0 ? p.options.filter((o) => o.userIds.length === top) : [];
  box.append(h('span', 'poll-chip' + (closed ? ' done' : ''), closed ? 'Resultado' : 'Enquete'));
  box.append(h('div', 'poll-q', p.question));
  box.append(h('div', 'poll-meta', `por ${userOf(p.userId).name} · ${total} ${total === 1 ? 'voto' : 'votos'}${closed ? ' · encerrada' : ''}`));
  if (closed) {
    const msg = !winners.length ? 'ninguém votou' : winners.length > 1 ? `empate: ${winners.map((o) => o.label).join(' · ')}` : `venceu: ${winners[0].label}`;
    box.append(h('div', 'poll-verdict', msg));
  }

  const opts = h('div', 'poll-opts');
  opts.setAttribute('role', 'radiogroup');
  p.options.forEach((o, i) => {
    const isWin = winners.includes(o);
    const row = h('button', 'poll-opt-row' + (i === mine ? ' mine' : '') + (isWin ? ' win' : ''));
    row.type = 'button';
    row.disabled = closed;
    row.setAttribute('role', 'radio');
    row.setAttribute('aria-checked', String(i === mine));
    const line = h('span', 'poll-line');
    line.append(h('span', 'poll-cur', isWin ? '✔' : i === mine ? '❯' : ''), h('span', 'poll-num', `${i + 1}.`), h('span', 'poll-label', o.label), h('span', 'poll-count', closed && total ? `${o.userIds.length} · ${Math.round((o.userIds.length / total) * 100)}%` : String(o.userIds.length)));
    const bar = h('div', 'poll-bar');
    const fill = h('i');
    fill.style.width = `${total ? Math.round((o.userIds.length / total) * 100) : 0}%`;
    bar.append(fill);
    row.append(line, bar);
    if (o.userIds.length) row.append(h('div', 'poll-voters', o.userIds.map((id) => userOf(id).name).join(', ')));
    if (!closed) row.addEventListener('click', () => vote(i));
    opts.append(row);
  });
  box.append(opts);

  const foot = h('div', 'poll-foot');
  foot.append(h('span', null, closed ? 'votação encerrada' : `1–${p.options.length} ou clique para votar · pode trocar o voto`));
  if (p.userId === state.me.id || state.admin) {
    const act = h('button', 'link', closed ? '[remover]' : '[encerrar e mostrar resultado]');
    act.type = 'button';
    act.addEventListener('click', closed ? removePoll : closePoll);
    foot.append(act);
  }
  box.append(foot);
  pollView.replaceChildren(box);
}

async function vote(i) {
  if (!state.poll) return;
  try {
    await api('PUT', `/api/poll/${state.poll.id}/vote`, { option: i });
  } catch (e) {
    toast(e);
    if (e.status === 404) loadPoll();
  }
}

async function closePoll() {
  if (!state.poll || !confirm('Encerrar a enquete? O resultado aparece para todos e ninguém mais vota.')) return;
  try {
    await api('POST', `/api/poll/${state.poll.id}/close`);
  } catch (e) {
    toast(e);
  }
}

async function removePoll() {
  if (!state.poll) return;
  try {
    await api('DELETE', `/api/poll/${state.poll.id}`);
  } catch (e) {
    toast(e);
  }
}

for (const id of ['tab-chat', 'tab-poll']) {
  const tab = $(id);
  const go = () => showView(id === 'tab-poll');
  tab.addEventListener('click', go);
  tab.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      go();
    }
  });
}
document.addEventListener('keydown', (e) => {
  if (!pollShown || !state.poll || state.poll.closedAt || e.ctrlKey || e.metaKey || e.altKey) return;
  if (!pollModal.hidden || !modal.hidden || e.target.matches('input, textarea')) return;
  const n = Number(e.key);
  if (Number.isInteger(n) && n >= 1 && n <= state.poll.options.length) vote(n - 1);
});

function openPollCreate() {
  if (state.poll && !state.poll.closedAt) {
    toast(ERRORS.poll_exists);
    return showView(true);
  }
  for (const el of pollModal.querySelectorAll('input')) el.value = '';
  $('poll-error').hidden = true;
  pollModal.hidden = false;
  $('poll-q').focus();
}
$('poll-cancel').addEventListener('click', () => ((pollModal.hidden = true), input.focus()));
pollModal.addEventListener('mousedown', (e) => {
  if (e.target === pollModal) pollModal.hidden = true;
});
pollModal.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('poll-create').click();
  if (e.key === 'Escape') pollModal.hidden = true;
});
$('poll-create').addEventListener('click', async () => {
  const err = $('poll-error');
  err.hidden = true;
  const options = [...pollModal.querySelectorAll('.poll-opt')].map((el) => el.value.trim()).filter(Boolean);
  try {
    await api('POST', '/api/poll', { question: $('poll-q').value, options });
    pollModal.hidden = true;
    showView(true);
  } catch (e) {
    err.textContent = (e instanceof ApiError && ERRORS[e.code]) || 'não foi possível criar a enquete';
    err.hidden = false;
  }
});

/* ---------- login e boot ---------- */

let authMode = 'login';
function setAuthMode(mode) {
  authMode = mode;
  const reg = mode === 'register';
  $('tab-login').classList.toggle('active', !reg);
  $('tab-register').classList.toggle('active', reg);
  $('invite-row').hidden = !reg;
  $('auth-invite').required = reg;
  $('auth-submit').textContent = reg ? '↵ criar conta' : '↵ entrar';
  $('auth-pass').autocomplete = reg ? 'new-password' : 'current-password';
  $('login-error').hidden = true;
}
$('tab-login').addEventListener('click', () => setAuthMode('login'));
$('tab-register').addEventListener('click', () => setAuthMode('register'));

const AUTH_ERRORS = {
  invalid_credentials: 'usuário ou senha incorretos',
  invalid_invite: 'código de convite inválido',
  invalid_username: 'usuário inválido: 3 a 24 caracteres, só a-z, 0-9, . _ -',
  invalid_password: 'senha inválida: de 8 a 128 caracteres e diferente do usuário',
  username_taken: 'esse usuário já existe',
  rate_limited: 'muitas tentativas: aguarde um pouco e tente de novo',
};
$('auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('login-error');
  err.hidden = true;
  const btn = $('auth-submit');
  btn.disabled = true;
  try {
    const body = { username: $('auth-user').value, password: $('auth-pass').value };
    if (authMode === 'register') body.invite = $('auth-invite').value;
    await api('POST', authMode === 'register' ? '/auth/register' : '/auth/login', body);
    location.reload();
  } catch (ex) {
    err.textContent = `! ${(ex instanceof ApiError && AUTH_ERRORS[ex.code]) || 'não foi possível entrar'}`;
    err.hidden = false;
    btn.disabled = false;
  }
});

function showLogin() {
  state.me = null;
  stopFake?.();
  $('app').hidden = true;
  $('login').hidden = false;
  $('auth-user').focus();
}

$('pw-save').addEventListener('click', async () => {
  const msg = $('pw-msg');
  msg.hidden = false;
  try {
    await api('POST', '/api/password', { current: $('pw-current').value, next: $('pw-next').value });
    $('pw-current').value = $('pw-next').value = '';
    msg.className = 'ok';
    msg.textContent = 'senha alterada; os outros dispositivos foram desconectados';
  } catch (ex) {
    msg.className = 'error';
    msg.textContent = `! ${ex.code === 'wrong_password' ? 'senha atual incorreta' : (AUTH_ERRORS[ex.code] ?? 'não foi possível alterar a senha')}`;
  }
});

async function boot() {
  let me;
  try {
    me = await api('GET', '/api/me');
  } catch {
    return showLogin();
  }
  state.me = me.user;
  state.admin = me.admin;
  state.maxImages = me.maxImages;
  remember(me.user);
  $('login').hidden = true;
  $('app').hidden = false;
  renderFooter();
  stopFake = startFakePanes([$('fake-0'), $('fake-1'), $('fake-2')]);
  await loadUsers();
  if ('Notification' in window && Notification.permission === 'default') {
    toast('digite /notif para ativar as notificações do navegador');
  }
  try {
    await loadHistory();
  } catch (e) {
    toast(e);
  }
  await loadPoll();
  connect();
  input.focus();
}
boot();
