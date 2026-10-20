/*
 * 明析 AI · 纯 HTML / CSS / JS 版本
 *
 * 这一版不依赖 React / Vite 构建：index.html + app.js + styles.css 即可运行。
 * 路由用 hash（#/、#/history、#/me、#/login），因此可以直接放在任意静态目录。
 * 接口仍走同源的 /api（Vite dev server 会代理到 8322；生产环境交给后端反代）。
 *
 * 充值部分只接模拟支付或持牌渠道收银台，不含个人钱包地址、二维码、
 * 链上监听或人工加余额入口。
 */

// ------------------------------------------------------------------ 状态
const state = {
  user: null,
  loading: true,
  siteStatus: null,
  redirect: '/',

  // 研究台
  researchLoaded: false,
  symbols: [],
  total: 0,
  quotes: {},
  tickDir: {},
  search: '',
  sector: '',
  visibleCount: 60,
  selected: null,
  timeframe: '1h',
  models: [],
  model: 'auto',
  cost: 10,
  chart: null,
  chartLoading: false,
  card: null,
  running: false,
  researchError: '',
  liveAt: null,
  liveSource: '',
  liveError: '',
  researchTimer: null,
  chartTimer: null,
  searchTimer: null,

  // 历史
  historyItems: [],
  historyTotal: 0,
  historyQ: '',
  historyLoading: false,
  historyError: '',
  historyDetail: null,

  // 我的
  summary: null,
  ownerState: null,
  ownerError: '',
  ownerBusy: false,
  tab: 'ledger',
  rows: [],
  rowsLoading: false,
  amount: '5',
  meBusy: false,
  meNotice: '',
  payment: null,
  paymentChecking: false,
  paymentTimer: null,
  pwCountdown: 0,
  pwTimer: null,

  // 顶栏
  btcQuote: null,
  btcFailed: false,
  btcTimer: null,
  lastBtc: null,
  gateTimer: null,
};

const TOKEN_KEY = 'mx_token';
const TICK_MS = 3000;
const CHART_MS = 20000;
const VISIBLE_STEP = 60;
const POLL_LIMIT = 300;
const HOT = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'];

// ------------------------------------------------------------------ 工具
const $ = (id) => document.getElementById(id);

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function fmtNum(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return Number(value).toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function fmtCompact(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  const n = Number(value);
  if (Math.abs(n) >= 1e8) return `${(n / 1e8).toFixed(2)} 亿`;
  if (Math.abs(n) >= 1e4) return `${(n / 1e4).toFixed(2)} 万`;
  return n.toFixed(0);
}

function fmtPct(value) {
  if (value === null || value === undefined) return '—';
  const n = Number(value);
  return `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
}

function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso.endsWith('Z') ? iso : `${iso}Z`);
  return d.toLocaleString('zh-CN', { hour12: false });
}

function clockText(date) {
  return date ? date.toLocaleTimeString('zh-CN', { hour12: false }) : '';
}

function getToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

function show(node) {
  if (node) node.hidden = false;
}

function hide(node) {
  if (node) node.hidden = true;
}

// ------------------------------------------------------------------ 接口
class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function api(path, { method = 'GET', body, auth = true } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = getToken();
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('网络连接失败，请检查后端是否已启动', 0);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) {
      setToken('');
      state.user = null;
    }
    if (res.status === 503 && data.code === 'site_disabled') {
      window.dispatchEvent(new Event('mx:site-off'));
    }
    throw new ApiError(data.detail || `请求失败（${res.status}）`, res.status);
  }
  return data;
}

// ------------------------------------------------------------------ 路由
function currentPath() {
  const raw = location.hash.replace(/^#/, '') || '/';
  return raw.startsWith('/') ? raw : `/${raw}`;
}

function go(path) {
  const next = `#${path}`;
  if (location.hash !== next) location.hash = next;
  else renderRoute();
}

function isAuthPath(path) {
  return path === '/login' || path === '/register';
}

function isProtectedPath(path) {
  return path === '/' || path === '/history' || path === '/me';
}

// ------------------------------------------------------------------ 站点开关
async function loadSiteStatus() {
  const previous = state.siteStatus?.enabled;
  try {
    state.siteStatus = await api('/site/status', { auth: false });
  } catch {
    // 状态接口都挂了（比如后端没启动）就放行，让页面自己显示网络错误
    if (!state.siteStatus) state.siteStatus = { enabled: true, message: '' };
  }
  // 只有开关翻转时才重走路由：否则每 10 秒轮询都会把 /me 的数据重拉一遍。
  // 从维护页恢复时必须重走，否则 appShell 还停在 hidden。
  if (previous === undefined || previous !== state.siteStatus.enabled) renderRoute();
  else renderSiteGate();
}

function renderSiteGate() {
  if (state.loading || !state.siteStatus) return;
  const path = currentPath();
  const off = !state.siteStatus.enabled && path !== '/login';

  hide($('boot'));
  $('siteOff').hidden = !off;
  if (!off) return;

  $('siteOffMessage').textContent = state.siteStatus.message || '站点暂时关闭，请稍后再试。';
  $('siteOffTime').textContent = state.siteStatus.updated_at
    ? `关闭时间 ${fmtTime(state.siteStatus.updated_at)}`
    : '';

  const box = $('siteOffOwner');
  if (state.user?.is_owner) {
    box.innerHTML = `
      <button class="btn btn-primary" id="siteOffEnable">重新开启站点</button>
      <div class="error" id="siteOffError" style="margin-top:12px" hidden></div>`;
    $('siteOffEnable').addEventListener('click', enableSite);
  } else if (state.user) {
    box.innerHTML = '<div class="muted" style="font-size:12.5px">当前账号没有开关权限。</div>';
  } else {
    box.innerHTML = '<a href="#/login" class="btn btn-ghost" style="border:1px solid var(--border-strong)">所有者登录</a>';
  }
}

async function enableSite() {
  const btn = $('siteOffEnable');
  const err = $('siteOffError');
  if (btn) { btn.disabled = true; btn.textContent = '处理中…'; }
  if (err) err.hidden = true;
  try {
    state.siteStatus = await api('/owner/site', { method: 'POST', body: { enabled: true } });
    window.dispatchEvent(new Event('mx:site-on'));
    renderRoute();
  } catch (e) {
    if (err) { err.textContent = e.message; err.hidden = false; }
    if (btn) { btn.disabled = false; btn.textContent = '重新开启站点'; }
  }
}

// ------------------------------------------------------------------ 认证
async function refreshUser() {
  if (!getToken()) {
    state.user = null;
    state.loading = false;
    return;
  }
  try {
    state.user = await api('/auth/me');
  } catch {
    setToken('');
    state.user = null;
  } finally {
    state.loading = false;
  }
}

async function login(email, password) {
  const data = await api('/auth/login', {
    method: 'POST',
    body: { email, password },
    auth: false,
  });
  setToken(data.access_token);
  state.user = data.user;
}

async function register(payload) {
  const data = await api('/auth/register', { method: 'POST', body: payload, auth: false });
  setToken(data.access_token);
  state.user = data.user;
}

function logout() {
  setToken('');
  state.user = null;
  stopResearchTimers();
  stopBtcTimer();
  stopPaymentPolling();
  go('/login');
}

// ------------------------------------------------------------------ 主渲染
function renderRoute() {
  if (state.loading) {
    show($('boot'));
    return;
  }

  const path = currentPath();
  const siteOff = state.siteStatus && !state.siteStatus.enabled && path !== '/login';

  hide($('boot'));
  renderSiteGate();
  if (siteOff) {
    hide($('appShell'));
    hide($('authPage'));
    stopResearchTimers();
    stopBtcTimer();
    return;
  }

  if (isAuthPath(path)) {
    if (state.user) {
      go('/');
      return;
    }
    hide($('appShell'));
    show($('authPage'));
    $('loginView').hidden = path !== '/login';
    $('registerView').hidden = path !== '/register';
    stopResearchTimers();
    stopBtcTimer();
    return;
  }

  if (!state.user) {
    state.redirect = isProtectedPath(path) ? path : '/';
    go('/login');
    return;
  }

  if (!isProtectedPath(path)) {
    go('/');
    return;
  }

  show($('appShell'));
  hide($('authPage'));

  hide($('pageResearch'));
  hide($('pageHistory'));
  hide($('pageMe'));

  // 离开页面时清掉只属于该页的临时状态（React 版靠组件卸载完成）。
  if (path !== '/me') stopPaymentPolling();
  if (path !== '/history') state.historyDetail = null;

  if (path === '/') {
    show($('pageResearch'));
    enterResearch();
  } else if (path === '/history') {
    show($('pageHistory'));
    stopResearchTimers();
    renderHistoryPage();
    loadHistory();
  } else if (path === '/me') {
    show($('pageMe'));
    stopResearchTimers();
    loadMe();
  }

  renderHeader(path);
  loadTopBalance();
  startBtcTimer();
}

function renderHeader(path) {
  document.querySelectorAll('#mainNav a').forEach((a) => {
    a.classList.toggle('active', a.dataset.route === path);
  });
  const user = state.user || {};
  $('avatar').textContent = (user.nickname || user.email || 'U').slice(0, 2).toUpperCase();
  $('avatar').title = user.email || '';
}

// ------------------------------------------------------------------ 顶栏行情 / 余额
function startBtcTimer() {
  if (state.btcTimer) return;
  loadBtc();
  state.btcTimer = window.setInterval(() => {
    if (!document.hidden) loadBtc();
  }, 5000);
}

function stopBtcTimer() {
  if (state.btcTimer) {
    window.clearInterval(state.btcTimer);
    state.btcTimer = null;
  }
}

async function loadBtc() {
  try {
    const d = await api('/market/ticker?market=crypto&symbols=BTCUSDT');
    const item = d.items?.[0] || null;
    state.btcQuote = item;
    state.btcFailed = !item;
    if (item) {
      const prev = state.lastBtc;
      state.lastBtc = item.price;
      state.btcTick = prev !== null && prev !== undefined && item.price !== prev
        ? (item.price > prev ? 'tick-up' : 'tick-down')
        : '';
    }
  } catch {
    state.btcFailed = true;
  }
  renderBtcChip();
}

function renderBtcChip() {
  const box = $('btcChip');
  if (!box) return;
  if (state.btcFailed) {
    box.innerHTML = '<div class="quote-chip quote-chip--offline" title="行情接口不可用"><span class="quote-sym">BTC</span><span>行情离线</span></div>';
    return;
  }
  const q = state.btcQuote;
  const up = (q?.change_24h ?? 0) >= 0;
  box.innerHTML = `
    <div class="quote-chip" title="${q ? `Gate.io · ${esc(q.price)} USDT` : '加载中'}">
      <span class="quote-sym">BTC</span>
      <span class="live-price quote-price ${state.btcTick || ''}">${fmtNum(q?.price, 2)}</span>
      ${q ? `<span class="quote-chg ${up ? 'up' : 'down'}">${fmtPct(q.change_24h)}</span>` : ''}
    </div>`;
}

async function loadTopBalance() {
  if (!state.user) return;
  try {
    const data = await api('/user/summary');
    state.summary = data;
    $('topBalance').textContent = data.quota?.available ?? '—';
  } catch {
    /* 顶栏余额不是关键路径，静默失败 */
  }
}

// ------------------------------------------------------------------ 研究台
function setResearchError(message) {
  state.researchError = message || '';
  const box = $('researchError');
  if (!box) return;
  if (!message) {
    box.innerHTML = '';
    return;
  }
  const recharge = message.includes('Token')
    ? ' · <a href="#/me" style="text-decoration:underline">去充值</a>'
    : '';
  box.innerHTML = `<div class="source-warn" style="margin-bottom:16px">${esc(message)}${recharge}</div>`;
}

function enterResearch() {
  renderSymbolList();
  renderLivePanel();
  renderResultArea();
  renderHeroLive();
  if (!state.researchLoaded) initResearch();
  startResearchTicker();
  if (state.selected) startChartTimer();
}

async function initResearch() {
  state.researchLoaded = true;
  try {
    const d = await api('/market/symbols?market=crypto');
    state.symbols = d.items || [];
    state.total = d.total || state.symbols.length;
    for (const it of state.symbols) {
      if (it.price !== undefined) state.quotes[it.symbol] = it;
    }
    renderSectors();
    pickDefaultSymbol();
    renderResearchMeta();
    renderSymbolList();
    tickMarket();
  } catch (e) {
    setResearchError(e.message);
  }

  api('/market/models').then((d) => {
    state.models = d.items || [];
    renderModelSelect();
  }).catch(() => {});

  api('/analysis/cost').then((d) => {
    state.cost = d.cost;
    renderResearchMeta();
  }).catch(() => {});
}

function renderResearchMeta() {
  $('symbolTotal').textContent = `${state.total} 个交易对`;
  $('heroCost').textContent = state.cost;
  $('noteCost').textContent = state.cost;
  $('currentSymbol').textContent = state.selected ? state.selected.symbol : '—';
  $('runBtn').disabled = state.running || !state.selected;
  $('runBtn').innerHTML = state.running
    ? '<span class="spinner"></span> 研究中…'
    : `开始 AI 研究（${state.cost} Token）`;
}

function renderSectors() {
  const sectors = [...new Set(state.symbols.map((s) => s.sector).filter(Boolean))];
  const select = $('sectorSelect');
  const current = state.sector;
  select.innerHTML = '<option value="">全部类别</option>' +
    sectors.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
  select.value = current;
}

function renderModelSelect() {
  const select = $('modelSelect');
  select.innerHTML = state.models.map((m) => (
    `<option value="${esc(m.id)}" ${m.available === false ? 'disabled' : ''}>${esc(m.name)}</option>`
  )).join('');
  select.value = state.model;
}

function pickDefaultSymbol() {
  if (state.selected) return;
  const hot = HOT.find((s) => state.symbols.some((x) => x.symbol === s));
  state.selected = state.symbols.find((s) => s.symbol === hot) || state.symbols[0] || null;
  if (state.selected) {
    $('currentSymbol').textContent = state.selected.symbol;
    startChartTimer();
  }
}

function filteredSymbols() {
  const q = state.search.trim().toUpperCase();
  return state.symbols.filter((s) => {
    if (state.sector && s.sector !== state.sector) return false;
    return !q
      || String(s.symbol).toUpperCase().includes(q)
      || String(s.name || '').toUpperCase().includes(q);
  });
}

function renderSymbolList() {
  const list = filteredSymbols();
  const visible = list.slice(0, state.visibleCount);
  const box = $('symbolList');

  if (!visible.length) {
    box.innerHTML = '<div class="muted" style="padding:16px;font-size:12.5px">没有匹配的标的</div>';
    return;
  }

  const html = visible.map((s) => {
    const q = state.quotes[s.symbol];
    const up = (q?.change_24h ?? 0) >= 0;
    const tick = state.tickDir[s.symbol] || '';
    return `
      <button class="symbol-item ${state.selected?.symbol === s.symbol ? 'active' : ''}" data-symbol="${esc(s.symbol)}">
        <span>
          <div class="sym">${esc(s.symbol)}</div>
          <div class="name">${esc(s.name)} · ${esc(s.sector)}</div>
        </span>
        <span class="px" style="text-align:right">
          <span class="live-price px-num ${tick}">${fmtNum(q?.price, 2)}</span>
          <div class="${up ? 'up' : 'down'}" style="font-size:11px">${q ? fmtPct(q.change_24h) : ''}</div>
        </span>
      </button>`;
  }).join('');

  const more = list.length > visible.length
    ? `<button class="show-more" data-action="more">显示更多 · 还有 ${list.length - visible.length} 个</button>`
    : '';

  box.innerHTML = html + more;
}

function selectSymbol(symbol) {
  const next = state.symbols.find((s) => s.symbol === symbol);
  if (!next || next.symbol === state.selected?.symbol) return;
  state.selected = next;
  state.chart = null;
  $('currentSymbol').textContent = next.symbol;
  $('runBtn').disabled = state.running;
  renderSymbolList();
  startChartTimer();
}

function startResearchTicker() {
  if (state.researchTimer) return;
  tickMarket();
  state.researchTimer = window.setInterval(() => {
    if (!document.hidden) tickMarket();
  }, TICK_MS);
}

function stopResearchTimers() {
  if (state.researchTimer) {
    window.clearInterval(state.researchTimer);
    state.researchTimer = null;
  }
  if (state.chartTimer) {
    window.clearInterval(state.chartTimer);
    state.chartTimer = null;
  }
}

async function tickMarket() {
  const symbols = filteredSymbols().slice(0, POLL_LIMIT).map((s) => s.symbol);
  if (!symbols.length) return;
  try {
    const d = await api(`/market/ticker?market=crypto&symbols=${symbols.join(',')}`);
    for (const item of d.items || []) {
      const prev = state.quotes[item.symbol]?.price;
      if (prev !== undefined && prev !== null && item.price !== prev) {
        state.tickDir[item.symbol] = item.price > prev ? 'tick-up' : 'tick-down';
      }
      state.quotes[item.symbol] = item;
    }
    state.liveAt = new Date();
    state.liveSource = d.items?.[0]?.source_label || '';
    state.liveError = d.missing?.length ? `部分标的暂无报价：${d.missing.join(', ')}` : '';
  } catch (e) {
    state.liveError = e.message;
  }
  renderHeroLive();
  renderSymbolList();
  renderLivePanel();
  if (!state.card) renderResultArea();
}

function renderHeroLive() {
  const text = $('heroLiveText');
  const box = $('heroLive');
  const line = $('liveLine');
  const lineText = $('liveLineText');
  if (state.liveError) {
    text.textContent = '行情连接异常';
    box.classList.add('is-warn');
    line.classList.add('has-error');
    line.querySelector('.live-dot')?.classList.add('warn');
    lineText.innerHTML = `<span class="down">${esc(state.liveError)}</span>`;
  } else {
    text.textContent = `LIVE · ${state.liveSource || '连接中'} · ${TICK_MS / 1000}s`;
    box.classList.remove('is-warn');
    line.classList.remove('has-error');
    line.querySelector('.live-dot')?.classList.remove('warn');
    lineText.innerHTML = `实时行情 · ${esc(state.liveSource || '连接中')}${state.liveAt ? ` <span class="muted">· ${clockText(state.liveAt)}</span>` : ''}`;
  }
}

function startChartTimer() {
  if (state.chartTimer) {
    window.clearInterval(state.chartTimer);
    state.chartTimer = null;
  }
  if (!state.selected) return;
  loadChart();
  state.chartTimer = window.setInterval(() => {
    if (!document.hidden) loadChart();
  }, CHART_MS);
}

async function loadChart() {
  if (!state.selected) return;
  state.chartLoading = true;
  renderLivePanel();
  try {
    const d = await api(`/market/overview?symbol=${encodeURIComponent(state.selected.symbol)}&market=crypto&interval=${state.timeframe}`);
    state.chart = { candles: d.candles || [], interval: state.timeframe };
  } catch {
    state.chart = null;
  } finally {
    state.chartLoading = false;
    renderLivePanel();
  }
}

let sparkSeq = 0;

function sparkline(data, color = '#658408', height = 74, showDot = false) {
  if (!data || data.length < 2) return '';
  const values = data.map((d) => (Array.isArray(d) ? d[1] : d));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const w = 600;
  const h = height;
  const pad = 4;
  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = pad + (1 - (v - min) / span) * (h - pad * 2);
    return [x, y];
  });
  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `0,${h} ${line} ${w},${h}`;
  const [lastX, lastY] = points[points.length - 1];
  const id = `spark-${++sparkSeq}`;

  return `
    <svg class="sparkline" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="价格走势">
      <defs>
        <linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${color}" stop-opacity="0.22"></stop>
          <stop offset="100%" stop-color="${color}" stop-opacity="0"></stop>
        </linearGradient>
      </defs>
      <polygon points="${area}" fill="url(#${id})"></polygon>
      <polyline points="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"></polyline>
      ${showDot ? `<circle cx="${lastX}" cy="${lastY}" r="4" fill="${color}" stroke="#f8f6ef" stroke-width="2" vector-effect="non-scaling-stroke">
        <animate attributeName="r" values="3.5;5;3.5" dur="2s" repeatCount="indefinite"></animate>
      </circle>` : ''}
    </svg>`;
}

function liveCandles() {
  if (!state.chart?.candles?.length) return [];
  const quote = state.selected ? state.quotes[state.selected.symbol] : null;
  if (!quote) return state.chart.candles;
  const next = state.chart.candles.slice();
  const last = next[next.length - 1];
  next[next.length - 1] = [last[0], quote.price];
  return next;
}

function renderLivePanel() {
  const box = $('livePanel');
  const selected = state.selected;
  if (!box) return;
  if (!selected) {
    box.innerHTML = '';
    return;
  }
  const quote = state.quotes[selected.symbol];
  const up = (quote?.change_24h ?? 0) >= 0;
  const lineColor = up ? '#087a55' : '#bc3550';
  const candles = liveCandles();
  const card = state.card;
  const cardDelta = card && card.symbol === selected.symbol && quote?.price && card.price
    ? ((quote.price - card.price) / card.price) * 100
    : null;
  const intervalLabel = {
    '15m': '15 分钟', '1h': '1 小时', '4h': '4 小时', '1d': '日线',
  }[state.timeframe] || state.timeframe;

  box.innerHTML = `
    <div class="card live-panel">
      <div class="lp-head">
        <div>
          <div class="lp-symbol">
            ${esc(selected.symbol)}
            <span>${esc(selected.name)}</span>
            <span class="chip chip-lime">${intervalLabel}</span>
          </div>
          <div class="lp-meta">
            ${esc(quote?.source_label || 'Gate.io')}
            ${state.liveAt ? `· 更新于 ${clockText(state.liveAt)}` : ''}
            <span class="lp-cadence">每 ${TICK_MS / 1000} 秒刷新</span>
          </div>
        </div>
        <div class="lp-price">
          <span class="live-price lp-num">${fmtNum(quote?.price, 2)}</span>
          <div class="lp-chg ${up ? 'up' : 'down'}">${quote ? fmtPct(quote.change_24h) : '—'}<span>24H</span></div>
        </div>
      </div>
      <div class="lp-chart">
        ${candles.length >= 2
          ? sparkline(candles, lineColor, 118, true)
          : `<div class="lp-chart-empty">${state.chartLoading ? '<span class="spinner dark"></span>' : 'K 线加载中…'}</div>`}
      </div>
      <div class="lp-stats">
        <div><span>24H 最高</span><b>${quote ? fmtNum(quote.high_24h, 2) : '—'}</b></div>
        <div><span>24H 最低</span><b>${quote ? fmtNum(quote.low_24h, 2) : '—'}</b></div>
        <div><span>24H 成交额</span><b>${quote ? fmtCompact(quote.volume_24h) : '—'}</b></div>
        <div>
          <span>${cardDelta === null ? '研究时价' : '较研究时'}</span>
          <b class="${cardDelta === null ? '' : cardDelta >= 0 ? 'up' : 'down'}">
            ${cardDelta === null
              ? (card && card.symbol === selected.symbol ? fmtNum(card.price, 2) : '—')
              : `${cardDelta >= 0 ? '+' : ''}${cardDelta.toFixed(2)}%`}
          </b>
        </div>
      </div>
    </div>`;
}

function renderResultArea() {
  const box = $('resultArea');
  if (!box) return;
  if (state.running) {
    box.innerHTML = `
      <div class="card empty-state" style="margin-top:18px">
        <div>
          <div class="spinner dark" style="margin:0 auto 16px;width:28px;height:28px"></div>
          <h3>AI 正在研究 ${esc(state.selected?.symbol || '')}</h3>
          <p>读取 K 线 → 计算指标 → 评估多周期 → 生成执行计划与风险预案，通常需要 2–8 秒。</p>
        </div>
      </div>`;
    return;
  }
  if (state.card) {
    box.innerHTML = `<div class="card-enter">${decisionCardHTML(state.card)}</div>`;
    return;
  }
  const selected = state.selected;
  const quote = selected ? state.quotes[selected.symbol] : null;
  const up = (quote?.change_24h ?? 0) >= 0;
  const intervalLabel = {
    '15m': '15 分钟', '1h': '1 小时', '4h': '4 小时', '1d': '日线',
  }[state.timeframe] || state.timeframe;
  box.innerHTML = `
    <div class="card empty-state" style="margin-top:18px">
      <div>
        <div class="big">◈</div>
        <h3>选择标的，开始一次完整的 AI 研究</h3>
        <p>右侧会生成一张决策卡：方向结论、信心拆解、开仓/止损/止盈、反向预案、事件合约到期判断与技术快照。</p>
        ${selected ? `
          <div class="row" style="justify-content:center;margin-top:18px;flex-wrap:wrap">
            <span class="chip chip-lime">${esc(selected.symbol)} · ${esc(selected.name)}</span>
            ${quote ? `<span class="chip ${up ? 'chip-green' : 'chip-red'}">${fmtPct(quote.change_24h)}</span>` : ''}
            <span class="chip">${intervalLabel}</span>
          </div>` : ''}
      </div>
    </div>`;
}

async function runAnalysis() {
  if (!state.selected || state.running) return;
  state.running = true;
  setResearchError('');
  renderResearchMeta();
  renderResultArea();
  try {
    const data = await api('/analysis/run', {
      method: 'POST',
      body: {
        symbol: state.selected.symbol,
        market: 'crypto',
        interval: state.timeframe,
        model: state.model,
      },
    });
    state.card = data.payload;
    window.dispatchEvent(new Event('mx:refresh'));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) {
    setResearchError(e.message);
  } finally {
    state.running = false;
    renderResearchMeta();
    renderResultArea();
    renderLivePanel();
  }
}

// ------------------------------------------------------------------ 决策卡
function decisionCardHTML(card) {
  const up = Number(card.change_24h) >= 0;
  const color = up ? '#087a55' : '#bc3550';
  const plan = card.plan || {};
  const entry = plan.entry?.zone || [];
  const levels = card.key_levels || { support: [], resistance: [] };
  const event = card.event_contract || {};
  const confidence = card.confidence || {};
  const isDirectional = plan.direction === 'long' || plan.direction === 'short';
  const confLabel = { high: '高信心', mid: '中信心', low: '低信心' }[confidence.level] || '—';
  const cycleTone = { 偏多: 'up', 偏空: 'down', 中性: 'muted', 分歧: 'muted' };

  const resistance = (levels.resistance || []).map((l, i) => `
    <div class="level-row">
      <span>阻力 ${i + 1}</span>
      <span class="row"><span class="price">${fmtNum(l.price, 3)}</span><span class="strength ${esc(l.strength)}">${esc(l.strength)}</span></span>
    </div>`).join('') || '<div class="muted" style="font-size:12.5px">上方无明显阻力</div>';

  const support = (levels.support || []).map((l, i) => `
    <div class="level-row">
      <span>支撑 ${i + 1}</span>
      <span class="row"><span class="price">${fmtNum(l.price, 3)}</span><span class="strength ${esc(l.strength)}">${esc(l.strength)}</span></span>
    </div>`).join('') || '<div class="muted" style="font-size:12.5px">下方无明显支撑</div>';

  const dims = (confidence.breakdown || []).map((d) => `
    <div class="dim-row">
      <span>${esc(d.name)}</span>
      <span class="dim-bar"><i style="width:${Number(d.score) || 0}%"></i></span>
      <span class="val">${Number(d.score) || 0}</span>
    </div>`).join('');

  const reasons = (card.reasons || []).map((r) => `
    <li><span class="w">${Math.round((r.weight || 0) * 100)}%</span><span>${esc(r.text)}</span></li>`).join('');

  const cycles = (card.cycles || []).map((c) => `
    <div class="cycle">
      <div class="p">${esc(c.period)}</div>
      <div class="b ${cycleTone[c.bias] || ''}">${esc(c.bias)}</div>
      <div class="c">置信 ${Math.round((c.confidence || 0) * 100)}%</div>
    </div>`).join('');

  const risks = (card.risks || []).map((r) => `
    <div class="risk ${esc(r.level)}">${esc(r.text)}</div>`).join('');

  const reverse = card.reverse_plan ? `
    <div class="panel">
      <div class="section-title">反向预案</div>
      <div style="font-size:13.5px;margin-bottom:10px">${esc(card.reverse_plan.trigger)}</div>
      <div class="plan-grid" style="grid-template-columns:repeat(3,1fr)">
        <div class="plan-cell"><div class="k">反向方向</div><div class="v" style="font-size:14px">${esc(card.reverse_plan.direction_label)}</div></div>
        <div class="plan-cell"><div class="k">反向入场区间</div><div class="v" style="font-size:13px">${card.reverse_plan.entry?.zone ? card.reverse_plan.entry.zone.map((x) => fmtNum(x, 3)).join('–') : '—'}</div></div>
        <div class="plan-cell"><div class="k">反向止损 / 目标</div><div class="v" style="font-size:13px">${fmtNum(card.reverse_plan.stop_loss?.price, 3)} / ${fmtNum(card.reverse_plan.take_profit?.conservative, 3)}</div></div>
      </div>
    </div>` : '';

  return `
    <article class="card decision-card">
      <div class="dc-head">
        <div class="dc-id">
          <div class="dc-symbol">
            <h2>${esc(card.symbol)}</h2>
            <span class="company">${esc(card.name)}</span>
            <span class="chip">${esc(card.market_label)}</span>
            <span class="chip">${esc(card.sector)}</span>
            <span class="chip">${esc(card.interval)}</span>
            <span class="chip ${card.market_state?.open ? 'chip-green' : 'chip-amber'}">${esc(card.market_state?.label)}</span>
          </div>
          <div class="dc-price">
            <span class="num">${fmtNum(card.price, 2)}</span>
            <span class="chg ${up ? 'up' : 'down'}">${fmtPct(card.change_24h)}</span>
            <span class="muted" style="font-size:12px">24H</span>
          </div>
          <div class="muted" style="font-size:11.5px;margin-top:4px">
            行情源 ${esc(card.source_label || card.source)}
            ${card.quote_time ? `（${esc(card.quote_time)}）` : ''}
            · 生成于 ${fmtTime(card.generated_at)}
            · ${card.narrative_by === 'llm' ? `LLM 润色（${esc(card.model)}）` : '规则引擎'}
          </div>
        </div>
        <div class="verdict-box">
          <div class="verdict ${esc(card.verdict)}">${esc(card.verdict_label)}</div>
          <div style="margin-top:8px" class="muted">信心 ${confLabel} · 胜率估计 <b class="mono">${Math.round((confidence.win_rate || 0) * 100)}%</b></div>
          <div class="muted" style="font-size:11.5px">维度一致度 ${Math.round((confidence.agreement || 0) * 100)}%</div>
        </div>
      </div>

      <div class="headline"><span class="tag">核心结论</span>${esc(card.headline)}</div>

      <div class="dc-body">
        <div>${sparkline(card.candles, color)}</div>

        <div class="panel">
          <div class="section-title">执行计划</div>
          <div style="font-size:13.5px;margin-bottom:12px;line-height:1.6">${esc(plan.trigger)}</div>
          <div class="plan-grid">
            <div class="plan-cell">
              <div class="k">${isDirectional ? '开仓区间' : '观察区间'}</div>
              <div class="v">${entry.length === 2 ? `${fmtNum(entry[0], 3)}–${fmtNum(entry[1], 3)}` : '—'}</div>
              <div class="s">${isDirectional ? '只在区间内分批介入' : '突破任一端再评估'}</div>
            </div>
            <div class="plan-cell"><div class="k">止损价</div><div class="v">${fmtNum(plan.stop_loss?.price, 3)}</div><div class="s">${plan.stop_loss?.percentage ? `${plan.stop_loss.percentage}%` : '—'}</div></div>
            <div class="plan-cell"><div class="k">止盈（保守 / 激进）</div><div class="v" style="font-size:13px">${fmtNum(plan.take_profit?.conservative, 3)} / ${fmtNum(plan.take_profit?.aggressive, 3)}</div><div class="s">分批止盈，不一次走完</div></div>
            <div class="plan-cell"><div class="k">盈亏比</div><div class="v">${plan.risk_reward ?? '—'}</div><div class="s">低于 1.5 不建议参与</div></div>
            <div class="plan-cell"><div class="k">建议杠杆</div><div class="v">${plan.leverage ? `${plan.leverage}x` : '—'}</div><div class="s">随波动率下降</div></div>
            <div class="plan-cell"><div class="k">建议仓位</div><div class="v">${plan.position_percentage ? `${plan.position_percentage}%` : '—'}</div><div class="s">占总资金比例</div></div>
            <div class="plan-cell"><div class="k">单笔风险</div><div class="v">${plan.risk_per_trade_pct ? `${plan.risk_per_trade_pct}%` : '—'}</div><div class="s">止损时的账户回撤</div></div>
            <div class="plan-cell"><div class="k">结论失效</div><div class="v" style="font-size:12px;line-height:1.4">${esc(plan.invalidation || '—')}</div></div>
          </div>
          <div class="muted" style="font-size:11.5px;margin-top:10px;line-height:1.6">
            入场条件：${esc(plan.entry?.condition || '—')}<br>
            禁止开仓：${esc(plan.no_trade_condition || '—')}
          </div>
        </div>

        <div class="grid-2">
          <div class="panel">
            <div class="section-title">关键价位</div>
            <div class="level-list">
              ${resistance}
              <div class="level-row" style="background:transparent;border-top:1px dashed var(--border-default)">
                <span class="muted">现价</span><span class="price">${fmtNum(card.price, 3)}</span>
              </div>
              ${support}
            </div>
          </div>
          <div class="panel">
            <div class="section-title">AI 信心评估</div>
            <div class="dims">${dims}</div>
            <div class="muted" style="font-size:11.5px;margin-top:10px">50 为中性。分维度打分只表示该维度的方向倾向，不等于概率。</div>
          </div>
        </div>

        <div class="grid-2">
          <div class="panel">
            <div class="section-title">核心理由</div>
            <ul class="reason-list">${reasons}</ul>
          </div>
          <div class="panel">
            <div class="section-title">周期共振</div>
            <div class="cycle-list">${cycles}</div>
            <div class="muted" style="font-size:11.5px;margin-top:12px;line-height:1.6">短中长周期方向一致时，趋势延续的概率更高；出现分歧说明当前不是好的介入点。</div>
          </div>
        </div>

        ${reverse}

        <div class="event-box">
          <div class="section-title">事件合约 · 到期判断</div>
          <div class="event-grid">
            <div class="event-cell"><div class="k">起始价</div><div class="v">${fmtNum(event.anchor_price, 3)}</div></div>
            <div class="event-cell"><div class="k">到期预期</div><div class="v">${fmtNum(event.expiry_price, 3)}</div></div>
            <div class="event-cell"><div class="k">到期区间</div><div class="v" style="font-size:13px">${fmtNum(event.range?.low, 3)}–${fmtNum(event.range?.high, 3)}</div></div>
            <div class="event-cell"><div class="k">AI 概率（涨 / 跌）</div><div class="v" style="font-size:13px">${Math.round((event.probability?.up || 0) * 100)}% / ${Math.round((event.probability?.down || 0) * 100)}%</div></div>
            <div class="event-cell"><div class="k">执行建议</div><div class="v" style="font-size:14px">${esc(event.recommendation_label)}</div></div>
            <div class="event-cell"><div class="k">最高买价（点数）</div><div class="v">${event.recommendation === 'none' ? '—' : event.max_buy_price}</div></div>
            <div class="event-cell" style="grid-column:span 2"><div class="k">放弃条件</div><div style="font-size:12px;color:rgba(233,237,230,.8);margin-top:2px">${esc(event.abandon_condition)}</div></div>
          </div>
          <div class="event-note">${esc(event.settlement_rule)}</div>
        </div>

        <div class="panel">
          <div class="section-title">风险提示</div>
          <div class="risk-list">${risks}</div>
        </div>

        <div class="panel">
          <div class="section-title">技术快照</div>
          <div class="evidence-grid">
            <div class="evidence-cell"><div class="k">MA5 / MA20</div><div class="v">${fmtNum(card.evidence?.ma5, 2)} / ${fmtNum(card.evidence?.ma20, 2)}</div></div>
            <div class="evidence-cell"><div class="k">RSI(14)</div><div class="v">${card.evidence?.rsi ?? '—'}</div></div>
            <div class="evidence-cell"><div class="k">MACD 柱</div><div class="v">${card.evidence?.macd_hist ?? '—'}</div></div>
            <div class="evidence-cell"><div class="k">ADX(14)</div><div class="v">${card.evidence?.adx ?? '—'}</div></div>
            <div class="evidence-cell"><div class="k">ATR 占比</div><div class="v">${card.evidence?.atr_pct ?? '—'}%</div></div>
            <div class="evidence-cell"><div class="k">量比</div><div class="v">${card.evidence?.volume_ratio ?? '—'}</div></div>
            <div class="evidence-cell"><div class="k">30 日分位</div><div class="v">${card.evidence?.percentile_30d ?? '—'}%</div></div>
            <div class="evidence-cell"><div class="k">均线结构</div><div class="v" style="font-size:12.5px">${esc(card.evidence?.trend || '—')}</div></div>
          </div>
        </div>

        <div class="disclaimer">${esc(card.disclaimer)}</div>
      </div>
    </article>`;
}

// ------------------------------------------------------------------ 历史记录
async function loadHistory() {
  state.historyLoading = true;
  state.historyError = '';
  renderHistoryPage();
  try {
    const d = await api(`/analysis/history?q=${encodeURIComponent(state.historyQ.trim())}&limit=100`);
    state.historyItems = d.items || [];
    state.historyTotal = d.total || 0;
  } catch (e) {
    state.historyError = e.message;
  } finally {
    state.historyLoading = false;
    renderHistoryPage();
  }
}

function renderHistoryPage() {
  const detail = state.historyDetail;
  $('historyListView').hidden = !!detail;
  $('historyDetailView').hidden = !detail;

  if (detail) {
    $('historyDetailId').textContent = `记录 #${detail.id}`;
    $('historyDetail').innerHTML = decisionCardHTML(detail.card);
    return;
  }

  $('historyTotal').textContent = `${state.historyTotal} 条`;
  $('historyClear').disabled = !state.historyItems.length;
  $('historySearch').value = state.historyQ;

  const error = $('historyError');
  error.hidden = !state.historyError;
  error.textContent = state.historyError || '';

  const body = $('historyBody');
  if (state.historyLoading) {
    body.innerHTML = '<div class="empty-row"><span class="spinner dark" style="display:inline-block"></span></div>';
    return;
  }
  if (!state.historyItems.length) {
    body.innerHTML = '<div class="empty-row">还没有研究记录，回研究台生成第一张决策卡吧。</div>';
    return;
  }

  const verdict = {
    long: { label: '看多', cls: 'chip-green' },
    short: { label: '看空', cls: 'chip-red' },
    wait: { label: '等待', cls: 'chip-amber' },
    avoid: { label: '回避', cls: '' },
  };

  body.innerHTML = `
    <div style="overflow-x:auto">
      <table class="table">
        <thead><tr><th>标的</th><th>周期</th><th>结论</th><th>当时价格</th><th>模型</th><th>生成时间</th><th></th></tr></thead>
        <tbody>
          ${state.historyItems.map((it) => {
            const v = verdict[it.verdict] || { label: it.verdict, cls: '' };
            return `<tr>
              <td><b>${esc(it.symbol)}</b> <span class="muted" style="font-size:11.5px">标的</span></td>
              <td class="mono">${esc(it.interval)}</td>
              <td><span class="chip ${v.cls}">${esc(v.label)}</span></td>
              <td class="mono">${fmtNum(it.price, 2)}</td>
              <td class="muted" style="font-size:12px">${esc(it.model)}</td>
              <td class="muted" style="font-size:12px">${fmtTime(it.created_at)}</td>
              <td><div class="actions">
                <button class="btn btn-sm" data-action="open" data-id="${it.id}">查看</button>
                <button class="btn btn-sm btn-danger" data-action="delete" data-id="${it.id}">删除</button>
              </div></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

async function openHistory(id) {
  try {
    const d = await api(`/analysis/${id}`);
    state.historyDetail = { id: d.id, card: d.payload };
    renderHistoryPage();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) {
    state.historyError = e.message;
    renderHistoryPage();
  }
}

async function deleteHistory(id) {
  if (!window.confirm('确定删除这条研究记录？')) return;
  try {
    await api(`/analysis/${id}`, { method: 'DELETE' });
    state.historyItems = state.historyItems.filter((x) => x.id !== id);
    state.historyTotal = Math.max(0, state.historyTotal - 1);
    renderHistoryPage();
  } catch (e) {
    state.historyError = e.message;
    renderHistoryPage();
  }
}

async function clearHistory() {
  if (!window.confirm('确定清空全部研究历史？此操作不可恢复。')) return;
  try {
    await api('/analysis', { method: 'DELETE' });
    state.historyItems = [];
    state.historyTotal = 0;
    renderHistoryPage();
  } catch (e) {
    state.historyError = e.message;
    renderHistoryPage();
  }
}

// ------------------------------------------------------------------ 我的
async function loadMe() {
  renderMeNotice();
  try {
    state.summary = await api('/user/summary');
    $('topBalance').textContent = state.summary.quota?.available ?? '—';
    renderMe();
  } catch (e) {
    showMeError(e.message);
  }
  loadTab(state.tab);
  if (state.user?.is_owner) loadOwnerState();
  if (state.payment) startPaymentPolling();
}

function showMeError(message) {
  const el = $('meError');
  el.textContent = message || '';
  el.hidden = !message;
}

function renderMeNotice() {
  const el = $('meNotice');
  el.textContent = state.meNotice || '';
  el.hidden = !state.meNotice;
}

function pricing() {
  return state.summary?.pricing || {
    tokens_per_usdt: 100,
    min_usdt: 1,
    max_usdt: 10000,
    usd_cny_rate: 7.2,
  };
}

function renderMe() {
  const summary = state.summary;
  if (!summary) return;
  const quota = summary.quota || {};
  const p = pricing();

  $('statAvailable').textContent = quota.available ?? '—';
  $('statAvailableSub').textContent = `免费 ${quota.free_remaining ?? 0} + 付费 ${quota.paid_balance ?? 0}`;
  $('statFree').innerHTML = `${quota.free_remaining ?? 0}<span style="font-size:15px;color:var(--text-muted)"> / ${quota.free_per_day ?? 0}</span>`;
  $('statRuns').textContent = summary.total_runs ?? 0;
  $('statRunsSub').textContent = `单次消耗 ${quota.cost_per_run ?? 10} Token`;
  $('statUsed').textContent = Math.max(0, (quota.free_per_day ?? 0) - (quota.free_remaining ?? 0));
  $('statUsedSub').textContent = `共 ${quota.free_per_day ?? 0}，每天零点重置`;
  $('noteCost').textContent = quota.cost_per_run ?? 10;

  $('accountEmail').textContent = state.user?.email || '—';
  $('accountNickname').textContent = state.user?.nickname || '—';
  $('accountCreated').textContent = fmtTime(state.user?.created_at);

  $('rangeHint').textContent = `单笔 ${p.min_usdt}–${p.max_usdt} USDT，1 USDT = ${p.tokens_per_usdt} Token`;
  renderAmountEstimate();
  renderRechargeTip();
  renderOwnerSwitch();
}

function renderAmountEstimate() {
  const p = pricing();
  const value = Number(state.amount);
  const valid = Number.isFinite(value) && value >= p.min_usdt && value <= p.max_usdt;
  $('estTokens').textContent = valid
    ? `${Math.max(1, Math.round(value * p.tokens_per_usdt)).toLocaleString()} Token`
    : '—';
  $('estCny').textContent = valid ? `¥${(value * p.usd_cny_rate).toFixed(2)}` : '—';
  $('rechargeBtn').disabled = state.meBusy || !valid;
  document.querySelectorAll('#amountPresets .btn').forEach((b) => {
    b.classList.toggle('btn-lime', Number(b.dataset.val) === value);
  });
}

function renderRechargeTip() {
  const provider = state.summary?.payment?.provider || 'demo';
  $('rechargeBtn').textContent = state.meBusy
    ? '处理中…'
    : provider === 'binance_pay' ? '创建 Binance Pay 订单' : '模拟支付并到账';
  $('rechargeTip').innerHTML = provider === 'binance_pay'
    ? '支付由持牌渠道 <strong>Binance Pay</strong> 收单：创建订单后打开收银台，支付成功后 Token 自动到账。本站不会向个人钱包地址收款。'
    : '当前为<strong>模拟支付</strong>：点击即视为支付成功。真实上线需接入持牌支付渠道，并以服务端异步回调验签为准。';
}

async function recharge() {
  const p = pricing();
  const value = Number(state.amount);
  if (!Number.isFinite(value) || value < p.min_usdt || value > p.max_usdt) {
    showMeError(`请输入 ${p.min_usdt}–${p.max_usdt} 之间的 USDT 金额`);
    return;
  }
  state.meBusy = true;
  showMeError('');
  state.meNotice = '';
  renderMeNotice();
  renderAmountEstimate();
  renderRechargeTip();
  try {
    const created = await api('/user/recharge', {
      method: 'POST',
      body: { amount_usdt: Number(value.toFixed(2)) },
    });

    if (created.payment) {
      state.payment = { ...created.payment, order: created.order };
      state.meNotice = `订单 #${created.order.id} 已创建，请在 Binance Pay 完成支付`;
      renderMeNotice();
      renderPaymentCard();
      await loadTab('orders');
      startPaymentPolling();
      return;
    }

    await api(`/user/recharge/${created.order.id}/pay`, { method: 'POST' });
    state.meNotice = `已充值 ${created.order.tokens} Token（模拟支付成功）`;
    renderMeNotice();
    await refreshAfterCredit();
  } catch (e) {
    showMeError(e.message);
  } finally {
    state.meBusy = false;
    renderAmountEstimate();
    renderRechargeTip();
  }
}

async function refreshAfterCredit() {
  await Promise.all([loadMe(), loadTab(state.tab)]);
  window.dispatchEvent(new Event('mx:refresh'));
}

function renderPaymentCard() {
  const box = $('paymentCard');
  if (!box) return;
  if (!state.payment) {
    box.innerHTML = '';
    return;
  }
  const p = state.payment;
  box.innerHTML = `
    <div class="card" style="padding:20px;margin-bottom:18px">
      <div class="section-title">Binance Pay · 等待支付</div>
      <div class="spread" style="margin-bottom:12px">
        <span class="muted">订单 #${p.order.id} · ${p.order.tokens} Token</span>
        <b class="mono">${esc(p.amount)} ${esc(p.currency)}</b>
      </div>
      ${p.qrcode_link ? `<img src="${esc(p.qrcode_link)}" alt="Binance Pay 二维码" style="width:180px;height:180px;display:block;margin:0 auto 12px">` : ''}
      <div class="row" style="flex-wrap:wrap;margin-bottom:10px">
        ${p.checkout_url ? `<a class="btn btn-primary" href="${esc(p.checkout_url)}" target="_blank" rel="noreferrer">打开支付页</a>` : ''}
        <button class="btn" id="paymentSync">${state.paymentChecking ? '查询中…' : '我已完成支付'}</button>
        <button class="btn btn-ghost" id="paymentLater">稍后支付</button>
      </div>
      <div class="tips">支付由 Binance Pay 处理，本站不接触你的钱包私钥或助记词。到账后页面会自动刷新。</div>
    </div>`;

  $('paymentSync').addEventListener('click', syncPayment);
  $('paymentLater').addEventListener('click', () => {
    state.payment = null;
    stopPaymentPolling();
    renderPaymentCard();
  });
}

function startPaymentPolling() {
  if (state.paymentTimer) return;
  state.paymentTimer = window.setInterval(async () => {
    if (!state.payment) return;
    try {
      const d = await api('/user/recharge/orders');
      const row = (d.items || []).find((r) => r.id === state.payment.order.id);
      if (row?.status === 'paid') {
        const id = row.id;
        state.payment = null;
        state.meNotice = `订单 #${id} 支付成功，Token 已到账`;
        renderMeNotice();
        stopPaymentPolling();
        renderPaymentCard();
        await refreshAfterCredit();
      }
    } catch {
      /* 轮询失败不打扰用户 */
    }
  }, 4000);
}

function stopPaymentPolling() {
  if (state.paymentTimer) {
    window.clearInterval(state.paymentTimer);
    state.paymentTimer = null;
  }
}

async function syncPayment() {
  if (!state.payment) return;
  state.paymentChecking = true;
  renderPaymentCard();
  try {
    const d = await api(`/user/recharge/${state.payment.order.id}/sync`, { method: 'POST' });
    if (d.status === 'paid') {
      const id = state.payment.order.id;
      state.payment = null;
      state.meNotice = `订单 #${id} 支付成功，Token 已到账`;
      renderMeNotice();
      stopPaymentPolling();
      renderPaymentCard();
      await refreshAfterCredit();
    } else {
      state.meNotice = `尚未收到支付确认（渠道状态：${d.provider_status || '处理中'}）`;
      renderMeNotice();
    }
  } catch (e) {
    showMeError(e.message);
  } finally {
    state.paymentChecking = false;
    renderPaymentCard();
  }
}

async function loadTab(tab) {
  state.tab = tab;
  $('ledgerTab').classList.toggle('active', tab === 'ledger');
  $('ordersTab').classList.toggle('active', tab === 'orders');
  $('paidCount').hidden = tab !== 'orders';
  state.rowsLoading = true;
  renderMeList();
  try {
    const d = tab === 'ledger'
      ? await api('/user/ledger?limit=100')
      : await api('/user/recharge/orders');
    state.rows = d.items || [];
  } catch (e) {
    showMeError(e.message);
    state.rows = [];
  } finally {
    state.rowsLoading = false;
    renderMeList();
  }
}

function renderMeList() {
  const body = $('meListBody');
  if (!body) return;
  if (state.rowsLoading) {
    body.innerHTML = '<div class="empty-row"><span class="spinner dark" style="display:inline-block"></span></div>';
    return;
  }
  if (!state.rows.length) {
    body.innerHTML = state.tab === 'ledger'
      ? '<div class="empty-row">还没有 Token 流水。</div>'
      : '<div class="empty-row">还没有充值订单。</div>';
    return;
  }

  if (state.tab === 'ledger') {
    body.innerHTML = `
      <table class="table">
        <thead><tr><th>时间</th><th>变动</th><th>余额</th><th>说明</th></tr></thead>
        <tbody>${state.rows.map((r) => `
          <tr>
            <td class="muted" style="font-size:12px">${fmtTime(r.created_at)}</td>
            <td class="money ${r.delta >= 0 ? 'up' : 'down'}">${r.delta >= 0 ? '+' : ''}${r.delta}</td>
            <td class="mono">${r.balance_after}</td>
            <td>${esc(r.reason)} <span class="muted" style="font-size:11.5px">${esc(r.detail)}</span></td>
          </tr>`).join('')}
        </tbody>
      </table>`;
    return;
  }

  const status = {
    pending: { label: '待支付', cls: 'chip-amber' },
    paid: { label: '已支付', cls: 'chip-green' },
    failed: { label: '失败', cls: 'chip-red' },
  };
  const paid = state.rows.filter((r) => r.status === 'paid').length;
  $('paidCount').textContent = `已支付 ${paid} 笔`;

  body.innerHTML = `
    <table class="table">
      <thead><tr><th>订单号</th><th>金额 (USDT)</th><th>折合 CNY</th><th>Token</th><th>状态</th><th>创建时间</th><th>支付时间</th></tr></thead>
      <tbody>${state.rows.map((r) => {
        const s = status[r.status] || { label: r.status, cls: '' };
        return `<tr>
          <td class="mono">#${r.id}</td>
          <td class="money">${r.amount_usdt?.toFixed(2) ?? '—'}</td>
          <td class="money">¥${Number(r.amount_cny || 0).toFixed(2)}</td>
          <td class="mono">${r.tokens}</td>
          <td><span class="chip ${s.cls}">${esc(s.label)}</span></td>
          <td class="muted" style="font-size:12px">${fmtTime(r.created_at)}</td>
          <td class="muted" style="font-size:12px">${r.paid_at ? fmtTime(r.paid_at) : '—'}</td>
        </tr>`;
      }).join('')}
      </tbody>
    </table>`;
}

// ------------------------------------------------------------------ 所有者开关
async function loadOwnerState() {
  if (!state.user?.is_owner) return;
  try {
    state.ownerState = await api('/owner/site');
    state.ownerError = '';
  } catch (e) {
    state.ownerError = e.message;
  }
  renderOwnerSwitch();
}

function renderOwnerSwitch() {
  const box = $('ownerSwitch');
  if (!box) return;
  if (!state.user?.is_owner) {
    box.innerHTML = '';
    return;
  }
  if (!state.ownerState && !state.ownerError) {
    box.innerHTML = `<div class="card" style="padding:20px;margin-bottom:18px">
      <div class="section-title">站点开关</div>
      <span class="spinner dark" style="display:inline-block"></span>
    </div>`;
    return;
  }
  const s = state.ownerState || {};
  box.innerHTML = `
    <div class="card" style="padding:20px;margin-bottom:18px">
      <div class="section-title">站点开关 · 仅所有者可见</div>
      <div class="spread" style="margin-bottom:12px">
        <span class="row" style="gap:8px">
          <span class="live-dot ${s.enabled ? '' : 'warn'}"></span>
          <b>${s.enabled ? '站点运行中' : '站点已关闭'}</b>
        </span>
        <button class="btn ${s.enabled ? 'btn-ghost' : 'btn-primary'}" id="ownerToggle"
          ${state.ownerBusy ? 'disabled' : ''}
          ${s.enabled ? 'style="border:1px solid var(--border-strong)"' : ''}>
          ${state.ownerBusy ? '处理中…' : s.enabled ? '关闭站点' : '开启站点'}
        </button>
      </div>
      <div class="muted" style="font-size:12.5px;line-height:1.6">
        ${s.enabled ? '关闭后，除登录和健康检查外的所有接口都会返回 503，访客看到维护页。' : '访客当前看到维护页；开启后立即恢复，无需重启后端。'}
        ${s.updated_at ? `<div style="margin-top:6px">最近操作：${fmtTime(s.updated_at)}${s.updated_by ? ` · ${esc(s.updated_by)}` : ''}</div>` : ''}
      </div>
      ${state.ownerError ? `<div class="error" style="margin-top:10px">${esc(state.ownerError)}</div>` : ''}
    </div>`;
  $('ownerToggle')?.addEventListener('click', toggleOwnerSite);
}

async function toggleOwnerSite() {
  const s = state.ownerState;
  if (!s) return;
  if (s.enabled && !window.confirm('关闭后所有访客都会看到维护页，确定关闭吗？')) return;
  state.ownerBusy = true;
  state.ownerError = '';
  renderOwnerSwitch();
  try {
    state.ownerState = await api('/owner/site', { method: 'POST', body: { enabled: !s.enabled } });
    window.dispatchEvent(new Event(state.ownerState.enabled ? 'mx:site-on' : 'mx:site-off'));
  } catch (e) {
    state.ownerError = e.message;
  } finally {
    state.ownerBusy = false;
    renderOwnerSwitch();
  }
}

// ------------------------------------------------------------------ 修改密码
async function sendResetCode() {
  showMeError('');
  if (!state.user?.email) return;
  try {
    const d = await api('/auth/send-code', {
      method: 'POST',
      body: { email: state.user.email, purpose: 'reset' },
      auth: false,
    });
    state.pwCountdown = 60;
    renderPwCountdown();
    if (d.dev_code) {
      $('pwCode').value = d.dev_code;
      state.meNotice = `开发模式：验证码 ${d.dev_code} 已自动填入`;
      renderMeNotice();
    } else {
      state.meNotice = '验证码已发送，请查收邮箱';
      renderMeNotice();
    }
  } catch (e) {
    showMeError(e.message);
  }
}

function renderPwCountdown() {
  const btn = $('pwSend');
  btn.disabled = state.pwCountdown > 0;
  btn.textContent = state.pwCountdown > 0 ? `${state.pwCountdown}s` : '发送验证码';
  if (state.pwTimer) {
    window.clearInterval(state.pwTimer);
    state.pwTimer = null;
  }
  if (state.pwCountdown > 0) {
    state.pwTimer = window.setInterval(() => {
      state.pwCountdown -= 1;
      if (state.pwCountdown <= 0) {
        state.pwCountdown = 0;
        renderPwCountdown();
        return;
      }
      renderPwCountdown();
    }, 1000);
  }
}

async function submitPassword(event) {
  event.preventDefault();
  const code = $('pwCode').value.trim();
  const password = $('pwNew').value;
  showMeError('');
  try {
    await api('/auth/reset-password', {
      method: 'POST',
      body: { email: state.user.email, code, password },
      auth: false,
    });
    $('pwCode').value = '';
    $('pwNew').value = '';
    state.meNotice = '密码已更新，下次登录请使用新密码';
    renderMeNotice();
  } catch (e) {
    showMeError(e.message);
  }
}

// ------------------------------------------------------------------ 登录 / 注册表单
function bindAuthForms() {
  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const error = $('loginError');
    const btn = $('loginSubmit');
    error.hidden = true;
    btn.disabled = true;
    btn.textContent = '登录中…';
    try {
      await login($('loginEmail').value.trim(), $('loginPassword').value);
      const target = state.redirect || '/';
      state.redirect = '/';
      go(target);
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = '登录';
    }
  });

  $('regSendCode').addEventListener('click', async () => {
    const error = $('registerError');
    const email = $('regEmail').value.trim();
    error.hidden = true;
    if (!email) {
      error.textContent = '请先填写邮箱';
      error.hidden = false;
      return;
    }
    try {
      const d = await api('/auth/send-code', {
        method: 'POST',
        body: { email, purpose: 'register' },
        auth: false,
      });
      state.regCountdown = 60;
      renderRegCountdown();
      if (d.dev_code) {
        $('regCode').value = d.dev_code;
        const box = $('regDevCode');
        box.textContent = `开发模式：未配置 SMTP，验证码已自动填入（${d.dev_code}）。生产环境请配置邮件服务。`;
        box.hidden = false;
      }
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    }
  });

  $('registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const error = $('registerError');
    const btn = $('registerSubmit');
    error.hidden = true;
    btn.disabled = true;
    btn.textContent = '注册中…';
    try {
      await register({
        email: $('regEmail').value.trim(),
        password: $('regPassword').value,
        code: $('regCode').value.trim(),
      });
      go('/');
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = '注册';
    }
  });
}

let regTimer = null;
function renderRegCountdown() {
  const btn = $('regSendCode');
  btn.disabled = (state.regCountdown || 0) > 0;
  btn.textContent = (state.regCountdown || 0) > 0 ? `${state.regCountdown}s` : '获取验证码';
  if (regTimer) {
    window.clearInterval(regTimer);
    regTimer = null;
  }
  if ((state.regCountdown || 0) > 0) {
    regTimer = window.setInterval(() => {
      state.regCountdown -= 1;
      renderRegCountdown();
    }, 1000);
  }
}

// ------------------------------------------------------------------ 事件绑定
function bindEvents() {
  $('logoutBtn').addEventListener('click', logout);
  $('runBtn').addEventListener('click', runAnalysis);
  $('searchInput').addEventListener('input', (e) => {
    state.search = e.target.value;
    state.visibleCount = VISIBLE_STEP;
    renderSymbolList();
    if (state.researchTimer) tickMarket();
  });
  $('sectorSelect').addEventListener('change', (e) => {
    state.sector = e.target.value;
    state.visibleCount = VISIBLE_STEP;
    renderSymbolList();
    if (state.researchTimer) tickMarket();
  });
  $('timeframeSelect').addEventListener('change', (e) => {
    state.timeframe = e.target.value;
    state.chart = null;
    renderLivePanel();
    renderResultArea();
    startChartTimer();
  });
  $('modelSelect').addEventListener('change', (e) => { state.model = e.target.value; });

  $('symbolList').addEventListener('click', (e) => {
    const more = e.target.closest('[data-action="more"]');
    if (more) {
      state.visibleCount += VISIBLE_STEP;
      renderSymbolList();
      tickMarket();
      return;
    }
    const item = e.target.closest('.symbol-item');
    if (item) selectSymbol(item.dataset.symbol);
  });

  $('historySearch').addEventListener('input', (e) => {
    state.historyQ = e.target.value;
    window.clearTimeout(state.searchTimer);
    state.searchTimer = window.setTimeout(loadHistory, 250);
  });
  $('historyRefresh').addEventListener('click', loadHistory);
  $('historyClear').addEventListener('click', clearHistory);
  $('historyBack').addEventListener('click', () => {
    state.historyDetail = null;
    renderHistoryPage();
  });
  $('historyBody').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const id = Number(btn.dataset.id);
    if (btn.dataset.action === 'open') openHistory(id);
    if (btn.dataset.action === 'delete') deleteHistory(id);
  });

  $('amountInput').addEventListener('input', (e) => {
    state.amount = e.target.value;
    renderAmountEstimate();
  });
  $('amountPresets').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-val]');
    if (!btn) return;
    state.amount = btn.dataset.val;
    $('amountInput').value = state.amount;
    renderAmountEstimate();
  });
  $('rechargeBtn').addEventListener('click', recharge);
  $('ledgerTab').addEventListener('click', () => loadTab('ledger'));
  $('ordersTab').addEventListener('click', () => loadTab('orders'));
  $('pwSend').addEventListener('click', sendResetCode);
  $('passwordForm').addEventListener('submit', submitPassword);

  window.addEventListener('hashchange', renderRoute);
  window.addEventListener('mx:refresh', () => {
    loadTopBalance();
    if (currentPath() === '/me') loadMe();
  });
  window.addEventListener('mx:site-off', loadSiteStatus);
  window.addEventListener('mx:site-on', loadSiteStatus);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      if (state.researchTimer) tickMarket();
      if (currentPath() === '/' && state.btcTimer) loadBtc();
    }
  });
}

// ------------------------------------------------------------------ 启动
async function boot() {
  bindEvents();
  bindAuthForms();
  await Promise.all([refreshUser(), loadSiteStatus()]);
  hide($('boot'));
  if (!location.hash) location.hash = '#/';
  renderRoute();
  state.gateTimer = window.setInterval(loadSiteStatus, 10000);
}

boot();
