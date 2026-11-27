// Terminais "decorativos": simulam uma sessão de agente de código (pensando, lendo arquivos,
// rodando comandos, editando) com texto gerado aqui mesmo no navegador.
// Não faz nenhuma requisição ao servidor e não usa dado real de ninguém.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);
const ri = (a, b) => Math.floor(rnd(a, b + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const shuffle = (arr) => arr.map((v) => [Math.random(), v]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

// com a aba em segundo plano o navegador já segura os timers; isso evita acumular trabalho
function visible() {
  if (!document.hidden) return Promise.resolve();
  return new Promise((res) => {
    const f = () => {
      if (!document.hidden) {
        document.removeEventListener('visibilitychange', f);
        res();
      }
    };
    document.addEventListener('visibilitychange', f);
  });
}
async function wait(ms) {
  await sleep(ms);
  await visible();
}

function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export const SPINNER = ['·', '✢', '✳', '✶', '✻', '✽'];
const VERBS = ['Thinking', 'Pondering', 'Cogitating', 'Reasoning', 'Analyzing', 'Tinkering', 'Brewing', 'Noodling', 'Untangling', 'Computing'];

/* ---------- roteiros ---------- */
// Texto entre `crases` aparece destacado em azul. Tudo aqui é inventado.

const SCENARIOS = [
  {
    title: 'refatorar cálculo de frete',
    prompt: 'extrai o cálculo de frete do CheckoutService para uma classe própria e cobre com testes',
    steps: [
      { k: 'thought', text: 'Preciso entender onde o frete é calculado hoje antes de mexer em qualquer coisa. Primeiro leio o service e procuro quem chama.' },
      { k: 'say', text: 'Vou começar lendo como o frete é calculado hoje.' },
      { k: 'tool', name: 'Read', arg: 'src/services/CheckoutService.ts', out: 'Read 212 lines' },
      { k: 'tool', name: 'Grep', arg: '"calcularFrete" src', out: 'Found 6 matches in 3 files' },
      { k: 'say', text: 'O cálculo mistura `peso`, `cep` e regras de promoção no mesmo método. Vou separar em uma classe `FreteCalculator`, sem mudar o comportamento.' },
      { k: 'diff', file: 'src/services/FreteCalculator.ts', add: 48, del: 0, lines: [['+', 'export class FreteCalculator {'], ['+', '  calcular(pedido: Pedido): Money {'], ['+', '    const base = this.tabela.valorPara(pedido.cep, pedido.pesoTotal)'], ['+', '    return this.aplicarPromocoes(base, pedido)'], ['+', '  }']] },
      { k: 'diff', file: 'src/services/CheckoutService.ts', add: 3, del: 41, lines: [['-', '    const base = this.tabelaFrete.valorPara(pedido.cep, peso)'], ['-', '    if (pedido.cupom?.freteGratis) return Money.zero()'], ['+', '    return this.frete.calcular(pedido)']] },
      { k: 'tool', name: 'Bash', arg: 'npm test -- Frete', out: '✓ 14 passed (2.1s)', ok: true },
      { k: 'say', text: 'Pronto. O `CheckoutService` agora só delega, e os 14 testes cobrem frete grátis, cupom e CEP fora da tabela.' },
    ],
  },
  {
    title: 'migração da tabela de estoque',
    prompt: 'cria a migration para separar estoque por depósito sem perder o saldo atual',
    steps: [
      { k: 'thought', text: 'A tabela `estoque` hoje tem um saldo único por produto. Para separar por depósito preciso de uma tabela filha e de um backfill seguro.' },
      { k: 'tool', name: 'Read', arg: 'database/migrations/2024_estoque.php', out: 'Read 64 lines' },
      { k: 'tool', name: 'Bash', arg: 'git log --oneline -5 -- database/migrations', out: '5 commits' },
      { k: 'say', text: 'Vou criar `estoque_depositos` e copiar o saldo atual para o depósito padrão dentro da mesma transação.' },
      { k: 'diff', file: 'database/migrations/2025_estoque_depositos.php', add: 37, del: 0, lines: [['+', "Schema::create('estoque_depositos', function (Blueprint $t) {"], ['+', "    $t->foreignId('produto_id')->constrained();"], ['+', "    $t->foreignId('deposito_id')->constrained();"], ['+', "    $t->integer('saldo')->default(0);"], ['+', '});']] },
      { k: 'tool', name: 'Bash', arg: 'php artisan migrate --pretend', out: '3 queries, nenhuma destrutiva', ok: true },
      { k: 'list', items: ['o saldo antigo continua intacto na coluna `saldo`', 'o backfill roda em lotes de 1000 linhas', 'o rollback recria a coluna a partir da soma dos depósitos'] },
    ],
  },
  {
    title: 'corrigir teste instável do checkout',
    prompt: 'o teste do checkout falha uma vez a cada dez execuções no CI, descobre por quê',
    steps: [
      { k: 'thought', text: 'Falha intermitente quase sempre é ordem, tempo ou estado compartilhado. Vou rodar o teste em loop para ver o padrão.' },
      { k: 'tool', name: 'Bash', arg: 'for i in $(seq 1 20); do npm test -- checkout || break; done', out: 'falhou na execução 7 de 20' },
      { k: 'tool', name: 'Read', arg: 'tests/checkout.spec.ts', out: 'Read 178 lines' },
      { k: 'say', text: 'Achei. O teste de `pedido expirado` usa `Date.now()` real e compara com um limite de 1s, então às vezes cruza o segundo no meio do teste.' },
      { k: 'diff', file: 'tests/checkout.spec.ts', add: 4, del: 2, lines: [['-', '  const agora = Date.now()'], ['+', '  vi.useFakeTimers()'], ['+', '  vi.setSystemTime(new Date("2025-03-10T12:00:00Z"))']] },
      { k: 'tool', name: 'Bash', arg: 'for i in $(seq 1 50); do npm test -- checkout || break; done', out: '✓ 50 execuções, 0 falhas', ok: true },
      { k: 'say', text: 'Corrigido: relógio fixo no teste, 50 execuções seguidas sem falha.' },
    ],
  },
  {
    title: 'paginação na listagem de pedidos',
    prompt: 'a listagem de pedidos está lenta com muitos registros, troca para paginação por cursor',
    steps: [
      { k: 'thought', text: 'Paginação por offset degrada conforme a página cresce. Cursor por `id` resolve e mantém a ordenação estável.' },
      { k: 'tool', name: 'Read', arg: 'src/repositories/PedidoRepository.ts', out: 'Read 130 lines' },
      { k: 'tool', name: 'Bash', arg: 'EXPLAIN ANALYZE select * from pedidos order by id desc limit 50 offset 90000', out: 'Seq Scan, 412 ms' },
      { k: 'say', text: 'Com `offset 90000` o banco lê e descarta 90 mil linhas. Vou trocar por `where id < :cursor`, que usa o índice primário.' },
      { k: 'diff', file: 'src/repositories/PedidoRepository.ts', add: 14, del: 6, lines: [['-', '    .offset((pagina - 1) * limite)'], ['+', '    .where(cursor ? lt(pedidos.id, cursor) : undefined)'], ['+', '    .orderBy(desc(pedidos.id))']] },
      { k: 'tool', name: 'Bash', arg: 'npm test -- PedidoRepository', out: '✓ 9 passed (1.3s)', ok: true },
      { k: 'say', text: 'A mesma consulta caiu de 412 ms para 3 ms no plano de execução. A resposta agora devolve `proximoCursor`.' },
    ],
  },
  {
    title: 'cache de consulta de produtos',
    prompt: 'adiciona cache de 5 minutos na busca de produtos, mas invalida quando o produto muda',
    steps: [
      { k: 'thought', text: 'Cache com TTL é simples, o difícil é invalidar. Vou usar uma chave por produto e uma versão global para as buscas.' },
      { k: 'tool', name: 'Grep', arg: '"buscarProdutos" src', out: 'Found 4 matches in 2 files' },
      { k: 'tool', name: 'Read', arg: 'src/services/CatalogoService.ts', out: 'Read 96 lines' },
      { k: 'say', text: 'Vou guardar o resultado em `catalogo:busca:{versao}:{hash}` e incrementar `versao` sempre que um produto for salvo.' },
      { k: 'diff', file: 'src/services/CatalogoService.ts', add: 22, del: 3, lines: [['+', '    const chave = `catalogo:busca:${await this.versao()}:${hash(filtro)}`'], ['+', '    const cache = await this.redis.get(chave)'], ['+', '    if (cache) return JSON.parse(cache)']] },
      { k: 'tool', name: 'Bash', arg: 'npm test -- Catalogo', out: '✓ 11 passed, 1 skipped', ok: true },
      { k: 'list', items: ['TTL de 300s em toda busca', '`salvarProduto` e `removerProduto` incrementam a versão', 'sem Redis disponível, cai na consulta direta'] },
    ],
  },
  {
    title: 'erro 500 no webhook de pagamento',
    prompt: 'o webhook do gateway está devolvendo 500 de vez em quando, olha os logs e corrige',
    steps: [
      { k: 'thought', text: 'Webhook com 500 intermitente: pode ser payload inesperado, duplicidade de evento ou timeout. Os logs devem mostrar qual.' },
      { k: 'tool', name: 'Bash', arg: 'grep -c "webhook.*500" storage/logs/app.log', out: '37' },
      { k: 'tool', name: 'Bash', arg: 'grep -m3 "TypeError" storage/logs/app.log', out: "Cannot read properties of undefined (reading 'id')" },
      { k: 'say', text: 'O erro vem de eventos `payment.refunded` sem o campo `customer`. O handler assume que ele sempre existe.' },
      { k: 'diff', file: 'src/webhooks/PagamentoHandler.ts', add: 6, del: 1, lines: [['-', '  const clienteId = evento.customer.id'], ['+', '  const clienteId = evento.customer?.id ?? (await this.buscarClientePorPedido(evento.order))']] },
      { k: 'tool', name: 'Bash', arg: 'npm test -- PagamentoHandler', out: '✓ 8 passed (0.9s)', ok: true },
      { k: 'say', text: 'Corrigido e coberto por um teste com o payload de reembolso real, anonimizado. Também respondo `200` para eventos duplicados.' },
    ],
  },
  {
    title: 'revisar PR de permissões',
    prompt: 'revisa o PR de permissões e me diz se tem algum jeito de um usuário comum virar admin',
    steps: [
      { k: 'thought', text: 'Revisão de permissão é sobre caminhos de escalada. Olho onde o papel é atribuído e se o valor vem do cliente.' },
      { k: 'tool', name: 'Bash', arg: 'gh pr diff 482 --name-only', out: '9 arquivos' },
      { k: 'tool', name: 'Read', arg: 'src/http/UsuarioController.ts', out: 'Read 154 lines' },
      { k: 'say', text: 'Achei um ponto: `atualizarPerfil` faz `Object.assign(usuario, req.body)`, então um usuário comum consegue enviar `{ "papel": "admin" }`.' },
      { k: 'diff', file: 'src/http/UsuarioController.ts', add: 5, del: 1, lines: [['-', '  Object.assign(usuario, req.body)'], ['+', '  const { nome, telefone } = schemaPerfil.parse(req.body)'], ['+', '  Object.assign(usuario, { nome, telefone })']] },
      { k: 'tool', name: 'Bash', arg: 'npm test -- Usuario', out: '✓ 17 passed (1.8s)', ok: true },
      { k: 'say', text: 'Deixei o comentário no PR com o exemplo de requisição e o teste que reproduz a escalada.' },
    ],
  },
  {
    title: 'atualizar dependências com vulnerabilidade',
    prompt: 'roda o audit e atualiza só o que tem vulnerabilidade alta, sem quebrar o build',
    steps: [
      { k: 'thought', text: 'Atualizar tudo de uma vez é receita para quebrar. Vou focar nas altas e críticas e validar com o build e os testes.' },
      { k: 'tool', name: 'Bash', arg: 'npm audit --omit=dev --audit-level=high', out: '3 high, 0 critical' },
      { k: 'tool', name: 'Bash', arg: 'npm ls semver minimatch', out: '2 versões vulneráveis, ambas transitivas' },
      { k: 'say', text: 'Duas das três são transitivas. Resolvo com `overrides` no `package.json`, sem trocar a dependência direta.' },
      { k: 'diff', file: 'package.json', add: 4, del: 0, lines: [['+', '  "overrides": {'], ['+', '    "semver": "^7.6.3",'], ['+', '    "minimatch": "^9.0.5"'], ['+', '  }']] },
      { k: 'tool', name: 'Bash', arg: 'npm install && npm run build && npm test', out: 'build ok · ✓ 212 passed (18.4s)', ok: true },
      { k: 'tool', name: 'Bash', arg: 'npm audit --omit=dev --audit-level=high', out: 'found 0 vulnerabilities', ok: true },
    ],
  },
];

/* ---------- painel ---------- */

class FakePane {
  constructor(root, cfg, scenarios, hooks = {}) {
    this.cfg = cfg;
    this.queue = scenarios;
    this.alive = true;
    this.session = rnd(1, 40);
    this.ctx = ri(3, 18);

    const tabs = h('div', 'tabs');
    const t0 = h('span', 'tab dim', 'Terminal');
    this.titleEl = h('span', 'title', cfg.initialTitle);
    const t1 = h('span', 'tab active');
    t1.append(h('span', 'star', '✳'), this.titleEl, h('span', 'x', '×'));
    const localTab = h('span', 'tab', 'Local');
    if (hooks.onLocal) {
      localTab.setAttribute('role', 'tab');
      localTab.tabIndex = 0;
      localTab.addEventListener('click', hooks.onLocal);
      localTab.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          hooks.onLocal();
        }
      });
    }
    tabs.append(t0, t1, localTab, h('span', 'plus', '＋'));

    this.out = h('div', 'out');
    this.out.setAttribute('aria-hidden', 'true');

    const dock = h('div', 'dock');
    this.think = h('div', 'think');
    this.think.hidden = true;
    this.spin = h('span', 'spin', '✻');
    this.verb = h('span', 'verb', 'Thinking…');
    this.meta = h('span', 'meta');
    this.think.append(this.spin, this.verb, this.meta);

    this.credits = h('div', 'status');
    this.foot = h('div', 'foot');
    this.footCtx = h('span', 'ctx');
    this.foot.append(
      h('span', null, `Default · ${cfg.model} · ${cfg.effort} · `),
      this.footCtx,
    );

    const prompt = h('div', 'prompt');
    this.typed = h('span', 'typed');
    this.cursor = h('span', 'cursor', ' ');
    this.ph = h('span', 'ph', 'pergunte algo ou descreva uma tarefa ↵');
    prompt.append(h('span', 'chev', '›'), this.typed, this.cursor, this.ph);

    dock.append(this.think, this.credits, h('div', 'gap'), this.foot, prompt);
    root.replaceChildren(tabs, this.out, dock);
    this.setCtx();
    this.tick = setInterval(() => this.animate(), 130);
    this.frame = 0;
  }

  stop() {
    this.alive = false;
    clearInterval(this.tick);
  }

  animate() {
    if (this.think.hidden || reduced || document.hidden) return;
    this.frame++;
    this.spin.textContent = SPINNER[this.frame % SPINNER.length];
    if (this.frame % 8 === 0) {
      const s = Math.floor((Date.now() - this.t0) / 1000);
      this.meta.textContent = ` (${s}s · ↓ ${(this.tokens / 1000).toFixed(1)}k tokens · esc to interrupt)`;
    }
  }

  setCtx() {
    this.footCtx.textContent = `◔ ${Math.round(this.ctx)}%`;
  }

  setThinking(on) {
    this.think.hidden = !on;
    if (on) {
      this.t0 = Date.now();
      this.tokens = ri(200, 900);
      this.verb.textContent = `${pick(VERBS)}…`;
      this.meta.textContent = ' (0s · esc to interrupt)';
    }
  }

  newVerb() {
    this.verb.textContent = `${pick(VERBS)}…`;
  }

  line(cls) {
    const el = h('div', cls ? `line ${cls}` : 'line');
    this.out.append(el);
    while (this.out.childElementCount > 260) this.out.firstElementChild.remove();
    return el;
  }

  // escreve aos poucos; `trechos` viram texto destacado
  async stream(el, text, { fast = false } = {}) {
    const parts = text.split('`');
    for (let i = 0; i < parts.length && this.alive; i++) {
      const target = i % 2 ? h('span', 'hl') : document.createTextNode('');
      el.append(target);
      const s = parts[i];
      for (let p = 0; p < s.length && this.alive; ) {
        const n = fast ? ri(3, 9) : ri(1, 4);
        target.textContent += s.slice(p, p + n);
        p += n;
        this.tokens += n * 0.3;
        await wait(fast ? ri(6, 18) : ri(10, 32));
        if (!fast && Math.random() < 0.01) await wait(ri(250, 900));
      }
    }
  }

  async typePrompt(text) {
    this.ph.hidden = true;
    for (const ch of text) {
      if (!this.alive) return;
      this.typed.textContent += ch;
      await wait(ri(25, 85));
      if (Math.random() < 0.02) await wait(ri(300, 800));
    }
  }

  async step(s) {
    if (s.k === 'thought') {
      const l = this.line('dim');
      l.textContent = `• Thought for ${ri(1, 14)}s...`;
      await wait(ri(200, 600));
      const l2 = this.line('dim indent');
      l2.append(h('span', 'tree', '└ '));
      const body = h('span');
      l2.append(body);
      await this.stream(body, s.text, { fast: true });
    } else if (s.k === 'say') {
      const l = this.line();
      l.append(h('span', 'bullet', '• '));
      const body = h('span');
      l.append(body);
      await this.stream(body, s.text);
    } else if (s.k === 'tool') {
      const l = this.line();
      l.append(h('span', 'dot', '● '), h('span', 'tool', s.name), h('span', 'dim', `(${s.arg})`));
      await wait(ri(500, 2200));
      const r = this.line('dim indent');
      r.append(h('span', 'tree', '⎿  '), h('span', s.ok ? 'ok' : null, s.out));
    } else if (s.k === 'diff') {
      const l = this.line();
      l.append(h('span', 'dot', '● '), h('span', 'tool', 'Update'), h('span', 'dim', `(${s.file})`));
      await wait(ri(400, 1200));
      const r = this.line('dim indent');
      r.append(h('span', 'tree', '⎿  '), h('span', null, `Updated with ${s.add} additions and ${s.del} removals`));
      let n = ri(8, 120);
      for (const [sign, code] of s.lines) {
        const d = this.line(sign === '+' ? 'diff add' : 'diff del');
        d.append(h('span', 'ln', String(n++).padStart(4, ' ')), h('span', 'sign', ` ${sign} `));
        const body = h('span');
        d.append(body);
        await this.stream(body, code, { fast: true });
      }
    } else if (s.k === 'list') {
      for (const item of s.items) {
        const l = this.line('indent');
        l.append(h('span', 'dim', '- '));
        const body = h('span');
        l.append(body);
        await this.stream(body, item);
        await wait(ri(100, 500));
      }
    }
  }

  nextScenario() {
    if (!this.queue.length) this.queue = shuffle(SCENARIOS);
    return this.queue.shift();
  }

  async turn() {
    const sc = this.nextScenario();
    this.credits.textContent = '';
    this.ph.hidden = false;
    this.typed.textContent = '';
    await wait(ri(2500, 9000)); // parado, esperando a pessoa

    this.titleEl.textContent = sc.title;
    await this.typePrompt(sc.prompt);
    await wait(ri(300, 1100));
    const echo = this.line('user');
    echo.append(h('span', 'chev', '› '), h('span', null, sc.prompt));
    this.typed.textContent = '';
    this.ph.hidden = true;
    this.out.append(h('div', 'line gap'));

    const started = Date.now();
    this.setThinking(true);
    await wait(ri(1800, 7000));
    for (const s of sc.steps) {
      if (!this.alive) return;
      if (Math.random() < 0.4) {
        this.newVerb();
        await wait(ri(1000, 5000)); // pausa longa "pensando"
      }
      await this.step(s);
      this.out.append(h('div', 'line gap'));
      await wait(ri(300, 1800));
    }
    this.setThinking(false);

    const secs = Math.max(1, Math.round((Date.now() - started) / 1000));
    const turnCost = rnd(0.2, 4.5);
    this.session += turnCost;
    this.ctx = this.ctx > 82 ? ri(3, 12) : this.ctx + rnd(2, 9);
    this.setCtx();
    const dur = secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs}s`;
    this.credits.textContent = `▸ Credits: turn ${turnCost.toFixed(2)} • session ${this.session.toFixed(2)} | Time: ${dur}`;
  }

  async run() {
    while (this.alive) {
      try {
        await this.turn();
      } catch {
        await wait(2000);
      }
    }
  }
}

/* ---------- sessão local (Claude Code CLI da própria pessoa) ---------- */
// Fala com a ponte `bridge/bridge.mjs`, que a pessoa roda na máquina dela. O código
// (porta.token) fica só em memória: recarregar a página pede de novo.

const bridge = { base: null, token: null, cwd: null };
const CODE_RE = /^(\d{1,5})\.([A-Za-z0-9_-]{20,64})$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function connectBridge(code) {
  const m = CODE_RE.exec(code.trim());
  if (!m) throw new Error('Código inválido. O formato é porta.token, como mostrado pela ponte.');
  const base = `http://127.0.0.1:${m[1]}`;
  let res;
  try {
    res = await fetch(`${base}/health`, { headers: { authorization: `Bearer ${m[2]}` }, cache: 'no-store' });
  } catch {
    throw new Error('Não consegui falar com a ponte. Ela está rodando? (Safari bloqueia esse acesso; use Chrome ou Firefox.)');
  }
  if (res.status === 401) throw new Error('A ponte recusou o código. Confira se copiou inteiro.');
  if (res.status === 403) throw new Error('A ponte foi iniciada para outro endereço de chat. Reinicie-a com o endereço mostrado acima.');
  if (!res.ok) throw new Error(`A ponte respondeu com erro (${res.status}).`);
  const info = await res.json().catch(() => ({}));
  bridge.base = base;
  bridge.token = m[2];
  bridge.cwd = typeof info.cwd === 'string' ? info.cwd : '';
}

// Comando de uma linha que baixa a ponte do próprio chat e só a executa se o SHA-256 bater. O hash é
// calculado aqui, no navegador, que já validou o HTTPS; o `curl -k` (certificado autoassinado) fica
// seguro porque um arquivo adulterado no caminho não passa na conferência.
let bridgeCmd = null;
function bridgeCommand() {
  bridgeCmd ??= (async () => {
    const res = await fetch('/bridge.mjs', { cache: 'no-store' });
    if (!res.ok) throw new Error('bridge');
    const sum = await crypto.subtle.digest('SHA-256', await res.arrayBuffer());
    const hash = [...new Uint8Array(sum)].map((b) => b.toString(16).padStart(2, '0')).join('');
    const o = location.origin;
    return (
      `d=$(mktemp -d) && curl -fsSk '${o}/bridge.mjs' -o "$d/bridge.mjs" && ` +
      `[ "$( (sha256sum "$d/bridge.mjs" 2>/dev/null || shasum -a 256 "$d/bridge.mjs") | cut -d' ' -f1)" = ${hash} ] && ` +
      `node "$d/bridge.mjs" '${o}'`
    );
  })().catch((e) => {
    bridgeCmd = null;
    throw e;
  });
  return bridgeCmd;
}

// painéis Local abertos: todos dividem a mesma ponte, então a pasta (e o nome da aba) muda para todos
const localPanes = new Set();
const dirName = (p) => (p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p || 'Local');
function setBridgeCwd(next) {
  if (typeof next !== 'string' || !next || next === bridge.cwd) return;
  bridge.cwd = next;
  for (const pane of localPanes) pane.cwdChanged();
}

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function toolArg(input) {
  const i = input && typeof input === 'object' ? input : {};
  const v = i.command ?? i.file_path ?? i.pattern ?? i.path ?? i.url ?? i.description ?? i.prompt ?? '';
  return clip((typeof v === 'string' ? v : JSON.stringify(v)).replace(/\s+/g, ' '), 100);
}

function resultText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((b) => (b && typeof b.text === 'string' ? b.text : '')).join('\n');
  return '';
}

// Comandos tratados no próprio painel; qualquer outro `/algo` vai ao claude (skills e comandos dele).
const LOCAL_CMDS = [
  ['/help', 'lista os comandos do painel'],
  ['/clear', 'limpa a tela e começa uma conversa nova'],
  ['/sair', 'desconecta da ponte'],
  ['/compact', 'resume a conversa (vai ao claude)'],
  ['/cost', 'custo da sessão (vai ao claude)'],
];

async function bridgePost(path, body, signal) {
  return fetch(`${bridge.base}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${bridge.token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
}

// prefixo comum mais longo entre os candidatos (para o Tab completar até onde há consenso)
function commonPrefix(list) {
  let p = list[0] ?? '';
  for (const x of list) while (!x.startsWith(p)) p = p.slice(0, -1);
  return p;
}

class LocalPane {
  constructor(root, cfg, onBack) {
    this.alive = true;
    this.history = [];
    this.histPos = -1;
    this.draft = '';
    this.busy = false;
    this.session = null;
    this.cost = 0;
    this.ctrl = null;
    this.frame = 0;

    const tabs = h('div', 'tabs');
    const back = h('span', 'tab', cfg.initialTitle);
    back.setAttribute('role', 'tab');
    back.tabIndex = 0;
    back.title = 'Voltar à simulação';
    back.addEventListener('click', onBack);
    back.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onBack();
      }
    });
    const loc = h('span', 'tab active');
    this.titleEl = h('span', 'title', 'Local');
    loc.append(h('span', 'star', '✳'), this.titleEl);
    tabs.append(h('span', 'tab dim', 'Terminal'), back, loc, h('span', 'plus', '＋'));

    this.out = h('div', 'out scroll');
    const dock = h('div', 'dock');
    this.think = h('div', 'think');
    this.think.hidden = true;
    this.spin = h('span', 'spin', '✻');
    this.verb = h('span', 'verb', 'Working…');
    this.meta = h('span', 'meta');
    this.think.append(this.spin, this.verb, this.meta);
    this.credits = h('div', 'status');
    this.foot = h('div', 'foot');
    this.footModel = h('span', null, 'claude');
    this.foot.append(h('span', null, 'Permissão total · '), this.footModel);
    this.sugg = h('div', 'sugg');
    this.sugg.hidden = true;
    const prompt = h('div', 'prompt real');
    this.input = h('input', 'real-input');
    this.input.autocomplete = 'off';
    this.input.spellcheck = false;
    this.input.maxLength = 8000;
    prompt.append(h('span', 'chev', '›'), this.input);
    dock.append(this.think, this.credits, h('div', 'gap'), this.foot, this.sugg, prompt);
    root.replaceChildren(tabs, this.out, dock);

    this.input.addEventListener('keydown', (e) => this.onKey(e));
    this.input.addEventListener('input', () => this.showSugg([]));
    this.tick = setInterval(() => this.animate(), 130);

    localPanes.add(this);
    if (bridge.base) this.ready();
    else this.askCode();
    this.input.focus();
  }

  stop() {
    this.alive = false;
    localPanes.delete(this);
    clearInterval(this.tick);
    this.ctrl?.abort();
  }

  line(cls) {
    const el = h('div', cls ? `line ${cls}` : 'line');
    this.out.append(el);
    while (this.out.childElementCount > 400) this.out.firstElementChild.remove();
    this.out.scrollTop = this.out.scrollHeight;
    return el;
  }

  // `trechos` viram texto destacado, igual ao simulado
  inline(el, text) {
    text.split('`').forEach((part, i) => {
      if (!part) return;
      if (i % 2) el.append(h('span', 'hl', part));
      else el.append(document.createTextNode(part));
    });
  }

  note(text, cls) {
    this.line(cls).textContent = text;
  }

  // a aba mostra a pasta atual da ponte; sem conexão volta a ser "Local"
  setTitle() {
    const name = this.mode === 'chat' && bridge.cwd ? clip(dirName(bridge.cwd), 24) : 'Local';
    this.titleEl.textContent = name;
    this.titleEl.title = this.mode === 'chat' && bridge.cwd ? bridge.cwd : '';
  }

  // o claude guarda as sessões por pasta: depois de um `cd`, retomar a anterior falharia
  cwdChanged() {
    if (!this.alive || this.mode !== 'chat') return;
    this.setTitle();
    this.session = null;
    this.note(`Pasta agora: ${bridge.cwd} · próxima pergunta abre uma conversa nova`, 'dim indent');
  }

  askCode() {
    this.mode = 'code';
    this.setTitle();
    this.input.type = 'password';
    this.input.placeholder = 'cole o código da ponte ↵';
    this.out.replaceChildren();
    this.note('Local · conecte ao Claude Code desta máquina', 'dim');
    this.note('1. No terminal da sua máquina (precisa de Node 24 e do claude), na pasta do projeto, cole:');
    const cmd = this.line('indent');
    cmd.append(h('span', 'dim', 'gerando comando…'));
    bridgeCommand().then(
      (text) => {
        if (!this.alive) return;
        const copy = h('button', 'link', 'copiar');
        copy.type = 'button';
        copy.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(text);
            copy.textContent = 'copiado';
          } catch {
            copy.textContent = 'selecione e copie à mão';
          }
        });
        cmd.replaceChildren(h('span', 'hl', text), document.createTextNode(' '), copy);
        this.out.scrollTop = this.out.scrollHeight;
      },
      () => {
        if (this.alive) cmd.replaceChildren(h('span', 'err', 'Não consegui preparar o comando. Recarregue a página.'));
      },
    );
    this.note('2. Cole abaixo o código mostrado (porta.token) e tecle Enter.');
    this.note('A ponte roda o Claude Code com permissão total nessa pasta.', 'dim');
  }

  ready() {
    this.mode = 'chat';
    this.setTitle();
    this.input.type = 'text';
    this.input.placeholder = 'pergunte algo ou descreva uma tarefa ↵';
    this.out.replaceChildren();
    const l = this.line();
    l.append(h('span', 'dot', '● '), h('span', null, 'Conectado ao Claude Code local'));
    this.note('Esc interrompe · permissão total na pasta da ponte', 'dim indent');
    this.note('/ comandos · ! roda no shell · Tab completa · ↑↓ histórico', 'dim indent');
    this.out.append(h('div', 'line gap'));
  }

  animate() {
    if (this.think.hidden || reduced || document.hidden) return;
    this.frame++;
    this.spin.textContent = SPINNER[this.frame % SPINNER.length];
    if (this.frame % 8 === 0) {
      this.meta.textContent = ` (${Math.floor((Date.now() - this.t0) / 1000)}s · esc to interrupt)`;
    }
  }

  setThinking(on) {
    this.think.hidden = !on;
    if (on) {
      this.t0 = Date.now();
      this.verb.textContent = `${pick(VERBS)}…`;
      this.meta.textContent = ' (0s · esc to interrupt)';
    }
  }

  showSugg(items) {
    this.sugg.hidden = !items.length;
    this.sugg.replaceChildren();
    if (items.length) this.sugg.append(h('span', 'dim', items.join('   ')));
  }

  // Tab: `/cmd` completa entre os comandos; `!cmd` e `@caminho` completam o último trecho como caminho
  async complete() {
    const v = this.input.value;
    if (this.mode !== 'chat' || this.busy) return;
    if (/^\/\S*$/.test(v)) {
      const hits = LOCAL_CMDS.filter(([c]) => c.startsWith(v));
      if (!hits.length) return;
      const common = commonPrefix(hits.map(([c]) => c));
      if (hits.length === 1) this.input.value = `${hits[0][0]} `;
      else if (common.length > v.length) this.input.value = common;
      this.showSugg(hits.length > 1 ? hits.map(([c]) => c) : []);
      return;
    }
    const m = /(^|\s)(!?)(@?)(\S*)$/.exec(v);
    if (!m || !(v.startsWith('!') || m[3])) return;
    const token = m[4];
    const head = v.slice(0, v.length - token.length);
    this.busy = true;
    try {
      const res = await bridgePost('/complete', { prefix: token });
      if (!res.ok || !this.alive || this.input.value !== v) return;
      const { items } = await res.json();
      if (!Array.isArray(items) || !items.length) return this.showSugg([]);
      const names = items.filter((x) => typeof x === 'string');
      const base = token.endsWith('/') || token === '' ? '' : token.slice(token.lastIndexOf('/') + 1);
      const dir = token.slice(0, token.length - base.length);
      const common = commonPrefix(names);
      if (names.length === 1) this.input.value = `${head}${dir}${names[0]}`;
      else if (common.length > base.length) this.input.value = `${head}${dir}${common}`;
      this.showSugg(names.length > 1 ? names.map((x) => clip(x, 40)) : []);
    } catch {
      // sem sugestões
    } finally {
      this.busy = false;
    }
  }

  historyStep(dir) {
    if (!this.history.length) return;
    if (this.histPos === -1) {
      if (dir > 0) return;
      this.draft = this.input.value;
      this.histPos = this.history.length;
    }
    this.histPos = Math.min(this.history.length, Math.max(0, this.histPos + dir));
    this.input.value = this.histPos >= this.history.length ? this.draft : this.history[this.histPos];
    if (this.histPos >= this.history.length) this.histPos = -1;
  }

  async onKey(e) {
    if (e.key === 'Escape' && this.busy) {
      e.preventDefault();
      this.ctrl?.abort();
      return;
    }
    if (e.key === 'Tab' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      return this.complete();
    }
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && this.mode === 'chat') {
      e.preventDefault();
      return this.historyStep(e.key === 'ArrowUp' ? -1 : 1);
    }
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    const text = this.input.value.trim();
    if (!text || this.busy) return;
    this.input.value = '';
    this.showSugg([]);
    if (this.mode === 'code') return this.tryConnect(text);
    this.history.push(text);
    if (this.history.length > 100) this.history.shift();
    this.histPos = -1;
    if (text === '/sair') {
      bridge.base = bridge.token = null;
      this.session = null;
      return this.askCode();
    }
    if (text === '/clear') {
      this.session = null;
      this.cost = 0;
      this.credits.textContent = '';
      return this.ready();
    }
    if (text === '/help') {
      this.line('user').append(h('span', 'chev', '› '), h('span', null, text));
      for (const [c, d] of LOCAL_CMDS) this.note(`${c}  ${d}`, 'dim indent');
      this.note('!comando  roda no shell da sua máquina, na pasta da ponte (120 s no máximo)', 'dim indent');
      this.note('@caminho  Tab completa nomes de arquivos; qualquer outro /comando vai ao claude', 'dim indent');
      return;
    }
    if (text.startsWith('!')) return this.runShell(text.slice(1).trim());
    return this.ask(text);
  }

  async runShell(command) {
    if (!command) return;
    this.busy = true;
    this.credits.textContent = '';
    this.line('user').append(h('span', 'chev', '! '), h('span', null, command));
    this.setThinking(true);
    this.ctrl = new AbortController();
    try {
      const res = await bridgePost('/shell', { command }, this.ctrl.signal);
      if (res.status === 429) throw new Error('A ponte está ocupada com outras sessões. Tente de novo em instantes.');
      if (!res.ok) throw new Error(`A ponte respondeu com erro (${res.status}).`);
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = '';
      const handle = (raw) => {
        let ev;
        try {
          ev = JSON.parse(raw);
        } catch {
          return;
        }
        if (ev?.type === 'out' && typeof ev.data === 'string') {
          for (const ln of ev.data.replace(/\r/g, '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').split('\n')) {
            if (ln !== '') this.note(clip(ln, 500), ev.stream === 'stderr' ? 'err indent' : 'indent');
          }
        } else if (ev?.type === 'exit') {
          if (ev.code) this.note(`saiu com código ${Number(ev.code)}`, 'dim indent');
          setBridgeCwd(ev.cwd);
        } else if (ev?.type === 'bridge_error') {
          this.note(clip(String(ev.message ?? 'Erro na ponte.'), 300), 'err');
        }
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += value;
        for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
          handle(buf.slice(0, i));
          buf = buf.slice(i + 1);
        }
      }
      if (buf.trim()) handle(buf);
    } catch (err) {
      if (!this.alive) return;
      if (err.name === 'AbortError') this.note('Interrompido.', 'dim');
      else this.note(err.message || 'Falha na conexão com a ponte.', 'err');
    } finally {
      this.busy = false;
      this.ctrl = null;
      if (this.alive) {
        this.setThinking(false);
        this.out.append(h('div', 'line gap'));
        this.out.scrollTop = this.out.scrollHeight;
        this.input.focus();
      }
    }
  }

  async tryConnect(code) {
    this.busy = true;
    try {
      await connectBridge(code);
      if (this.alive) this.ready();
    } catch (err) {
      if (this.alive) this.note(err.message, 'err');
    } finally {
      this.busy = false;
    }
  }

  async ask(prompt) {
    this.busy = true;
    this.credits.textContent = '';
    const echo = this.line('user');
    echo.append(h('span', 'chev', '› '), h('span', null, prompt));
    this.out.append(h('div', 'line gap'));
    this.setThinking(true);
    const started = Date.now();
    this.ctrl = new AbortController();
    try {
      const res = await bridgePost('/chat', { prompt, session: this.session }, this.ctrl.signal);
      if (res.status === 429) throw new Error('A ponte está ocupada com outras sessões. Tente de novo em instantes.');
      if (!res.ok) throw new Error(`A ponte respondeu com erro (${res.status}).`);
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += value;
        for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
          this.event(buf.slice(0, i));
          buf = buf.slice(i + 1);
        }
      }
      if (buf.trim()) this.event(buf);
    } catch (err) {
      if (!this.alive) return;
      if (err.name === 'AbortError') this.note('Interrompido.', 'dim');
      else this.note(err.message || 'Falha na conexão com a ponte.', 'err');
    } finally {
      this.busy = false;
      this.ctrl = null;
      if (this.alive) {
        this.setThinking(false);
        const secs = Math.max(1, Math.round((Date.now() - started) / 1000));
        const dur = secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs}s`;
        this.credits.textContent = `▸ Credits: session ${this.cost.toFixed(2)} | Time: ${dur}`;
        this.out.append(h('div', 'line gap'));
        this.out.scrollTop = this.out.scrollHeight;
        this.input.focus();
      }
    }
  }

  // uma linha NDJSON do `claude -p --output-format stream-json`; tudo aqui é dado externo
  event(raw) {
    let ev;
    try {
      ev = JSON.parse(raw);
    } catch {
      return;
    }
    if (!ev || typeof ev !== 'object') return;
    if (ev.type === 'system' && ev.subtype === 'init') {
      if (typeof ev.session_id === 'string' && UUID_RE.test(ev.session_id)) this.session = ev.session_id;
      if (typeof ev.model === 'string') this.footModel.textContent = clip(ev.model, 40);
    } else if (ev.type === 'assistant') {
      const blocks = Array.isArray(ev.message?.content) ? ev.message.content : [];
      for (const b of blocks) {
        if (b?.type === 'text' && typeof b.text === 'string' && b.text.trim()) {
          const l = this.line();
          l.append(h('span', 'bullet', '• '));
          const body = h('span');
          this.inline(body, b.text.trim());
          l.append(body);
        } else if (b?.type === 'tool_use') {
          const l = this.line();
          l.append(h('span', 'dot', '● '), h('span', 'tool', clip(String(b.name ?? 'Tool'), 30)), h('span', 'dim', `(${toolArg(b.input)})`));
        }
      }
    } else if (ev.type === 'user') {
      const blocks = Array.isArray(ev.message?.content) ? ev.message.content : [];
      for (const b of blocks) {
        if (b?.type !== 'tool_result') continue;
        const lines = resultText(b.content).split('\n').filter((x) => x.trim());
        const first = clip(lines[0] ?? '(sem saída)', 160);
        const more = lines.length > 1 ? ` … +${lines.length - 1} linhas` : '';
        const r = this.line('dim indent');
        r.append(h('span', 'tree', '⎿  '), h('span', b.is_error ? 'err' : null, first + more));
      }
    } else if (ev.type === 'result') {
      if (typeof ev.session_id === 'string' && UUID_RE.test(ev.session_id)) this.session = ev.session_id;
      if (typeof ev.total_cost_usd === 'number') this.cost += ev.total_cost_usd;
      if (ev.is_error) this.note(clip(String(ev.result ?? 'Erro do Claude Code.'), 300), 'err');
    } else if (ev.type === 'bridge_error') {
      this.note(clip(String(ev.message ?? 'Erro na ponte.'), 300), 'err');
    }
  }
}

const PANES = [
  { initialTitle: 'refatorar cálculo de frete', model: 'claude-opus-5-5', effort: 'medium', cwd: '~/projetos/loja-api', branch: 'feature/frete' },
  { initialTitle: 'migração da tabela de estoque', model: 'claude-opus-5-5', effort: 'high', cwd: '~/projetos/loja-api', branch: 'homolog' },
  { initialTitle: 'corrigir teste instável do checkout', model: 'claude-sonnet-5-5', effort: 'medium', cwd: '~/projetos/loja-web', branch: 'main' },
];

const CAMO_CFG = { initialTitle: 'revisar PR de permissões', model: 'claude-opus-5-5', effort: 'high', cwd: '~/projetos/loja-api', branch: 'feature/permissoes' };

/** Sessão decorativa que cobre o chat real (camuflagem). Retorna uma função para pará-la. */
export function startCamouflage(root) {
  const p = new FakePane(root, CAMO_CFG, shuffle(SCENARIOS));
  p.run();
  return () => p.stop();
}

/** Inicia os terminais decorativos nos elementos dados. Retorna uma função para pará-los. */
export function startFakePanes(roots) {
  const order = shuffle(SCENARIOS);
  const cur = [];
  const cfgOf = (i) => PANES[i % PANES.length];
  const fake = (i, queue, delay) => {
    const p = new FakePane(roots[i], cfgOf(i), queue, { onLocal: () => local(i) });
    cur[i] = p;
    setTimeout(() => p.run(), delay);
  };
  // a aba "Local" troca o painel pela sessão real; clicar na outra aba volta à simulação
  const local = (i) => {
    cur[i].stop();
    const p = new LocalPane(roots[i], cfgOf(i), () => {
      p.stop();
      fake(i, shuffle(SCENARIOS), 0);
    });
    cur[i] = p;
  };
  roots.forEach((_, i) => fake(i, order.slice(i * 2).concat(order.slice(0, i * 2)), i * 1200)); // começam defasados
  return () => cur.forEach((p) => p.stop());
}
