import { renderMarkdown } from './md.js';
import { norm, searchEmojis } from './emojis.js';

const $ = (id) => document.getElementById(id);
const EMOJIS = ['👍', '❤️', '😂', '🎉', '😮', '😢', '🙏', '👀', '🔥', '✅'];
const MAX_IMG_BYTES = 6 * 1024 * 1024;
const IMG_MAX = 360;

const state = {
  me: null,
  admin: false,
  maxImages: 4,
  users: new Map(),
  messages: [],
  els: new Map(),
  online: [],
  replyTo: null,
  pending: [],
  revealed: new Set(),
  hasMore: false,
  loadingOlder: false,
  ws: null,
  wsTries: 0,
  typing: new Map(),
  lastTypingSent: 0,
  unread: 0,
  unreadMention: 0,
  notif: 'all',
  newBelow: 0,
};

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
  rate_limited: 'Calma! Muitas ações seguidas, tente de novo em instantes.',
  invalid_image: 'Imagem inválida ou formato não suportado (use PNG, JPG, GIF ou WebP).',
  name_unavailable: 'Esse nome não está disponível. Use letras, números e pelo menos 2 caracteres.',
  too_many_reactions: 'Reações demais nessa mensagem.',
  forbidden: 'Você não pode fazer isso.',
};
let toastTimer;
function toast(err) {
  const msg = typeof err === 'string' ? err : (err instanceof ApiError && ERRORS[err.code]) || 'Algo deu errado.';
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
  const today = new Date();
  const yest = new Date(Date.now() - 86400000);
  if (d.toDateString() === today.toDateString()) return 'Hoje';
  if (d.toDateString() === yest.toDateString()) return 'Ontem';
  return dayFmt.format(d);
}

function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/* ---------- usuários / avatar ---------- */

const userOf = (id) => state.users.get(id) ?? { id, name: 'Alguém', avatar: null };
const remember = (u) => u && state.users.set(u.id, u);

function fillAvatar(span, user) {
  span.replaceChildren();
  span.style.background = `hsl(${(user.id * 47) % 360} 45% 42%)`;
  if (user.avatar) {
    const img = new Image();
    img.alt = '';
    img.src = `/media/${user.avatar}`;
    img.addEventListener('error', () => {
      span.replaceChildren(document.createTextNode(user.name.slice(0, 1).toUpperCase()));
    });
    span.append(img);
  } else {
    span.textContent = user.name.slice(0, 1).toUpperCase();
  }
}
function avatarEl(user, cls = '') {
  const s = h('span', `avatar ${cls}`.trim());
  fillAvatar(s, user);
  return s;
}

/* ---------- tema ---------- */

function applyTheme(t) {
  if (t) document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}
try {
  applyTheme(localStorage.getItem('theme'));
} catch {}
$('theme-btn').addEventListener('click', () => {
  const dark =
    document.documentElement.dataset.theme === 'dark' ||
    (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  const next = dark ? 'light' : 'dark';
  applyTheme(next);
  try {
    localStorage.setItem('theme', next);
  } catch {}
});

/* ---------- picker de emoji ---------- */

const picker = $('picker');
let pickerCb = null;
function openPicker(anchor, cb) {
  picker.replaceChildren();
  for (const e of EMOJIS) {
    const b = h('button', null, e);
    b.type = 'button';
    b.addEventListener('click', () => {
      closePicker();
      cb(e);
    });
    picker.append(b);
  }
  pickerCb = cb;
  picker.hidden = false;
  const r = anchor.getBoundingClientRect();
  const w = picker.offsetWidth;
  picker.style.left = `${Math.max(8, Math.min(r.left, innerWidth - w - 8))}px`;
  const below = r.bottom + 8 + picker.offsetHeight < innerHeight;
  picker.style.top = `${below ? r.bottom + 6 : r.top - picker.offsetHeight - 6}px`;
}
function closePicker() {
  picker.hidden = true;
  pickerCb = null;
}
document.addEventListener('mousedown', (e) => {
  if (!picker.hidden && !picker.contains(e.target) && !e.target.closest('[data-picker-anchor]')) closePicker();
});

/* ---------- renderização de mensagens ---------- */

function imageEl(img) {
  const s = Math.min(IMG_MAX / img.w, IMG_MAX / img.h, 1);
  const b = h('button', 'spoiler');
  b.type = 'button';
  b.style.width = `${Math.max(48, Math.round(img.w * s))}px`;
  b.style.maxWidth = '100%';
  b.style.aspectRatio = `${img.w} / ${img.h}`;
  const i = new Image();
  i.alt = 'Imagem enviada';
  i.src = `/media/${img.id}`;
  i.loading = 'lazy';
  i.draggable = false;
  b.append(i, h('span', 'label', 'SPOILER'));
  const reveal = () => b.classList.add('revealed');
  if (state.revealed.has(img.id)) reveal();
  else b.setAttribute('aria-label', 'Imagem escondida (spoiler). Clique para revelar');
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

function actionBtn(label, title, fn, anchor = false) {
  const b = h('button', 'icon-btn small', label);
  b.type = 'button';
  b.title = title;
  b.setAttribute('aria-label', title);
  if (anchor) b.dataset.pickerAnchor = '1';
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    fn(b);
  });
  return b;
}

function buildMsg(m, prev) {
  const wrap = h('div', 'mwrap');
  wrap.dataset.id = m.id;
  if (!prev || dayKey(prev.createdAt) !== dayKey(m.createdAt)) wrap.append(h('div', 'day', dayLabel(m.createdAt)));

  const u = userOf(m.userId);
  const first = !prev || prev.userId !== m.userId || m.createdAt - prev.createdAt > 5 * 60000 || !!m.replyTo || !!wrap.firstChild;
  const row = h('div', first ? 'msg first' : 'msg');
  if (!m.deleted && mentionsMe(m)) row.classList.add('mentioned');
  if (first) row.append(avatarEl(u));
  else row.append(h('span', 'gutter', timeFmt.format(m.createdAt)));

  const col = h('div', 'main-col');
  let actions = null;
  if (first) {
    const meta = h('div', 'meta');
    meta.append(h('span', 'name', u.name), h('span', 'time', timeFmt.format(m.createdAt)));
    if (m.editedAt && !m.deleted) meta.append(h('span', 'edited', '(editado)'));
    col.append(meta);
  }

  if (m.replyTo) {
    const ru = userOf(m.replyTo.userId);
    const ref = h('div', 'reply-ref');
    ref.append(h('b', null, ru.name), h('span', null, m.replyTo.snippet ?? 'Mensagem apagada'));
    ref.addEventListener('click', () => scrollToMsg(m.replyTo.id));
    col.append(ref);
  }

  if (m.deleted) {
    col.append(h('div', 'body deleted', 'Mensagem apagada'));
  } else {
    if (m.body) {
      const body = h('div', 'body');
      body.append(renderMarkdown(m.body, m.mentions, state.me.id));
      col.append(body);
    }
    if (m.images.length) {
      const box = h('div', 'images');
      for (const img of m.images) box.append(imageEl(img));
      col.append(box);
    }
    if (m.reactions.length) {
      const box = h('div', 'reactions');
      for (const r of m.reactions) {
        const mine = r.userIds.includes(state.me.id);
        const chip = h('button', mine ? 'chip mine' : 'chip');
        chip.type = 'button';
        chip.title = r.userIds.map((id) => userOf(id).name).join(', ');
        chip.append(h('span', null, r.emoji), h('span', null, String(r.userIds.length)));
        chip.addEventListener('click', () => toggleReact(m, r.emoji, !mine));
        box.append(chip);
      }
      col.append(box);
    }

    actions = h('div', 'actions');
    actions.append(actionBtn('☺', 'Reagir', (b) => openPicker(b, (e) => toggleReact(m, e, true)), true));
    actions.append(actionBtn('↩', 'Responder', () => setReply(m)));
    if (m.userId === state.me.id) actions.append(actionBtn('✎', 'Editar', () => startEdit(m, wrap)));
    if (m.userId === state.me.id || state.admin) actions.append(actionBtn('🗑', 'Apagar', () => removeMsg(m)));
  }
  row.append(col);
  if (actions) row.append(actions);
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
const nearBottom = () => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 90;
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
    state.newBelow++;
    $('jump').hidden = false;
  }
  notifyIfNeeded(m);
}

function hideJump() {
  state.newBelow = 0;
  $('jump').hidden = true;
}
$('jump').addEventListener('click', () => {
  toBottom();
  hideJump();
});
function clearUnread() {
  state.unread = state.unreadMention = 0;
  document.title = 'Chat';
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) clearUnread();
});
window.addEventListener('focus', clearUnread);

function scrollToMsg(id) {
  const el = state.els.get(id);
  if (!el) return toast('Mensagem mais antiga, role para cima para carregar.');
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
  } catch (e) {
    toast(e);
  } finally {
    state.loadingOlder = false;
  }
}
scroller.addEventListener('scroll', () => {
  if (nearBottom()) hideJump();
  if (scroller.scrollTop < 150) loadOlder();
});

/* ---------- ações em mensagens ---------- */

async function toggleReact(m, emoji, on) {
  try {
    await api(on ? 'PUT' : 'DELETE', `/api/messages/${m.id}/reactions`, { emoji });
  } catch (e) {
    toast(e);
  }
}

async function removeMsg(m) {
  if (!confirm('Apagar esta mensagem?')) return;
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
  const row = h('div', 'row');
  const cancel = h('button', 'btn', 'Cancelar');
  const save = h('button', 'btn primary', 'Salvar');
  cancel.type = save.type = 'button';
  row.append(h('small', null, 'Esc cancela · Enter salva'), cancel, save);
  box.append(ta, row);
  if (body) body.replaceWith(box);
  else wrap.querySelector('.main-col').append(box);
  ta.focus();
  const doSave = async () => {
    try {
      await api('PATCH', `/api/messages/${m.id}`, { body: ta.value });
      rebuild(m.id); // o evento do WebSocket também reconstrói; garante o estado normal
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

/* ---------- composer ---------- */

const input = $('input');
const sendBtn = $('send-btn');

function setReply(m) {
  state.replyTo = m;
  $('reply-text').textContent = `Respondendo a ${userOf(m.userId).name}: ${m.body.slice(0, 80) || '[imagem]'}`;
  $('reply-bar').hidden = false;
  input.focus();
}
function clearReply() {
  state.replyTo = null;
  $('reply-bar').hidden = true;
}
$('reply-cancel').addEventListener('click', clearReply);

function updateSend() {
  const uploading = state.pending.some((p) => p.uploading);
  const ready = state.pending.filter((p) => p.id);
  sendBtn.disabled = uploading || (!input.value.trim() && ready.length === 0);
}
function autosize() {
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 200)}px`;
}
input.addEventListener('input', () => {
  autosize();
  updateSend();
  updateSuggest();
  if (Date.now() - state.lastTypingSent > 2500 && state.ws?.readyState === 1 && input.value) {
    state.lastTypingSent = Date.now();
    state.ws.send('{"t":"typing"}');
  }
});
input.addEventListener('click', updateSuggest);
input.addEventListener('blur', closeSuggest);
input.addEventListener('keydown', (e) => {
  if (sugg.type && !e.isComposing && suggestKey(e)) return;
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    send();
  }
});

function renderPreviews() {
  const box = $('previews');
  box.replaceChildren();
  box.hidden = state.pending.length === 0;
  for (const p of state.pending) {
    const d = h('div', p.uploading ? 'preview loading' : 'preview');
    const img = new Image();
    img.alt = '';
    img.src = p.url;
    const x = h('button', null, '✕');
    x.type = 'button';
    x.setAttribute('aria-label', 'Remover imagem');
    x.addEventListener('click', () => {
      URL.revokeObjectURL(p.url);
      state.pending = state.pending.filter((q) => q !== p);
      renderPreviews();
      updateSend();
    });
    d.append(img, x);
    box.append(d);
  }
}

async function addFiles(files) {
  for (const file of files) {
    if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) {
      toast('Apenas imagens PNG, JPG, GIF ou WebP.');
      continue;
    }
    if (file.size > MAX_IMG_BYTES) {
      toast('Imagem acima de 6 MB.');
      continue;
    }
    if (state.pending.length >= state.maxImages) {
      toast(`No máximo ${state.maxImages} imagens por mensagem.`);
      break;
    }
    const p = { url: URL.createObjectURL(file), uploading: true, id: null };
    state.pending.push(p);
    renderPreviews();
    updateSend();
    try {
      const r = await api('POST', '/api/upload?kind=image', undefined, file);
      p.id = r.id;
    } catch (e) {
      state.pending = state.pending.filter((q) => q !== p);
      URL.revokeObjectURL(p.url);
      toast(e);
    }
    p.uploading = false;
    renderPreviews();
    updateSend();
  }
}
$('attach-btn').addEventListener('click', () => $('file-input').click());
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
  if (sending || sendBtn.disabled) return;
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
    updateSend();
  } catch (e) {
    toast(e);
  } finally {
    sending = false;
  }
}
sendBtn.addEventListener('click', send);

/* ---------- presença / digitando ---------- */

function renderOnline() {
  const ul = $('online-list');
  ul.replaceChildren();
  const users = state.online.map(userOf).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  for (const u of users) {
    const li = h('li');
    li.append(avatarEl(u), h('span', null, u.name), h('span', 'dot'));
    ul.append(li);
  }
  $('online-count').textContent = $('online-count-2').textContent = String(users.length);
}

function renderTyping() {
  const names = [...state.typing.keys()].map((id) => userOf(id).name);
  const t = $('typing');
  if (names.length === 0) t.textContent = '';
  else if (names.length === 1) t.textContent = `${names[0]} está digitando…`;
  else if (names.length === 2) t.textContent = `${names[0]} e ${names[1]} estão digitando…`;
  else t.textContent = 'Várias pessoas estão digitando…';
}

/* ---------- WebSocket ---------- */

function applyUserUpdate(u) {
  remember(u);
  if (u.id === state.me.id) {
    state.me = u;
    renderMe();
  }
  for (const m of state.messages) {
    if (m.userId === u.id || m.replyTo?.userId === u.id) rebuild(m.id);
  }
  state.online = state.online.map((x) => x);
  renderOnline();
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
      for (const x of state.messages) if (x.replyTo?.id === e.id) {
        x.replyTo.snippet = null;
        rebuild(x.id);
      }
      if (state.replyTo?.id === e.id) clearReply();
      break;
    }
    case 'react': {
      const m = state.messages.find((x) => x.id === e.id);
      if (m) {
        m.reactions = e.reactions;
        rebuild(m.id);
      }
      break;
    }
    case 'user':
      applyUserUpdate(e.user);
      break;
    case 'presence':
      e.online.forEach(remember);
      state.online = e.online.map((u) => u.id);
      renderOnline();
      break;
    case 'typing': {
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
    }
  }
}

function connect() {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  state.ws = ws;
  ws.addEventListener('open', async () => {
    const reconnected = state.wsTries > 0;
    state.wsTries = 0;
    if (reconnected) await loadHistory(); // recupera o que perdeu enquanto offline
  });
  ws.addEventListener('message', onWsMessage);
  ws.addEventListener('close', (e) => {
    if (!state.me || e.code === 4001) return;
    state.wsTries++;
    setTimeout(connect, Math.min(1000 * 2 ** state.wsTries, 15000));
  });
}

/* ---------- carga inicial ---------- */

async function loadHistory() {
  const data = await api('GET', '/api/messages');
  Object.values(data.users).forEach(remember);
  data.online.forEach(remember);
  state.online = data.online.map((u) => u.id);
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
  renderOnline();
  toBottom();
  hideJump();
}

function renderMe() {
  fillAvatar($('me-avatar'), state.me);
  $('me-name').textContent = state.me.name;
}

/* ---------- perfil ---------- */

const modal = $('profile-modal');
function openProfile() {
  fillAvatar($('profile-avatar'), state.me);
  $('profile-name').value = state.me.name;
  $('profile-error').hidden = true;
  modal.hidden = false;
  $('profile-name').focus();
}
$('me-btn').addEventListener('click', openProfile);
$('profile-close').addEventListener('click', () => (modal.hidden = true));
modal.addEventListener('mousedown', (e) => {
  if (e.target === modal) modal.hidden = true;
});
$('avatar-btn').addEventListener('click', () => $('avatar-input').click());
$('avatar-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (file.size > MAX_IMG_BYTES) return toast('Imagem acima de 6 MB.');
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
  } catch (e) {
    err.textContent = (e instanceof ApiError && ERRORS[e.code]) || 'Não foi possível salvar.';
    err.hidden = false;
  }
});
$('profile-name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('profile-save').click();
});

$('logout-btn').addEventListener('click', async () => {
  try {
    await api('POST', '/api/logout');
  } catch {}
  location.reload();
});

/* ---------- menu mobile / atalhos ---------- */

const sidebar = $('sidebar');
const scrim = $('scrim');
function toggleSidebar(open) {
  sidebar.classList.toggle('open', open);
  scrim.hidden = !open;
}
$('menu-btn').addEventListener('click', () => toggleSidebar(!sidebar.classList.contains('open')));
scrim.addEventListener('click', () => toggleSidebar(false));
$('lightbox').addEventListener('click', () => ($('lightbox').hidden = true));
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  closePicker();
  $('lightbox').hidden = true;
  modal.hidden = true;
  toggleSidebar(false);
});

/* ---------- menções (@) e emoji (/emoji) ---------- */

const mentionsMe = (m) => m.everyone || m.mentions.some((x) => x.id === state.me.id);

const sugg = { type: null, start: 0, end: 0, items: [], index: 0 };
const mentionPop = $('mention-pop');
const emojiPop = $('emoji-pop');
const EMOJI_COLS = 8;

function closeSuggest() {
  sugg.type = null;
  mentionPop.hidden = emojiPop.hidden = true;
}

function updateSuggest() {
  const pos = input.selectionStart;
  if (pos !== input.selectionEnd) return closeSuggest();
  const before = input.value.slice(0, pos);

  // "/emoji" ou "/emoji coração": abre o seletor com busca
  let m = /(^|\s)\/emoji(?:[ \t]+(\S*))?$/i.exec(before);
  if (m) {
    const items = searchEmojis(m[2] ?? '').slice(0, 160);
    Object.assign(sugg, { type: 'emoji', start: pos - (m[0].length - m[1].length), end: pos, items, index: 0 });
    mentionPop.hidden = true;
    return renderEmojiPop();
  }

  // "@fu": sugere pessoas
  m = /(^|[\s(])@([a-z0-9_.-]{0,24})$/i.exec(before);
  if (m) {
    const q = norm(m[2]);
    const people = [...state.users.values()]
      .filter((u) => u.id !== state.me.id && (u.username.startsWith(q) || norm(u.name).includes(q)))
      .slice(0, 6);
    const items = people.map((u) => ({ username: u.username, name: u.name, user: u }));
    if ('todos'.startsWith(q)) items.push({ username: 'todos', name: 'Todos — notifica a sala inteira', user: null });
    if (items.length) {
      Object.assign(sugg, { type: 'mention', start: pos - m[2].length - 1, end: pos, items, index: 0 });
      emojiPop.hidden = true;
      return renderMentionPop();
    }
  }
  closeSuggest();
}

function renderMentionPop() {
  mentionPop.replaceChildren();
  sugg.items.forEach((it, i) => {
    const row = h('div', i === sugg.index ? 'item active' : 'item');
    row.append(it.user ? avatarEl(it.user) : h('span', 'avatar', '@'));
    row.append(h('span', 'item-name', it.name), h('span', 'item-sub', `@${it.username}`));
    row.addEventListener('mousedown', (e) => {
      e.preventDefault();
      acceptSuggest(i);
    });
    mentionPop.append(row);
  });
  mentionPop.hidden = false;
}

function renderEmojiPop() {
  emojiPop.replaceChildren();
  emojiPop.append(h('div', 'pop-head', 'Emojis · digite para filtrar (ex.: /emoji coração) · setas navegam · Enter insere'));
  if (!sugg.items.length) emojiPop.append(h('div', 'pop-empty', 'Nenhum emoji encontrado'));
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
  const text = sugg.type === 'emoji' ? it.char : `@${it.username} `;
  input.setRangeText(text, sugg.start, sugg.end, 'end');
  closeSuggest();
  input.focus();
  autosize();
  updateSend();
}

/** Teclado com o popup aberto. Retorna true se a tecla foi consumida. */
function suggestKey(e) {
  const emoji = sugg.type === 'emoji';
  const n = sugg.items.length;
  const move = (d) => {
    if (!n) return;
    sugg.index = Math.max(0, Math.min(n - 1, sugg.index + d));
    emoji ? renderEmojiPop() : renderMentionPop();
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

/* ---------- notificações ---------- */

const NOTIF_MODES = ['all', 'mentions', 'off'];
const NOTIF_LABEL = {
  all: ['🔔', 'Notificações: todas as mensagens'],
  mentions: ['@', 'Notificações: só quando me mencionarem'],
  off: ['🔕', 'Notificações desligadas'],
};
try {
  const v = localStorage.getItem('notif');
  if (NOTIF_MODES.includes(v)) state.notif = v;
} catch {}

function renderBell() {
  const [icon, title] = NOTIF_LABEL[state.notif];
  const b = $('notif-btn');
  b.textContent = icon;
  b.title = title;
  b.setAttribute('aria-label', title);
}
$('notif-btn').addEventListener('click', async () => {
  const canNotify = 'Notification' in window;
  if (canNotify && Notification.permission === 'default') {
    // o navegador só aceita o pedido de permissão a partir de um clique
    try {
      await Notification.requestPermission();
    } catch {}
    renderBell();
    return toast(canNotify && Notification.permission === 'granted' ? `${NOTIF_LABEL[state.notif][1]} (ativadas)` : 'O navegador não liberou notificações do sistema. Você ainda vê o contador na aba e ouve o som.');
  }
  state.notif = NOTIF_MODES[(NOTIF_MODES.indexOf(state.notif) + 1) % NOTIF_MODES.length];
  try {
    localStorage.setItem('notif', state.notif);
  } catch {}
  renderBell();
  toast(NOTIF_LABEL[state.notif][1]);
});

let audioCtx;
function beep() {
  try {
    audioCtx ??= new AudioContext();
    audioCtx.resume();
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.setValueAtTime(880, t);
    osc.frequency.setValueAtTime(1175, t + 0.12);
    gain.gain.setValueAtTime(0.07, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + 0.36);
  } catch {}
}

function updateTitle() {
  document.title = state.unread ? `(${state.unreadMention ? '@' : ''}${state.unread}) Chat` : 'Chat';
}

function notifyIfNeeded(m) {
  if (m.userId === state.me.id) return;
  const away = document.hidden || !document.hasFocus();
  if (!away) return;
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
      body: m.body.replace(/\s+/g, ' ').slice(0, 140) || '📷 Imagem',
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

/* ---------- boot ---------- */

let authMode = 'login';
function setAuthMode(mode) {
  authMode = mode;
  const reg = mode === 'register';
  $('tab-login').classList.toggle('active', !reg);
  $('tab-register').classList.toggle('active', reg);
  $('invite-row').hidden = !reg;
  $('auth-invite').required = reg;
  $('auth-submit').textContent = reg ? 'Criar conta' : 'Entrar';
  $('auth-pass').autocomplete = reg ? 'new-password' : 'current-password';
  $('login-error').hidden = true;
}
$('tab-login').addEventListener('click', () => setAuthMode('login'));
$('tab-register').addEventListener('click', () => setAuthMode('register'));

const AUTH_ERRORS = {
  invalid_credentials: 'Usuário ou senha incorretos.',
  invalid_invite: 'Código de convite inválido.',
  invalid_username: 'Usuário inválido: 3 a 24 caracteres, só letras minúsculas, números, . _ -',
  invalid_password: 'Senha inválida: use de 8 a 128 caracteres e diferente do usuário.',
  username_taken: 'Esse usuário já existe.',
  rate_limited: 'Muitas tentativas. Aguarde um pouco e tente de novo.',
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
    err.textContent = (ex instanceof ApiError && AUTH_ERRORS[ex.code]) || 'Não foi possível entrar.';
    err.hidden = false;
    btn.disabled = false;
  }
});

function showLogin() {
  state.me = null;
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
    msg.style.color = 'inherit';
    msg.textContent = 'Senha alterada. Outros dispositivos foram desconectados.';
  } catch (ex) {
    msg.style.color = '';
    msg.textContent =
      ex.code === 'wrong_password' ? 'Senha atual incorreta.' : (AUTH_ERRORS[ex.code] ?? 'Não foi possível alterar a senha.');
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
  renderMe();
  renderBell();
  await loadUsers();
  if ('Notification' in window && Notification.permission === 'default') {
    toast('Clique no 🔔 (menu lateral) para ativar as notificações do navegador.');
  }
  try {
    await loadHistory();
  } catch (e) {
    toast(e);
  }
  connect();
  input.focus();
}
boot();
