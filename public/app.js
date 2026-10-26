'use strict';
/* ============================================================
   Keystone - 前端逻辑（原生 JS，无框架无构建）
   ============================================================ */

// ---------------- 工具 ----------------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

const CATS = [];
const DEFAULT_COLOR = '#8b8fa3';
// 分类颜色：由分类名称哈希取色，稳定且无需存储
const CAT_PALETTE = ['#3b82f6', '#f59e0b', '#10b981', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316', '#84cc16', '#6366f1', '#14b8a6'];
function catColor(name) {
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return CAT_PALETTE[h % CAT_PALETTE.length];
}

const ICONS = {
  star: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26"/></svg>',
  x: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M20 6 9 17l-5-5"/></svg>',
  download: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  paperclip: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>',
  eye: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
  copy: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  edit: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.83 2.83 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>',
  link: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
  sun: '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>',
  moon: '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
  dice: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="15.5" cy="8.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none"/><circle cx="8.5" cy="15.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="15.5" cy="15.5" r="1.1" fill="currentColor" stroke="none"/></svg>',
  pin: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z"/></svg>',
  auto: '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',
  external: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
  grip: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>',
};

/** 字段名是否为敏感信息（密码类）：卡片上值默认掩码显示 */
function isSecretField(name) {
  return /(密码|口令|password|passwd|pin|secret)/i.test(String(name));
}

// 字段类型定义（值用英文码存储，界面显示中文）
const FIELD_TYPES = [
  { code: 'text', label: '文本' },
  { code: 'password', label: '密码' },
  { code: 'url', label: '网址' },
  { code: 'number', label: '数字' },
  { code: 'boolean', label: '布尔' },
  { code: 'date', label: '日期' },
  { code: 'email', label: '邮箱' },
  { code: 'divider', label: '分割线' },
];

/** 按字段类型生成值输入控件（密码带眼睛/生成器，布尔为开关，日期/邮箱专用键盘） */
function valueControlHTML(type, value) {
  if (type === 'boolean') {
    return `<label class="f-bool"><input type="checkbox" class="f-value"${value === '是' ? ' checked' : ''}> <span>是 / 否</span></label>`;
  }
  const v = esc(value);
  if (type === 'date') {
    return `<input type="date" class="f-value" value="${v}" maxlength="20">`;
  }
  const masked = type === 'password';
  const extra = type === 'number' ? ' inputmode="numeric"' : type === 'email' ? ' inputmode="email" placeholder="user@example.com"' : ' placeholder="值"';
  return `
    <input type="${masked ? 'password' : 'text'}" class="f-value" maxlength="2000" value="${v}" autocomplete="off"${extra}>
    ${masked ? `<button type="button" class="icon-btn sm f-eye" title="显示 / 隐藏">${ICONS.eye}</button>` : ''}
    ${masked ? `<button type="button" class="icon-btn sm f-gen" title="生成随机密码">${ICONS.dice}</button>` : ''}`;
}

function sanitizeIconSvg(markup) {
  if (markup.length > 50000) throw new Error('SVG 代码不能超过 50KB');
  if (/<!DOCTYPE|<!ENTITY/i.test(markup)) throw new Error('SVG 不支持文档类型或实体声明');
  const doc = new DOMParser().parseFromString(markup.trim(), 'image/svg+xml');
  const root = doc.documentElement;
  if (root.localName !== 'svg' || root.namespaceURI !== 'http://www.w3.org/2000/svg' || doc.querySelector('parsererror')) {
    throw new Error('请粘贴完整、有效的 SVG 代码');
  }
  const viewBox = root.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
  if (!viewBox || viewBox.length !== 4 || viewBox.some((n) => !Number.isFinite(n)) || viewBox[2] <= 0 || viewBox[3] <= 0) {
    throw new Error('SVG 缺少有效的 viewBox');
  }
  const allowed = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);
  const numeric = new Set(['x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'stroke-width', 'stroke-miterlimit', 'opacity', 'fill-opacity', 'stroke-opacity']);
  const words = new Set(['stroke-linecap', 'stroke-linejoin', 'fill-rule', 'clip-rule']);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svg.setAttribute('viewBox', viewBox.join(' '));
  svg.setAttribute('width', '96');
  svg.setAttribute('height', '96');
  let shapes = 0;
  function copyChildren(source, target) {
    for (const child of source.childNodes) {
      if (child.nodeType === 3 && !child.textContent.trim()) continue;
      if (child.nodeType !== 1 || child.namespaceURI !== 'http://www.w3.org/2000/svg' || !allowed.has(child.localName)) {
        throw new Error('SVG 含有不支持的元素，请复制单个图标的 SVG 代码');
      }
      if (++shapes > 100) throw new Error('SVG 图形过于复杂');
      const clean = document.createElementNS('http://www.w3.org/2000/svg', child.localName);
      for (const attr of child.attributes) {
        const name = attr.name;
        const value = attr.value.trim();
        if (name === 'd' && /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,+\-\s]+$/.test(value)) clean.setAttribute(name, value);
        else if (name === 'points' && /^[0-9eE.,+\-\s]+$/.test(value)) clean.setAttribute(name, value);
        else if ((name === 'fill' || name === 'stroke') && /^(?:none|currentColor|#[0-9a-fA-F]{3,8}|rgba?\([0-9.,%\s]+\))$/.test(value)) clean.setAttribute(name, value);
        else if (numeric.has(name) && /^[+\-]?(?:\d+\.?\d*|\.\d+)(?:e[+\-]?\d+)?%?$/i.test(value)) clean.setAttribute(name, value);
        else if (words.has(name) && /^(?:round|square|butt|miter|bevel|evenodd|nonzero)$/.test(value)) clean.setAttribute(name, value);
      }
      target.append(clean);
      copyChildren(child, clean);
    }
  }
  copyChildren(root, svg);
  if (!shapes) throw new Error('SVG 中没有可用的图形');
  return new XMLSerializer().serializeToString(svg);
}

async function rasterizeIconSvg(markup) {
  const safeSvg = sanitizeIconSvg(markup);
  const url = URL.createObjectURL(new Blob([safeSvg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('SVG 图标无法绘制'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 96;
    canvas.getContext('2d').drawImage(img, 0, 0, 96, 96);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------------- 全局状态 ----------------
const state = {
  setup: false,
  unlocked: false,
  autoLockMinutes: 30,
  totpEnabled: false,
  httpsRequired: false,
  secureConnection: false,
  categories: [],
  entries: [],
  category: '全部',
  search: '',
  sort: ['updated', 'name', 'created'].includes(localStorage.getItem('vault-sort'))
    ? localStorage.getItem('vault-sort') : 'updated',
  editingId: null,
  viewingId: null,
  importedEntryCount: null, // 刚导入的备份条目数（用于解锁后校验是否解密成功）
  selectMode: false, // 批量多选模式
  selected: new Set(), // 已选条目 id
  expandedCards: new Set(), // 卡片已展开全部字段的条目 id
  pendingIcon: '', // 弹窗中当前选中的图标（emoji 或 dataURL）
  iconRequestId: 0,
  svgIconValid: true,
  savingEntry: false,
  pendingAtts: [], // 新增条目时已上传、待保存后绑定到条目的附件
  idleTimer: null,
  lastIdleReset: 0,
};
const ACTIVITY_KEY = 'keystone-last-activity';
const LOCK_KEY = 'keystone-lock-event';

// ---------------- API ----------------
async function api(path, opts = {}) {
  let r;
  try {
    r = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
    });
  } catch {
    toast('网络错误，无法连接服务器', 'error');
    throw new Error('network');
  }
  const data = await r.json().catch(() => ({}));
  if (r.status === 401) {
    showLock('会话已过期，请重新解锁');
    throw new Error('unauthorized');
  }
  if (!r.ok) {
    const msg = data.error || `请求失败（${r.status}）`;
    toast(msg, 'error');
    throw new Error(msg);
  }
  return data;
}

// ---------------- 提示条 ----------------
let toastTimer = null;
function toast(msg, type = 'info') {
  const t = $('#toast');
  t.className = type === 'success' || type === 'error' ? type : 'info';
  t.innerHTML = `<span class="dot"></span><span>${esc(msg)}</span>`;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), type === 'info' ? 2600 : 3400);
}

// ---------------- 视图切换 ----------------
function showView(name) {
  for (const v of ['setup', 'lock', 'main']) {
    $('#view-' + v).classList.toggle('hidden', v !== name);
  }
}

// ---------------- 主题（亮色 / 暗色） ----------------
const THEME_ORDER = ['dark', 'light'];
function currentThemeMode() {
  const saved = localStorage.getItem('vault-theme');
  return (saved === 'dark' || saved === 'light') ? saved : 'light'; // 默认亮色；旧的 auto 设置也回退到亮色
}
function applyTheme() {
  const mode = currentThemeMode();
  document.documentElement.dataset.theme = mode;
  $('#theme-btn').innerHTML = mode === 'dark' ? ICONS.sun : ICONS.moon;
  $('#theme-btn').title = mode === 'dark' ? '暗色（点击切换亮色）' : '亮色（点击切换暗色）';
}

// ---------------- 视图：解锁 / 锁定 ----------------
function showLock(msg) {
  state.unlocked = false;
  clearTimeout(state.idleTimer);
  if (!$('#preview-modal').classList.contains('hidden')) closePreview();
  if (!$('#view-modal').classList.contains('hidden')) closeEntryView(false);
  if (!$('#modal').classList.contains('hidden')) closeModal();
  if (!$('#settings-modal').classList.contains('hidden')) closeSettings();
  $('#entry-form').reset();
  $('#fields-list').replaceChildren();
  $('#attach-list').replaceChildren();
  $('#totp-secret').textContent = '';
  $('#totp-qr').removeAttribute('src');
  $('#recovery-list').replaceChildren();
  $('#health-list').replaceChildren();
  $('#health-summary').textContent = '';
  $$('#settings-modal input').forEach((input) => { if (input.type !== 'checkbox') input.value = ''; });
  $('#lock-pw').value = '';
  state.entries = [];
  state.categories = [];
  state.search = '';
  state.expandedCards.clear();
  $('#search').value = '';
  $('#grid').replaceChildren();
  $('#chips').replaceChildren();
  if (state.selectMode) exitSelectMode(); // 锁定前退出多选
  showView('lock');
  $('#lock-totp').value = '';
  $('#lock-totp-wrap').classList.toggle('hidden', !state.totpEnabled); // 两步验证开启时显示验证码输入
  const err = $('#lock-error');
  if (msg) {
    err.textContent = msg;
    err.classList.remove('hidden');
    err.classList.remove('shake'); void err.offsetWidth; err.classList.add('shake');
  }
  setTimeout(() => $('#lock-pw').focus(), 60);
}

// ---------------- 视图：主界面 ----------------
async function enterMain() {
  state.unlocked = true;
  showView('main');
  resetIdle();
  await loadEntries();
  await loadCategories();
}

async function loadEntries() {
  const d = await api('/api/entries');
  state.entries = d.entries;
  // 刚导入过备份：校验条目数，排查"恢复空白"
  if (state.importedEntryCount !== null) {
    if (d.entries.length !== state.importedEntryCount) {
      toast(`数据异常：备份含 ${state.importedEntryCount} 条条目，但只读取到 ${d.entries.length} 条（请确认主密码正确，或数据已损坏）`, 'error');
    } else if (d.entries.length === 0) {
      toast('备份中没有条目（0 条），请确认选择的是正确的备份文件', 'error');
    }
    state.importedEntryCount = null;
  }
  renderGrid();
}

async function loadCategories() {
  const d = await api('/api/categories');
  state.categories = d.categories;
  renderChips();
  if (state.category !== '全部' && state.category !== '收藏' && !state.categories.includes(state.category)) {
    state.category = '全部'; // 分类被删除后回到全部
  }
}

// ---------------- 渲染 ----------------
function render() {
  renderChips();
  renderGrid();
}

function renderChips() {
  const chips = ['全部', ...state.categories, '收藏']; // 收藏筛选放在分类后面
  $('#chips').innerHTML = chips
    .map((c) => {
      const count = c === '全部' ? state.entries.length
        : c === '收藏' ? state.entries.filter((e) => e.favorite).length
          : state.entries.filter((e) => e.category === c).length;
      return `<button class="chip${state.category === c ? ' active' : ''}" data-cat="${esc(c)}">${esc(c)}<span class="chip-count">${count}</span></button>`;
    })
    .join('');
}

const nameCollator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

function compareNames(a, b) {
  const left = String(a).trim();
  const right = String(b).trim();
  const group = (name) => /^[a-z0-9]/i.test(name) ? 0 : 1;
  return group(left) - group(right) || nameCollator.compare(left, right);
}

function entryTime(entry, field) {
  const value = entry[field];
  const time = typeof value === 'number' ? value
    : typeof value === 'string' && /^\d+$/.test(value) ? Number(value)
      : typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(time) && time > 0 ? time : 0;
}

function formatTimeValue(time, short = false) {
  if (!time) return '时间未知';
  const date = new Date(time);
  const pad = (n) => String(n).padStart(2, '0');
  const day = `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `${short ? '' : `${date.getFullYear()}-`}${day} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatEntryTime(entry, short = false) {
  return formatTimeValue(entryTime(entry, state.sort === 'created' ? 'createdAt' : 'updatedAt'), short);
}

function cardHTML(e) {
  const color = catColor(e.category);
  const letter = (e.title || '?').trim().charAt(0);
  // 名称前图标：上传图片直接显示；未上传则显示分类颜色的首字（无背景块）
  let avatarInner;
  if (e.icon && e.icon.startsWith('data:')) {
    avatarInner = `<img class="avatar-img" src="${esc(e.icon)}" alt="">`;
  } else {
    avatarInner = `<span class="avatar-letter" style="color:${color}">${esc(letter)}</span>`;
  }
  const q = state.search.trim();
  const fields = e.fields || [];
  // 批量多选模式：显示勾选框，隐藏编辑/删除操作
  if (state.selectMode) {
    const on = state.selected.has(e.id);
    return `
    <article class="card sel-card${on ? ' selected' : ''}" data-id="${esc(e.id)}">
      <div class="card-top">
        <div class="avatar">${avatarInner}</div>
        <div class="card-title">
          <h3>${highlight(e.title, q)}</h3>
          ${e.subtitle ? `<p class="card-sub">${esc(e.subtitle)}</p>` : ''}
        </div>
        <span class="sel-box${on ? ' on' : ''}">${on ? '✓' : ''}</span>
      </div>
      <div class="card-bottom">
        <span class="badge" style="--category-color:${color}">${esc(e.category)}</span>
        <span class="sel-hint">点击选择</span>
      </div>
    </article>`;
  }
  // 卡片显示：置顶(📌)字段 + 组间分割线；4 条上限只数真实字段，分割线不占名额
  const pinned = fields.filter((f) => f.pinned);
  // 旧条目可能还没有“置顶”配置；仍展示前两个字段，保证列表始终像密码本而非通讯录。
  const visibleFields = pinned.length
    ? pinned
    : fields.filter((f) => f.type !== 'divider').slice(0, 2);
  const isExpanded = state.expandedCards.has(e.id);
  const shownPinned = isExpanded ? visibleFields : visibleFields.slice(0, 4);
  const more = Math.max(0, visibleFields.length - 4);
  let rows = '';
  let toggleBtn = '';
  if (pinned.length) {
    // 保留每个可见字段前最近的分组线，包括第一组；末尾的分组线不显示。
    const shownIdx = new Set(shownPinned.map((f) => fields.indexOf(f)));
    const display = [];
    let pendingDivider = null;
    fields.forEach((f, i) => {
      if (f.type === 'divider') {
        pendingDivider = f;
      } else if (shownIdx.has(i)) {
        if (pendingDivider) display.push(pendingDivider);
        display.push(f);
        pendingDivider = null;
      }
    });
    rows = display.map((f) => fieldRowHTML(f, fields.indexOf(f))).join('');
    if (more > 0) {
      toggleBtn = `<button class="f-more-btn" data-act="toggle-fields">${isExpanded ? '▲ 收起' : `＋ ${more} 个字段`}</button>`;
    }
  } else {
    rows = shownPinned.map((f) => fieldRowHTML(f, fields.indexOf(f))).join('');
  }
  return `
  <article class="card" data-id="${esc(e.id)}">
    <div class="card-top">
      <div class="avatar">${avatarInner}</div>
      <div class="card-title">
        <h3>${highlight(e.title, q)}</h3>
        ${e.subtitle ? `<p class="card-sub">${highlight(e.subtitle, q)}</p>` : ''}
      </div>
      <button class="icon-btn sm star${e.favorite ? ' active' : ''}" data-act="star" title="收藏">${ICONS.star}</button>
    </div>
    ${rows ? `<div class="card-fields">${rows}${toggleBtn}</div>` : ''}
    <div class="card-bottom">
      <span class="badge" style="--category-color:${color}">${esc(e.category)}</span>
      <span class="card-time" title="${state.sort === 'created' ? '创建时间' : '最近更新'}"><span class="time-full">${formatEntryTime(e)}</span><span class="time-short">${formatEntryTime(e, true)}</span></span>
      <div class="card-actions">
        <button class="icon-btn sm" data-act="view" title="查看详情" aria-label="查看详情">${ICONS.eye}</button>
        <button class="icon-btn sm" data-act="edit" title="编辑">${ICONS.edit}</button>
        <button class="icon-btn sm danger" data-act="delete" title="删除">${ICONS.trash}</button>
      </div>
    </div>
  </article>`;
}

/** 转义后高亮搜索命中词（大小写不敏感） */
function highlight(text, q) {
  const escT = esc(text);
  if (!q) return escT;
  const safeQ = String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  try {
    return escT.replace(new RegExp(`(${safeQ})`, 'gi'), '<mark class="hl">$1</mark>');
  } catch {
    return escT;
  }
}

/** 卡片上的字段行：按类型展示（密码掩码+眼睛、网址可点击、布尔是/否徽标、分割线分组）+ 复制按钮 */
function fieldRowHTML(f, idx) {
  const type = f.type || 'text';
  // 分割线：整行分隔符（可带分组名称），把字段分成几组
  if (type === 'divider') {
    return `<div class="field-divider" data-idx="${idx}">${f.name ? `<span>${esc(f.name)}</span>` : ''}</div>`;
  }
  const secret = type === 'password' || isSecretField(f.name);
  const value = String(f.value ?? '');
  const q = state.search.trim();
  let valueHTML;
  if (type === 'boolean') {
    const on = value === '是';
    valueHTML = `<span class="f-bool-val${on ? ' on' : ''}">${on ? '✓ 是' : '✗ 否'}</span>`;
  } else if (type === 'url' && /^https?:\/\//i.test(value)) {
    valueHTML = `<a class="f-value link" href="${esc(value)}" target="_blank" rel="noopener noreferrer" title="${esc(value)}">${highlight(value, q)}</a>`;
  } else {
    valueHTML = `<code class="f-value${secret ? ' secret' : ''}">${secret ? '••••••••••' : highlight(value, q)}</code>`;
  }
  const copyable = type !== 'boolean' && value && f.copyable !== false; // 可配置：关闭后卡片不显示复制按钮
  const openBtn = type === 'url' && /^https?:\/\//i.test(value)
    ? `<a class="icon-btn sm" href="${esc(value)}" target="_blank" rel="noopener noreferrer" title="打开链接">${ICONS.external}</a>` : '';
  return `
  <div class="card-field" data-idx="${idx}" data-secret="${secret ? '1' : ''}">
    <span class="f-name" title="${esc(f.name)}">${highlight(f.name, q)}</span>
    ${valueHTML}
    ${openBtn}
    ${secret && copyable ? `<button class="icon-btn sm" data-act="f-eye" title="显示 / 隐藏">${ICONS.eye}</button>` : ''}
    ${copyable ? `<button class="icon-btn sm" data-act="f-copy" title="复制${esc(f.name)}">${ICONS.copy}</button>` : ''}
  </div>`;
}

/** 凭据列表使用普通文档流，内容高度不会导致相邻条目错位。 */
function layoutGrid() {
  const grid = $('#grid');
  grid.style.height = '';
  for (const card of grid.children) {
    card.style.position = '';
    card.style.width = '';
    card.style.left = '';
    card.style.top = '';
  }
}

function renderGrid() {
  const q = state.search.trim().toLowerCase();
  let list = state.entries;
  if (state.category === '收藏') list = list.filter((e) => e.favorite);
  else if (state.category !== '全部') list = list.filter((e) => e.category === state.category);
  if (q) {
    list = list.filter((e) => {
      const haystack = [e.title, e.subtitle, e.category, ...(e.fields || []).flatMap((f) => [f.name, f.value])]
        .map((v) => String(v ?? '').toLowerCase());
      return haystack.some((v) => v.includes(q));
    });
  }
  // 排序
  list = [...list].sort((a, b) => {
    const byName = compareNames(a.title, b.title);
    const byId = String(a.id).localeCompare(String(b.id));
    if (state.sort === 'name') return byName || byId;
    const field = state.sort === 'created' ? 'createdAt' : 'updatedAt';
    return entryTime(b, field) - entryTime(a, field) || byName || byId;
  });

  // 无数据时禁用批量操作入口
  const batchBtn = $('#batch-btn');
  if (batchBtn) batchBtn.disabled = state.entries.length === 0;

  const grid = $('#grid');
  grid.innerHTML = list.map(cardHTML).join('');
  $('#entry-count').textContent = `${list.length} 条记录`;
  renderChips();

  const empty = $('#empty');
  if (list.length === 0) {
    empty.classList.remove('hidden');
    if (q || state.category !== '全部') {
      $('#empty-title').textContent = '没有找到匹配的条目';
      $('#empty-text').textContent = '换个关键词或分类试试';
    } else {
      $('#empty-title').textContent = '还没有任何条目';
      $('#empty-text').textContent = '点击右上角「新增」，开始记录你的第一个账号密码';
    }
  } else {
    empty.classList.add('hidden');
  }

  layoutGrid();
}

// 窗口尺寸变化时重新排版（防抖）
let layoutTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(layoutTimer);
  layoutTimer = setTimeout(() => { if (state.unlocked) layoutGrid(); }, 150);
});

// ---------------- 卡片交互 ----------------
$('#grid').addEventListener('click', async (ev) => {
  // 批量多选模式：点击卡片任意位置切换选中
  if (state.selectMode) {
    const card = ev.target.closest('.card');
    if (!card) return;
    const id = card.dataset.id;
    if (state.selected.has(id)) state.selected.delete(id);
    else state.selected.add(id);
    renderGrid();
    updateBatchBar();
    return;
  }
  const btn = ev.target.closest('button[data-act]');
  if (!btn) return;
  const card = btn.closest('.card');
  const entry = card && state.entries.find((e) => e.id === card.dataset.id);
  const act = btn.dataset.act;

  try {
    if (act === 'star') {
      const d = await api(`/api/entries/${entry.id}/favorite`, { method: 'PATCH', body: JSON.stringify({ favorite: !entry.favorite }) });
      const i = state.entries.findIndex((e) => e.id === entry.id);
      state.entries[i] = d.entry;
      render();
    } else if (act === 'toggle-fields') { // 展开/收起卡片字段
      if (state.expandedCards.has(entry.id)) state.expandedCards.delete(entry.id);
      else state.expandedCards.add(entry.id);
      renderGrid();
    } else if (act === 'f-eye') { // 显示/隐藏敏感字段
      const field = btn.closest('.card-field');
      const code = field.querySelector('.f-value');
      const plain = code.classList.toggle('plain');
      const fieldObj = entry.fields[Number(field.dataset.idx)];
      code.textContent = plain ? fieldObj.value : '••••••••••';
      if (plain) setTimeout(() => { code.classList.remove('plain'); code.textContent = '••••••••••'; }, 6000);
    } else if (act === 'f-copy') { // 复制任意字段值
      const field = btn.closest('.card-field');
      const fieldObj = entry.fields[Number(field.dataset.idx)];
      await copyText(fieldObj.value, `「${fieldObj.name}」已复制`);
    } else if (act === 'view') {
      openEntryView(entry);
    } else if (act === 'edit') {
      openModal(entry);
    } else if (act === 'delete') {
      await askDelete(btn, entry);
    }
  } catch { /* api() 已提示 */ }
});

// 两步确认删除
async function askDelete(btn, entry) {
  if (!btn.classList.contains('confirm')) {
    btn.classList.add('confirm');
    btn.style.color = 'var(--danger)';
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M20 6 9 17l-5-5"/></svg>';
    setTimeout(() => {
      btn.classList.remove('confirm');
      btn.style.color = '';
      btn.innerHTML = ICONS.trash;
    }, 3000);
    return;
  }
  await api(`/api/entries/${entry.id}`, { method: 'DELETE' });
  state.entries = state.entries.filter((e) => e.id !== entry.id);
  render();
  toast('已删除', 'success');
}

// ---------------- 复制 ----------------
/** 复制文本到剪贴板（浏览器无法可靠地定时清空剪贴板，故不做自动清除） */
async function copyText(text, msg) {
  if (!text) { toast('此字段没有内容', 'info'); return; }
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // 兼容非安全上下文
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast(msg, 'success');
}

// ---------------- 只读条目详情 ----------------
let viewSecretTimers = [];

function openEntryView(entry) {
  state.viewingId = entry.id;
  const color = catColor(entry.category);
  $('#view-icon').innerHTML = entry.icon?.startsWith('data:')
    ? `<img class="avatar-img" src="${esc(entry.icon)}" alt="">`
    : `<span class="avatar-letter" style="color:${color}">${esc((entry.title || '?').trim().charAt(0))}</span>`;
  $('#view-title').textContent = entry.title;
  $('#view-subtitle').textContent = entry.subtitle || '';
  $('#view-subtitle').classList.toggle('hidden', !entry.subtitle);
  $('#view-category').textContent = entry.category;
  $('#view-category').style.setProperty('--category-color', color);
  $('#view-created').textContent = `创建 ${formatTimeValue(entryTime(entry, 'createdAt'))}`;
  $('#view-updated').textContent = `更新 ${formatTimeValue(entryTime(entry, 'updatedAt'))}`;

  const fields = entry.fields || [];
  $('#view-fields').innerHTML = fields.length ? fields.map((field, idx) => {
    if (field.type === 'divider') {
      return `<div class="view-divider">${field.name ? `<span>${esc(field.name)}</span>` : ''}</div>`;
    }
    const value = String(field.value ?? '');
    const secret = field.type === 'password' || isSecretField(field.name);
    const link = field.type === 'url' && /^https?:\/\//i.test(value);
    const content = secret
      ? '<code class="view-value secret">••••••••••</code>'
      : link ? `<a class="view-value link" href="${esc(value)}" target="_blank" rel="noopener noreferrer">${esc(value)}</a>`
        : `<span class="view-value">${esc(value) || '—'}</span>`;
    return `<div class="view-field" data-idx="${idx}">
      <span class="view-label">${esc(field.name)}</span>
      ${content}
      <div class="view-field-actions">
        ${secret ? `<button type="button" class="icon-btn sm" data-act="view-eye" title="显示密码" aria-label="显示密码">${ICONS.eye}</button>` : ''}
        ${value ? `<button type="button" class="icon-btn sm" data-act="view-copy" title="复制${esc(field.name)}" aria-label="复制${esc(field.name)}">${ICONS.copy}</button>` : ''}
      </div>
    </div>`;
  }).join('') : '<p class="view-empty">暂无字段</p>';

  const atts = entry.attachments || [];
  $('#view-attachments-section').classList.toggle('hidden', !atts.length);
  $('#view-attachments').innerHTML = atts.map((att) => `<div class="view-attachment" data-id="${esc(att.id)}">
    <span class="attach-icon">${ICONS.paperclip}</span>
    <span class="attach-name" title="${esc(att.name)}">${esc(att.name)}</span>
    <span class="attach-size">${fmtSize(att.size)}</span>
    ${isPreviewable(att.mime) ? `<button type="button" class="icon-btn sm" data-act="view-preview" title="预览附件" aria-label="预览附件">${ICONS.eye}</button>` : ''}
    <button type="button" class="icon-btn sm" data-act="view-download" title="下载附件" aria-label="下载附件">${ICONS.download}</button>
  </div>`).join('');

  $('#view-modal').classList.remove('hidden');
  document.body.classList.add('modal-open');
  $('#view-close').focus();
}

function closeEntryView(restoreFocus = true) {
  const id = state.viewingId;
  viewSecretTimers.forEach(clearTimeout);
  viewSecretTimers = [];
  $('#view-modal').classList.add('hidden');
  $('#view-fields').innerHTML = '';
  $('#view-attachments').innerHTML = '';
  $('#view-icon').innerHTML = '';
  $('#view-title').textContent = '';
  $('#view-subtitle').textContent = '';
  $('#view-category').textContent = '';
  $('#view-created').textContent = '';
  $('#view-updated').textContent = '';
  state.viewingId = null;
  if ($('#modal').classList.contains('hidden') && $('#preview-modal').classList.contains('hidden') && $('#settings-modal').classList.contains('hidden')) {
    document.body.classList.remove('modal-open');
  }
  if (restoreFocus) {
    [...document.querySelectorAll('#grid .card')].find((card) => card.dataset.id === id)
      ?.querySelector('[data-act="view"]')?.focus();
  }
}

function bindEntryView() {
  $('#view-close').addEventListener('click', () => closeEntryView());
  $('#view-done').addEventListener('click', () => closeEntryView());
  bindBackdropClose('#view-modal', () => closeEntryView());
  $('#view-edit').addEventListener('click', () => {
    const entry = state.entries.find((item) => item.id === state.viewingId);
    closeEntryView(false);
    if (entry) openModal(entry);
  });
  $('#view-fields').addEventListener('click', async (ev) => {
    const btn = ev.target.closest('button[data-act]');
    if (!btn) return;
    const field = btn.closest('.view-field');
    const entry = state.entries.find((item) => item.id === state.viewingId);
    const item = entry?.fields[Number(field.dataset.idx)];
    if (!item) return;
    if (btn.dataset.act === 'view-copy') {
      await copyText(item.value, `「${item.name}」已复制`);
    } else if (btn.dataset.act === 'view-eye') {
      const value = field.querySelector('.view-value');
      const revealed = !value.classList.contains('secret');
      value.classList.toggle('secret', revealed);
      value.textContent = revealed ? '••••••••••' : String(item.value ?? '');
      btn.title = revealed ? '显示密码' : '隐藏密码';
      btn.setAttribute('aria-label', btn.title);
      if (!revealed) {
        const timer = setTimeout(() => {
          value.classList.add('secret');
          value.textContent = '••••••••••';
          btn.title = '显示密码';
          btn.setAttribute('aria-label', btn.title);
        }, 6000);
        viewSecretTimers.push(timer);
      }
    }
  });
  $('#view-attachments').addEventListener('click', async (ev) => {
    const btn = ev.target.closest('button[data-act]');
    if (!btn) return;
    const entry = state.entries.find((item) => item.id === state.viewingId);
    const att = entry?.attachments?.find((item) => item.id === btn.closest('.view-attachment').dataset.id);
    if (!att) return;
    try {
      const response = await fetch(`/api/attachments/${att.id}`);
      if (!response.ok) return toast('附件读取失败', 'error');
      const blob = await response.blob();
      if (!state.unlocked || state.viewingId !== entry.id) return;
      const url = URL.createObjectURL(blob);
      if (btn.dataset.act === 'view-preview') {
        openPreview({ id: att.id, url, name: att.name, size: att.size, mime: att.mime });
      } else {
        const link = document.createElement('a');
        link.href = url;
        link.download = att.name;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }
    } catch { toast('附件读取失败', 'error'); }
  });
}

// ---------------- 弹窗遮罩关闭（防拖选误关） ----------------
/**
 * 遮罩关闭：仅当"按下和松开都在遮罩上、且没有拖拽位移"时才关闭。
 * 否则在输入框里拖选文字时松手落在遮罩上，click 会误触发关闭。
 */
function bindBackdropClose(backdropSel, closeFn) {
  const backdrop = $(backdropSel);
  let down = null;
  backdrop.addEventListener('mousedown', (ev) => {
    down = ev.target === backdrop ? { x: ev.clientX, y: ev.clientY } : null;
  });
  backdrop.addEventListener('mouseup', (ev) => {
    if (ev.target === backdrop && down) {
      const dist = Math.hypot(ev.clientX - down.x, ev.clientY - down.y);
      if (dist < 6) closeFn(); // 位移 < 6px 视为点击
    }
    down = null;
  });
}
function openModal(entry = null) {
  state.iconRequestId++;
  state.editingId = entry?.id ?? null;
  const isEdit = !!entry;
  $('#modal-title').textContent = isEdit ? '编辑条目' : '新增条目';
  $('#m-title').value = entry?.title ?? '';
  $('#m-subtitle').value = entry?.subtitle ?? '';
  state.pendingIcon = entry?.icon || '';
  state.svgIconValid = true;
  $('#icon-svg-code').value = '';
  $('#icon-svg-panel').classList.add('hidden');
  $('#icon-svg-btn').setAttribute('aria-expanded', 'false');
  renderIconPicker();
  populateCategorySelect(entry?.category ?? '');
  renderFields(entry?.fields || [
    { name: '账号', type: 'text', value: '', pinned: true, copyable: true },
    { name: '密码', type: 'password', value: '', pinned: true, copyable: true },
  ]);
  renderAttachSection(isEdit);
  $('#modal').classList.remove('hidden');
  document.body.classList.add('modal-open');
  setTimeout(() => $('#m-title').focus(), 60);
}

// ---------------- 自定义字段 ----------------
/** 渲染字段（字段块布局：字段名+类型一行，值一行；分割线是轻量分隔元素，不是字段） */
function renderFields(fields) {
  const list = $('#fields-list');
  if (!fields.length) {
    list.innerHTML = '<p class="fields-empty">暂无字段，点「＋ 添加字段」添加（如：账号、密码、PIN）</p>';
    return;
  }
  list.innerHTML = fields.map((f, i) => {
    // 分割线：细条分隔元素，只有可选的分组名和删除按钮（可拖动排序）
    if (f.type === 'divider') {
      return `
      <div class="divider-row" data-idx="${i}" draggable="false">
        <span class="f-drag" title="拖动排序">${ICONS.grip}</span>
        <span class="divider-line"></span>
        <input type="text" class="divider-label" placeholder="分组名称（可选），如：第一组" maxlength="20" value="${esc(f.name)}">
        <span class="divider-line"></span>
        <button type="button" class="icon-btn sm f-del" title="删除分割线">${ICONS.x}</button>
      </div>`;
    }
    // 类型缺失/未知时按字段名推断（兼容旧服务端或旧数据丢类型的情况）
    const type = FIELD_TYPES.some((t) => t.code === f.type) ? f.type : (isSecretField(f.name) ? 'password' : 'text');
    // 类型下拉不提供分割线（分割线用「— 分割线」按钮插入）
    const opts = FIELD_TYPES.filter((t) => t.code !== 'divider')
      .map((t) => `<option value="${t.code}"${t.code === type ? ' selected' : ''}>${t.label}</option>`).join('');
    return `
    <div class="field-block" data-idx="${i}" draggable="false">
      <div class="field-block-head">
        <span class="f-drag" title="拖动排序">${ICONS.grip}</span>
        <input type="text" class="f-name" placeholder="字段名，如：账号" maxlength="60" value="${esc(f.name)}">
        <select class="f-type" title="字段类型">${opts}</select>
        <button type="button" class="icon-btn sm f-pin${f.pinned ? ' active' : ''}" title="在首页卡片上显示">${ICONS.pin}</button>
        <button type="button" class="icon-btn sm f-copyable${f.copyable === false ? '' : ' active'}" title="卡片上显示复制按钮">${ICONS.copy}</button>
        <button type="button" class="icon-btn sm f-del" title="删除字段">${ICONS.trash}</button>
      </div>
      <div class="field-block-value">${valueControlHTML(type, f.value)}</div>
    </div>`;
  }).join('');
}

/** 从表单收集字段（含分割线；分割线允许空名称） */
function collectFields() {
  return [...document.querySelectorAll('#fields-list .field-block, #fields-list .divider-row')]
    .map((row) => {
      if (row.classList.contains('divider-row')) {
        return { name: row.querySelector('.divider-label').value.trim(), type: 'divider', value: '', pinned: '0', copyable: '1' };
      }
      const el = row.querySelector('.f-value');
      let value = el ? el.value : '';
      if (el && el.type === 'checkbox') value = el.checked ? '是' : '否';
      return {
        name: row.querySelector('.f-name').value.trim(),
        type: row.querySelector('.f-type').value,
        value,
        pinned: row.querySelector('.f-pin').classList.contains('active') ? '1' : '0',
        copyable: row.querySelector('.f-copyable').classList.contains('active') ? '1' : '0',
      };
    });
}

function validateEntryFormFields() {
  const rows = $$('#fields-list .field-block, #fields-list .divider-row');
  if (rows.length > 30) return '最多添加 30 个字段';
  for (const row of rows) {
    if (row.classList.contains('divider-row')) continue;
    const name = row.querySelector('.f-name').value.trim();
    const valueInput = row.querySelector('.f-value');
    const value = valueInput.type === 'checkbox' ? (valueInput.checked ? '是' : '') : valueInput.value;
    if (!name && value) return '有字段填写了内容但没有字段名，请补全字段名';
    if (name && name.length > 60) return `「${name}」字段名不能超过 60 字`;
    if (value.length > 2000) return `「${name}」内容不能超过 2000 字`;
  }
  return null;
}

/** 按字段类型校验值（与服务端一致），返回错误信息或 null */
function validateFields(fields) {
  for (const f of fields) {
    if (f.value === '') continue;
    if (f.type === 'number' && !/^[\d\s\-+()]+$/.test(f.value)) return `「${f.name}」不是有效的数字（仅限数字、空格、- + ( )）`;
    if (f.type === 'date') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(f.value)) return `「${f.name}」日期格式应为 YYYY-MM-DD`;
      const date = new Date(`${f.value}T00:00:00Z`);
      if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== f.value) return `「${f.name}」不是有效日期`;
    }
    if (f.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.value)) return `「${f.name}」不是有效的邮箱地址`;
    if (f.type === 'boolean' && f.value !== '是' && f.value !== '否') return `「${f.name}」布尔值只能为 是 或 否`;
    if (f.type === 'url' && !/^https?:\/\//i.test(f.value)) return `「${f.name}」网址应以 http:// 或 https:// 开头`;
  }
  return null;
}

function bindFieldsEvents() {
  $('#fields-add-btn').addEventListener('click', () => {
    if ($$('#fields-list .field-block, #fields-list .divider-row').length >= 30) return toast('最多添加 30 个字段', 'error');
    const rows = collectFields();
    rows.push({ name: '', type: 'text', value: '' });
    renderFields(rows);
    const last = $('#fields-list .field-block:last-child .f-name');
    if (last) last.focus();
  });

  // 快捷插入分割线（用于把字段分成几组，如多个 QQ 号）
  $('#fields-divider-btn').addEventListener('click', () => {
    if ($$('#fields-list .field-block, #fields-list .divider-row').length >= 30) return toast('最多添加 30 个字段', 'error');
    const rows = collectFields();
    rows.push({ name: '', type: 'divider', value: '' });
    renderFields(rows);
    const last = $('#fields-list .field-block:last-child .f-name');
    if (last) { last.placeholder = '分组名称（可选），如：QQ1'; last.focus(); }
  });

  // 切换字段类型 → 重新生成值输入控件（保留已输入的值）
  $('#fields-list').addEventListener('change', (ev) => {
    const sel = ev.target.closest('.f-type');
    if (!sel) return;
    const block = sel.closest('.field-block');
    const oldVal = block.querySelector('.f-value')?.value || '';
    block.querySelector('.field-block-value').innerHTML = valueControlHTML(sel.value, oldVal);
  });

  $('#fields-list').addEventListener('click', (ev) => {
    const btn = ev.target.closest('button');
    if (!btn) return;
    const row = btn.closest('.field-block, .divider-row');
    if (!row) return;
    // 分割线：只有删除操作
    if (row.classList.contains('divider-row')) {
      if (btn.classList.contains('f-del')) {
        const rows = collectFields();
        rows.splice(Number(row.dataset.idx), 1);
        renderFields(rows);
      }
      return;
    }
    const input = row.querySelector('.f-value');
    if (btn.classList.contains('f-pin')) { // 置顶：是否显示在首页卡片上
      btn.classList.toggle('active');
    } else if (btn.classList.contains('f-copyable')) { // 卡片上是否显示复制按钮
      btn.classList.toggle('active');
    } else if (btn.classList.contains('f-eye')) {
      input.type = input.type === 'password' ? 'text' : 'password';
    } else if (btn.classList.contains('f-gen')) {
      input.value = generatePassword();
      input.type = 'text';
      toast('已生成随机密码', 'success');
    } else if (btn.classList.contains('f-del')) {
      const rows = collectFields();
      rows.splice(Number(row.dataset.idx), 1);
      renderFields(rows);
    }
  });

  // ---------------- 字段/分割线拖拽排序 ----------------
  const DRAG_SEL = '.field-block, .divider-row';
  let dragIdx = null;
  const clearDrag = () => {
    dragIdx = null;
    for (const b of document.querySelectorAll('#fields-list ' + DRAG_SEL)) {
      b.classList.remove('dragging', 'drop-before', 'drop-after');
      b.draggable = false;
    }
  };
  // 只有按住拖拽手柄才允许拖动，避免影响输入框里的文字选择
  $('#fields-list').addEventListener('mousedown', (ev) => {
    const block = ev.target.closest(DRAG_SEL);
    if (block) block.draggable = !!ev.target.closest('.f-drag');
  });
  $('#fields-list').addEventListener('dragstart', (ev) => {
    const block = ev.target.closest(DRAG_SEL);
    if (!block) return;
    dragIdx = Number(block.dataset.idx);
    block.classList.add('dragging');
    ev.dataTransfer.effectAllowed = 'move';
    ev.dataTransfer.setData('text/plain', String(dragIdx));
  });
  $('#fields-list').addEventListener('dragover', (ev) => {
    ev.preventDefault(); // 允许放置
    ev.dataTransfer.dropEffect = 'move';
    const block = ev.target.closest(DRAG_SEL);
    for (const b of document.querySelectorAll('#fields-list ' + DRAG_SEL)) b.classList.remove('drop-before', 'drop-after');
    if (block) {
      // 指针在目标块上半部 = 插到它前面，下半部 = 插到它后面
      const rect = block.getBoundingClientRect();
      block.classList.add(ev.clientY < rect.top + rect.height / 2 ? 'drop-before' : 'drop-after');
    }
  });
  $('#fields-list').addEventListener('drop', (ev) => {
    ev.preventDefault();
    const target = ev.target.closest(DRAG_SEL);
    if (target && dragIdx !== null) {
      const rect = target.getBoundingClientRect();
      const before = ev.clientY < rect.top + rect.height / 2;
      let to = Number(target.dataset.idx) + (before ? 0 : 1); // 目标索引（原始数组中）
      const rows = collectFields(); // 先按当前输入收集（保留已填的值）
      const [moved] = rows.splice(dragIdx, 1);
      if (dragIdx < to) to -= 1; // 移除后索引前移
      rows.splice(to, 0, moved);
      renderFields(rows);
      toast('顺序已调整，保存后生效', 'info');
    }
    clearDrag();
  });
  $('#fields-list').addEventListener('dragend', clearDrag);

  // ---------------- 图标上传 ----------------
  /** 上传图片并压缩为小图标（dataURL），避免撑大数据文件 */
  async function readIconImage(file) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const size = 96;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        // 保留透明背景：图标直接显示在卡片彩色头像背景上，不套白框
        ctx.drawImage(img, 0, 0, size, size);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => resolve(null);
      img.src = URL.createObjectURL(file);
    });
  }
  $('#icon-upload-btn').addEventListener('click', () => $('#icon-file').click());
  $('#icon-svg-btn').addEventListener('click', () => {
    const panel = $('#icon-svg-panel');
    const open = panel.classList.toggle('hidden') === false;
    $('#icon-svg-btn').setAttribute('aria-expanded', String(open));
    if (open) $('#icon-svg-code').focus();
  });
  async function applySvgCode() {
    if ($('#modal').classList.contains('hidden')) return;
    const markup = $('#icon-svg-code').value.trim();
    if (!markup) return toast('请先粘贴 SVG 代码', 'error');
    state.svgIconValid = false;
    const requestId = state.iconRequestId;
    try {
      const icon = await rasterizeIconSvg(markup);
      if (requestId !== state.iconRequestId || $('#modal').classList.contains('hidden')) return;
      state.pendingIcon = icon;
      state.svgIconValid = true;
      renderIconPicker();
      toast('SVG 图标已应用', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  }
  $('#icon-svg-code').addEventListener('input', () => {
    state.iconRequestId++;
    state.svgIconValid = !$('#icon-svg-code').value.trim();
  });
  $('#icon-svg-apply').addEventListener('click', applySvgCode);
  $('#icon-remove-btn').addEventListener('click', () => {
    state.iconRequestId++;
    state.pendingIcon = '';
    state.svgIconValid = true;
    $('#icon-svg-code').value = '';
    renderIconPicker();
  });
  $('#icon-file').addEventListener('change', async (ev) => {
    const file = ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) return toast('请选择 PNG、JPEG、WebP 或 GIF 图片', 'error');
    if (file.size > 500 * 1024) return toast('图标图片不能超过 500KB', 'error');
    const requestId = ++state.iconRequestId;
    const dataUrl = await readIconImage(file);
    if (!dataUrl) return toast('无法读取该图片', 'error');
    if (requestId !== state.iconRequestId || $('#modal').classList.contains('hidden')) return;
    state.pendingIcon = dataUrl;
    state.svgIconValid = true;
    $('#icon-svg-code').value = '';
    renderIconPicker();
    toast('图标已选择', 'success');
  });
}

/** 附件区：新增时选文件立即上传（保存条目时绑定），编辑时管理已有附件 */
function renderAttachSection(isEdit) {
  $('#attach-section').classList.remove('hidden');
  $('#attach-add-btn').classList.remove('hidden'); // 新增/编辑都可添加
  if (!isEdit) {
    if (state.pendingAtts.length === 0) {
      $('#attach-list').innerHTML = '<p class="attach-empty">可添加附件（证件照片、截图等），选择后立即上传，保存条目时自动关联</p>';
    } else {
      $('#attach-list').innerHTML = state.pendingAtts.map((a) => `
        <div class="attach-row pending" data-id="${esc(a.id)}">
          <span class="attach-icon">${ICONS.paperclip}</span>
          <span class="attach-name" title="${esc(a.name)}">${esc(a.name)}</span>
          <span class="attach-size">${fmtSize(a.size)}</span>
          ${isPreviewable(a.mime) ? `<button type="button" class="icon-btn sm" data-act="att-preview" title="预览">${ICONS.eye}</button>` : ''}
          <button type="button" class="icon-btn sm" data-act="att-dl" title="下载">${ICONS.download}</button>
          <button type="button" class="icon-btn sm danger" data-act="att-del-pending" title="移除">${ICONS.trash}</button>
        </div>`).join('');
    }
    return;
  }
  const entry = state.entries.find((e) => e.id === state.editingId);
  const atts = entry?.attachments || [];
  if (!atts.length) {
    $('#attach-list').innerHTML = '<p class="attach-empty">暂无附件</p>';
    return;
  }
  $('#attach-list').innerHTML = atts.map((a) => `
    <div class="attach-row" data-id="${esc(a.id)}">
      <span class="attach-icon">${ICONS.paperclip}</span>
      <span class="attach-name" title="${esc(a.name)}">${esc(a.name)}</span>
      <span class="attach-size">${fmtSize(a.size)}</span>
      ${isPreviewable(a.mime) ? `<button type="button" class="icon-btn sm" data-act="att-preview" title="预览">${ICONS.eye}</button>` : ''}
      <button type="button" class="icon-btn sm" data-act="att-dl" title="下载">${ICONS.download}</button>
      <button type="button" class="icon-btn sm danger" data-act="att-del" title="删除">${ICONS.trash}</button>
    </div>`).join('');
}

function fmtSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

/** 判断附件 MIME 是否支持预览（图片/纯文本/PDF；HTML 等不预览，防 XSS） */
function isPreviewable(mime) {
  const m = String(mime || '').toLowerCase();
  return /^image\/(jpeg|png|gif|webp|bmp|svg\+xml)$/.test(m) ||
    /^(text\/(plain|markdown|csv)|application\/(json|xml))$/.test(m) ||
    m === 'application/pdf';
}

/** 上传单个附件到条目；失败时返回带原因的错误信息（便于定位问题） */
async function uploadAttachment(entryId, file) {
  const fd = new FormData();
  fd.append('file', file, file.name);
  let r;
  try {
    r = await fetch(`/api/entries/${entryId}/attachments`, { method: 'POST', body: fd });
  } catch {
    return { ok: false, msg: '网络错误，无法连接服务器' };
  }
  const text = await r.text();
  let d = {};
  try { d = JSON.parse(text); } catch { /* 非 JSON 响应（如 Express 默认 404 页） */ }
  if (!r.ok) {
    if (r.status === 404) return { ok: false, msg: '上传接口不存在：服务未更新，请重启（Ctrl+C 后 npm start，Docker 用 docker compose up -d --build）' };
    if (r.status === 401) return { ok: false, msg: '会话已过期，请重新解锁' };
    return { ok: false, msg: d.error || `上传失败（${r.status}）` };
  }
  return { ok: true, attachment: d.attachment };
}

/** 上传附件到暂存区（新增条目：保存时再绑定到条目） */
async function uploadPendingAttachment(file) {
  const fd = new FormData();
  fd.append('file', file, file.name);
  let r;
  try {
    r = await fetch('/api/pending-attachments', { method: 'POST', body: fd });
  } catch {
    return { ok: false, msg: '网络错误，无法连接服务器' };
  }
  const text = await r.text();
  let d = {};
  try { d = JSON.parse(text); } catch { /* 非 JSON 响应 */ }
  if (!r.ok) {
    if (r.status === 404) return { ok: false, msg: '上传接口不存在：服务未更新，请重启（Ctrl+C 后 npm start，Docker 用 docker compose up -d --build）' };
    if (r.status === 401) return { ok: false, msg: '会话已过期，请重新解锁' };
    return { ok: false, msg: d.error || `上传失败（${r.status}）` };
  }
  return { ok: true, attachment: d.attachment };
}

function closeModal() {
  state.iconRequestId++;
  $('#modal').classList.add('hidden');
  document.body.classList.remove('modal-open');
  state.editingId = null;
  // 取消新增：删除已上传但未绑定的暂存附件（尽力而为）
  for (const a of state.pendingAtts) {
    fetch(`/api/pending-attachments/${a.id}`, { method: 'DELETE' }).catch(() => {});
  }
  state.pendingAtts = [];
  state.pendingIcon = '';
  state.svgIconValid = true;
  $('#icon-svg-code').value = '';
}

/** 图标预览：上传的图片 → 显示图片；否则显示文字占位提示 */
function renderIconPicker() {
  const box = $('#icon-preview');
  if (state.pendingIcon && state.pendingIcon.startsWith('data:')) {
    box.innerHTML = `<img src="${esc(state.pendingIcon)}" alt="图标">`;
  } else {
    box.textContent = '🔤';
  }
}

/** 分类下拉：只读已有分类（分类只能在 ⚙️ 设置中创建）；没有分类时给出提示 */
function populateCategorySelect(selected) {
  const sel = $('#m-cat');
  const emptyBox = $('#m-cat-empty');
  let opts = state.categories
    .map((c) => `<option value="${esc(c)}">${esc(c)}</option>`)
    .join('');
  // 编辑旧条目时若分类不在列表（异常情况），保留原值避免数据丢失
  if (selected && !state.categories.includes(selected)) {
    opts = `<option value="${esc(selected)}">${esc(selected)}</option>` + opts;
  }
  sel.innerHTML = opts;

  if (state.categories.length === 0 && !selected) {
    sel.classList.add('hidden');
    emptyBox.classList.remove('hidden');
    return;
  }
  sel.classList.remove('hidden');
  emptyBox.classList.add('hidden');
  sel.value = state.categories.includes(selected) ? selected : (state.categories[0] || selected);
}

function currentCategory() {
  return $('#m-cat').value;
}

async function saveEntry() {
  if (!state.svgIconValid) { toast('请先应用有效的 SVG 图标代码，或清空输入框', 'error'); return; }
  const formErr = validateEntryFormFields();
  if (formErr) { toast(formErr, 'error'); return; }
  const fields = collectFields();
  const fieldErr = validateFields(fields);
  if (fieldErr) { toast(fieldErr, 'error'); return; }
  const payload = {
    title: $('#m-title').value.trim(),
    subtitle: $('#m-subtitle').value.trim(),
    category: currentCategory(),
    fields,
    icon: state.pendingIcon, // 空 = 卡片保持文字占位
    // 收藏不再在弹窗里设置：卡片星标是唯一入口，编辑时服务端保留原收藏状态
  };
  if (!payload.title) { toast('请填写名称', 'error'); return; }
  if (!payload.category) { toast('请先创建分类（⚙️ 设置 → 分类管理）', 'error'); return; }

  const isEdit = !!state.editingId;
  const d = await api(isEdit ? `/api/entries/${state.editingId}` : '/api/entries', {
    method: isEdit ? 'PUT' : 'POST',
    body: JSON.stringify(isEdit ? payload : { ...payload, attachIds: state.pendingAtts.map((a) => a.id) }),
  });
  if (isEdit) {
    const i = state.entries.findIndex((e) => e.id === state.editingId);
    if (i >= 0) state.entries[i] = d.entry;
  } else {
    state.entries.unshift(d.entry);
    state.pendingAtts = []; // 已绑定到新条目
  }

  closeModal();
  renderGrid();
  await loadCategories(); // 分类只在设置中创建，此处仍刷新以保持一致
  toast(isEdit ? '已保存' : '已添加', 'success');
}

// ---------------- 密码生成器 ----------------
function generatePassword(len = 18) {
  const sets = [
    'ABCDEFGHJKLMNPQRSTUVWXYZ',
    'abcdefghijkmnpqrstuvwxyz',
    '23456789',
    '!@#$%^&*-_=+?',
  ];
  const all = sets.join('');
  const rand = (n) => Math.floor(crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32 * n);
  const arr = sets.map((s) => s[rand(s.length)]); // 保证每类至少一个
  while (arr.length < len) arr.push(all[rand(all.length)]);
  for (let i = arr.length - 1; i > 0; i--) { // Fisher–Yates
    const j = rand(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.join('');
}

const OBVIOUS_PASSWORDS = new Set([
  'password', 'password123', 'password12345', 'password123456', '123456', '123456789',
  '123456789012', 'qwerty123', 'qwerty123456', 'admin123', 'admin12345678',
  'letmein123456', 'iloveyou12345',
]);

function isObviousPassword(password) {
  return OBVIOUS_PASSWORDS.has(password.toLowerCase()) || /^(.)\1{5,}$/u.test(password);
}

function passwordStrength(pw) {
  if (pw.length === 0) return null;
  const length = [...pw].length;
  if (length < 8 || isObviousPassword(pw)) return { label: '长度不足或过于简单', color: 'var(--danger)', pct: 28 };
  if (length < 15) return { label: '可用，建议 15 位以上', color: '#c77b00', pct: 60 };
  return { label: '长度较好，请确保独一无二', color: 'var(--ok)', pct: 100 };
}

function renderStrength(pw) {
  const s = passwordStrength(pw);
  const box = $('#setup-strength');
  const fill = $('#setup-strength-fill');
  const label = $('#setup-strength-label');
  if (!s) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  fill.style.width = s.pct + '%';
  fill.style.background = s.color;
  label.textContent = `强度：${s.label}`;
  label.style.color = s.color;
}

// ---------------- 事件绑定 ----------------
function bindEvents() {
  // 初始化
  $('#setup-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const pw = $('#setup-pw').value;
    const pw2 = $('#setup-pw2').value;
    if ([...pw].length < 8) return toast('主密码至少需要 8 位，建议 15 位以上', 'error');
    if (pw !== pw2) return toast('两次输入的主密码不一致', 'error');
    const s = passwordStrength(pw);
    if (s && s.pct < 60) return toast('主密码过于简单，请换一个独特的密码短语', 'error');
    try {
      await api('/api/setup', { method: 'POST', body: JSON.stringify({ password: pw }) });
      state.setup = true;
      await enterMain();
      toast('Keystone 已创建 🎉', 'success');
    } catch { /* api() 已提示 */ }
  });

  // 解锁（原生 fetch：需要精确区分主密码错误 / 两步验证错误）
  $('#lock-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = $('#lock-btn');
    btn.disabled = true;
    btn.textContent = '解锁中…';
    $('#lock-error').classList.add('hidden');
    try {
      const pw = $('#lock-pw').value;
      const totp = $('#lock-totp').value.trim();
      const r = await fetch('/api/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw, totp }),
      });
      const data = await r.json().catch(() => ({}));
      if (r.status === 200) {
        $('#lock-pw').value = '';
        $('#lock-totp').value = '';
        await enterMain();
      } else {
        const err = $('#lock-error');
        err.textContent = data.error || '解锁失败';
        err.classList.remove('hidden');
        err.classList.remove('shake'); void err.offsetWidth; err.classList.add('shake');
        if (state.totpEnabled) $('#lock-totp').select();
        else $('#lock-pw').select();
      }
    } finally {
      btn.disabled = false;
      btn.textContent = '解锁';
    }
  });

  // 主界面操作
  $('#add-btn').addEventListener('click', () => openModal());
  $('#lock-now-btn').addEventListener('click', async () => {
    try { await fetch('/api/lock', { method: 'POST' }); } catch { /* 忽略 */ }
    showLock();
    localStorage.setItem(LOCK_KEY, String(Date.now()));
  });
  $('#theme-btn').addEventListener('click', () => {
    const mode = currentThemeMode();
    const next = THEME_ORDER[(THEME_ORDER.indexOf(mode) + 1) % THEME_ORDER.length]; // 暗→亮→自动→暗
    localStorage.setItem('vault-theme', next);
    applyTheme();
  });

  $('#search').addEventListener('input', (ev) => {
    state.search = ev.target.value;
    $('#search-clear').classList.toggle('hidden', !ev.target.value);
    renderGrid();
  });

  // 一键清空搜索
  $('#search-clear').addEventListener('click', () => {
    $('#search').value = '';
    state.search = '';
    $('#search-clear').classList.add('hidden');
    renderGrid();
    $('#search').focus();
  });

  // 排序
  $('#sort-select').value = state.sort;
  $('#sort-select').addEventListener('change', (ev) => {
    state.sort = ev.target.value;
    localStorage.setItem('vault-sort', state.sort);
    renderGrid();
  });

  $('#chips').addEventListener('click', (ev) => {
    const chip = ev.target.closest('.chip');
    if (!chip) return;
    state.category = chip.dataset.cat;
    render();
  });

  // 弹窗
  $('#modal-close').addEventListener('click', closeModal);
  $('#modal-cancel').addEventListener('click', closeModal);
  bindBackdropClose('#modal', closeModal); // 点击遮罩关闭（防拖选误关）
  $('#entry-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    if (state.savingEntry) return;
    state.savingEntry = true;
    $('#entry-save-btn').disabled = true;
    saveEntry().catch(() => {}).finally(() => {
      state.savingEntry = false;
      $('#entry-save-btn').disabled = false;
    });
  });
  // 没有分类时：跳转到设置里的分类管理
  $('#m-cat-empty-btn').addEventListener('click', () => {
    closeModal();
    openSettings('cats');
    setTimeout(() => $('#cat-new').focus(), 120);
  });

  // 主密码强度
  $('#setup-pw').addEventListener('input', (ev) => renderStrength(ev.target.value));

  // 导出 / 导入
  $('#export-btn').addEventListener('click', async () => {
    try {
      const r = await fetch('/api/export');
      if (!r.ok) {
        const result = await r.json().catch(() => ({}));
        toast(result.error || '导出失败', 'error');
        return;
      }
      const blob = await r.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `vault-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      const attTotal = state.entries.reduce((n, e) => n + (e.attachments || []).length, 0);
      toast(`已导出备份（${state.entries.length} 条条目${attTotal ? `，${attTotal} 个附件` : ''}，不包含主密码）`, 'success');
    } catch { toast('导出失败', 'error'); }
  });

  // 从备份恢复（全新部署时在创建界面提供入口）
  $('#setup-restore-btn').addEventListener('click', () => $('#import-file').click());

  $('#import-btn').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', async (ev) => {
    const file = ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      // 已初始化时导入会覆盖当前全部数据，二次确认
      if (state.setup && !confirm('导入将覆盖当前全部数据（条目、分类、两步验证等），且需要重新解锁。确定继续？')) {
        return;
      }
      const d = await api('/api/import', { method: 'POST', body: JSON.stringify(data) });
      // 记录备份条目数，解锁后校验是否解密成功
      const entryCount = Array.isArray(data.entries) ? data.entries.length : 0;
      state.importedEntryCount = entryCount;
      // 刷新状态并回到锁定界面
      const st = await api('/api/state');
      state.setup = st.setup;
      state.totpEnabled = !!st.totpEnabled;
      if (entryCount === 0) {
        toast('备份已恢复，但备份里没有条目（0 条）——请确认你选择的是正确的备份文件', 'error');
      } else if (d.missingAttachments > 0) {
        toast(`备份已恢复（${entryCount} 条条目），但有 ${d.missingAttachments} 个附件文件缺失`, 'error');
      } else {
        toast(`备份已恢复（${entryCount} 条条目）`, 'success');
      }
      showLock('备份已恢复，请输入备份对应的主密码解锁');
    } catch (err) {
      // 区分"文件本身有问题"和"服务器拒绝了"两种情况，便于定位
      toast(err && err.message && err.message.includes('格式无效') ? '导入失败：备份文件格式无效' : `导入失败：${(err && err.message) || '未知错误'}`, 'error');
    }
  });

  // 快捷键
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      if (state.selectMode) { exitSelectMode(); return; }
      if (!$('#preview-modal').classList.contains('hidden')) closePreview();
      else if (!$('#view-modal').classList.contains('hidden')) closeEntryView();
      else if (!$('#modal').classList.contains('hidden')) closeModal();
      else if (!$('#settings-modal').classList.contains('hidden')) {
        if ($('#settings-menu').classList.contains('hidden')) showSettingsMenu(); // 子页先返回菜单
        else closeSettings();
      }
    }
    const mod = ev.ctrlKey || ev.metaKey;
    if (mod && ev.key.toLowerCase() === 'k') { // 聚焦搜索
      ev.preventDefault();
      $('#search').focus();
    } else if (mod && ev.key.toLowerCase() === 'f') { // 聚焦搜索并选中
      ev.preventDefault();
      $('#search').focus();
      $('#search').select();
    } else if (mod && ev.key.toLowerCase() === 'n') { // 新增条目
      if (state.unlocked && !state.selectMode && $('#modal').classList.contains('hidden')) {
        ev.preventDefault();
        openModal();
      }
    }
  });
}

// ---------------- 设置弹窗（两步验证） ----------------
function renderConnectionSettings() {
  const local = ['localhost', '127.0.0.1', '::1'].includes(location.hostname);
  $('#connection-warning').classList.toggle('hidden', location.protocol !== 'http:' || local);
  $('#connection-status').textContent = state.secureConnection
    ? '当前连接：HTTPS，主密码和条目传输受到加密保护。'
    : '当前连接：HTTP。请勿通过公网访问；同一网络中的其他人可能截获主密码和条目内容。';
  const toggle = $('#https-required');
  toggle.checked = state.httpsRequired;
  toggle.disabled = !state.secureConnection;
  $('#connection-guidance').textContent = state.secureConnection
    ? '开启后，HTTP 请求会被拒绝。请确认反向代理已配置证书，且直接访问 3000 端口的入口已关闭。'
    : '请先配置 HTTPS 反向代理，再从 HTTPS 地址打开 Keystone。此开关不会自动申请证书。';
}

function renderTotpSection() {
  $('#totp-enable-btn').classList.toggle('hidden', state.totpEnabled);
  $('#totp-on').classList.toggle('hidden', !state.totpEnabled);
  $('#totp-wizard').classList.add('hidden');
  $('#recovery-box').classList.add('hidden');
  $('#totp-code').value = '';
  $('#totp-disable-pw').value = '';
}

function showRecoveryCodes(codes) {
  $('#recovery-list').innerHTML = codes.map((c) => `<code>${esc(c)}</code>`).join('');
  $('#totp-on').classList.add('hidden');
  $('#recovery-box').classList.remove('hidden');
  $('#recovery-box').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/** 在浏览器本地生成 TOTP 二维码（使用 vendored qrcode-generator，密钥不会发送给任何第三方） */
function renderTotpQr(text) {
  const img = $('#totp-qr');
  try {
    if (typeof qrcode === 'function') {
      const qr = qrcode(0, 'M'); // type 0 = 自动选择版本, 纠错等级 M
      qr.addData(text);
      qr.make();
      img.src = qr.createDataURL(4, 8);
      img.classList.remove('hidden');
      return;
    }
  } catch (e) {
    console.warn('二维码生成失败，可手动输入密钥:', e);
  }
  img.classList.add('hidden'); // 兜底：隐藏二维码，仍可手动输入
}

/** 打开设置：默认显示菜单；传 section 则直接进入对应子页 */
function openSettings(section) {
  renderTotpSection();
  renderCatList();
  renderAboutStats();
  $('#autolock-select').value = String(state.autoLockMinutes); // 同步当前自动锁定时长
  renderConnectionSettings();
  showSettingsMenu();
  if (section) openSettingsSection(section);
  $('#settings-modal').classList.remove('hidden');
  document.body.classList.add('modal-open');
}

/** 数据统计：条目 / 分类 / 附件 */
function renderAboutStats() {
  const entries = state.entries.length;
  const cats = state.categories.length;
  const atts = state.entries.reduce((n, e) => n + (e.attachments || []).length, 0);
  const nums = $('#about-stats').querySelectorAll('.stat b');
  nums[0].textContent = entries;
  nums[1].textContent = cats;
  nums[2].textContent = atts;
}

function closeSettings() {
  $('#settings-modal').classList.add('hidden');
  document.body.classList.remove('modal-open');
  showSettingsMenu(); // 下次打开回到菜单
}

/** 显示设置菜单，隐藏所有子页 */
function showSettingsMenu() {
  $('#settings-menu').classList.remove('hidden');
  for (const id of ['settings-cats', 'settings-password', 'settings-totp', 'settings-autolock', 'settings-connection', 'settings-about', 'settings-backup', 'settings-health']) {
    $('#' + id).classList.add('hidden');
  }
}

/** 进入某个设置子页 */
function openSettingsSection(name) {
  if (typeof name !== 'string' || !name) return; // 防误传（如事件对象）
  $('#settings-menu').classList.add('hidden');
  $('#settings-' + name).classList.remove('hidden');
  if (name === 'backup') renderBackupStatus();
  if (name === 'health') renderPasswordHealth();
}

function passwordHealth(entries) {
  const items = [];
  const owners = new Map();
  for (const entry of entries) {
    for (const field of entry.fields || []) {
      if (field.type !== 'password' && !/(密码|口令|password|passwd)/i.test(field.name)) continue;
      const value = String(field.value ?? '');
      if (!value) continue;
      items.push({ entry, value });
      owners.set(value, (owners.get(value) || 0) + 1);
    }
  }
  const issues = new Map();
  for (const { entry, value } of items) {
    const reused = owners.get(value) > 1;
    const weak = [...value].length < 12 || isObviousPassword(value);
    if (!reused && !weak) continue;
    if (!issues.has(entry.id)) issues.set(entry.id, { entry, reused: false, weak: false });
    const issue = issues.get(entry.id);
    issue.reused ||= reused;
    issue.weak ||= weak;
  }
  return { checked: items.length, issues: [...issues.values()] };
}

function renderPasswordHealth() {
  const { checked, issues } = passwordHealth(state.entries);
  $('#health-summary').textContent = `已检查 ${checked} 个密码，${issues.length} 条记录需要处理`;
  $('#health-list').innerHTML = issues.length ? issues.map(({ entry, reused, weak }) => `
    <button type="button" class="health-row" data-id="${esc(entry.id)}">
      <span class="health-title">${esc(entry.title)}</span>
      <span class="health-reason">${[reused && '重复使用', weak && '过短或常见'].filter(Boolean).join(' · ')}</span>
    </button>`).join('') : '<p class="settings-empty">没有发现重复或明显薄弱的密码</p>';
}

async function renderBackupStatus() {
  const line = $('#backup-status');
  line.textContent = '正在检查备份…';
  try {
    const status = await api('/api/backup/status');
    if ($('#settings-backup').classList.contains('hidden')) return;
    const date = status.lastSuccessfulAt ? new Date(status.lastSuccessfulAt).toLocaleString('zh-CN') : '暂无';
    line.textContent = status.missingAttachments
      ? `有 ${status.missingAttachments} 个附件缺失，请先检查数据；最近完整备份：${date}`
      : status.lastError ? `${status.lastError}；最近完整备份：${date}`
        : `最近完整备份：${date}`;
    line.classList.toggle('error', !!(status.missingAttachments || status.lastError));
  } catch {
    line.textContent = '暂时无法读取备份状态';
    line.classList.add('error');
  }
}

// ---------------- 分类管理 ----------------
function renderCatList() {
  const list = $('#cat-chips');
  $('#cat-count-line').textContent = state.categories.length
    ? `共 ${state.categories.length} 个分类，点 × 可删除`
    : '';
  if (state.categories.length === 0) {
    list.innerHTML = '<p class="settings-empty">还没有分类，在下方添加一个吧</p>';
    return;
  }
  // 标签云布局：紧凑可换行，分类再多也只是多几行
  list.innerHTML = state.categories.map((c) => {
    const count = state.entries.filter((e) => e.category === c).length;
    return `
    <span class="cat-chip" data-cat="${esc(c)}">
      <span class="cat-dot" style="background:${catColor(c)}"></span>
      <span class="cat-chip-name">${esc(c)}</span>
      <span class="cat-chip-count">${count}</span>
      <button class="cat-chip-edit" title="重命名分类">${ICONS.edit}</button>
      <button class="cat-chip-del" title="删除分类">${ICONS.x}</button>
    </span>`;
  }).join('');
}

function bindCategoryEvents() {
  // 添加分类
  $('#cat-add-btn').addEventListener('click', addCategory);
  $('#cat-new').addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); addCategory(); }
  });

  async function addCategory() {
    const name = $('#cat-new').value.trim();
    if (!name) return toast('请输入分类名称', 'error');
    try {
      const d = await api('/api/categories', { method: 'POST', body: JSON.stringify({ name }) });
      state.categories = d.categories;
      $('#cat-new').value = '';
      renderCatList();
      renderChips();
      toast(`分类「${name}」已创建`, 'success');
    } catch { /* api() 已提示 */ }
  }

  // 删除分类（两步确认：× → ✓ → 删除）
  $('#cat-chips').addEventListener('click', async (ev) => {
    const btn = ev.target.closest('.cat-chip-del, .cat-chip-edit');
    if (!btn) return;
    const chip = btn.closest('.cat-chip');
    const name = chip.dataset.cat;

    // 重命名：进入编辑态
    if (btn.classList.contains('cat-chip-edit')) {
      chip.innerHTML = `
        <input class="cat-rename-input" value="${esc(name)}" maxlength="20">
        <button class="cat-chip-del ok" data-act="rename-ok" title="确定">${ICONS.check}</button>
        <button class="cat-chip-del" data-act="rename-cancel" title="取消">${ICONS.x}</button>`;
      const input = chip.querySelector('.cat-rename-input');
      input.focus();
      input.select();
      return;
    }
    if (btn.dataset.act === 'rename-cancel') { renderCatList(); return; }
    if (btn.dataset.act === 'rename-ok') {
      const newName = chip.querySelector('.cat-rename-input').value.trim();
      if (!newName) return toast('请输入分类名称', 'error');
      try {
        const d = await api(`/api/categories/${encodeURIComponent(name)}`, { method: 'PUT', body: JSON.stringify({ name: newName }) });
        state.categories = d.categories;
        renderCatList();
        renderChips();
        toast(`分类「${name}」已重命名为「${newName}」`, 'success');
      } catch { /* api() 已提示 */ }
      return;
    }

    // 删除（两步确认：× → ✓ → 删除）
    if (!btn.classList.contains('confirm')) {
      btn.classList.add('confirm');
      btn.innerHTML = ICONS.check;
      chip.classList.add('confirm');
      setTimeout(() => {
        btn.classList.remove('confirm');
        btn.innerHTML = ICONS.x;
        chip.classList.remove('confirm');
      }, 3000);
      return;
    }
    try {
      const d = await api(`/api/categories/${encodeURIComponent(name)}`, { method: 'DELETE' });
      state.categories = d.categories;
      renderCatList();
      renderChips();
      toast(`分类「${name}」已删除`, 'success');
    } catch { /* api() 已提示（分类下有记录时会拒绝） */ }
  });
}

function bindSettingsEvents() {
  // 注意：不能直接传 openSettings，否则事件对象会被当成 section 参数
  $('#settings-btn').addEventListener('click', () => openSettings());
  $('#settings-close').addEventListener('click', closeSettings);
  bindBackdropClose('#settings-modal', closeSettings); // 点击遮罩关闭（防拖选误关）

  // 设置菜单 → 子页
  $('#settings-menu').addEventListener('click', (ev) => {
    const row = ev.target.closest('.settings-row');
    if (row) openSettingsSection(row.dataset.open);
  });
  // 子页 → 返回菜单
  $$('.settings-back').forEach((b) => b.addEventListener('click', showSettingsMenu));
  $('#health-list').addEventListener('click', (ev) => {
    const row = ev.target.closest('.health-row');
    const entry = state.entries.find((item) => item.id === row?.dataset.id);
    if (!entry) return;
    closeSettings();
    openEntryView(entry);
  });

  $('#https-required').addEventListener('change', async (ev) => {
    const required = ev.target.checked;
    ev.target.disabled = true;
    try {
      const d = await api('/api/settings/https', { method: 'POST', body: JSON.stringify({ httpsRequired: required }) });
      state.httpsRequired = d.httpsRequired;
      state.secureConnection = d.secureConnection;
      toast(required ? '已启用仅允许 HTTPS' : '已允许 HTTP 访问', 'success');
    } catch { /* api() 已提示 */ }
    renderConnectionSettings();
  });

  // 开启：第一步 生成密钥
  $('#totp-enable-btn').addEventListener('click', async () => {
    try {
      const d = await api('/api/totp/start', { method: 'POST', body: '{}' });
      $('#totp-secret').textContent = d.secret;
      renderTotpQr(d.otpauth); // 浏览器本地生成二维码（密钥不出浏览器）
      $('#totp-enable-btn').classList.add('hidden');
      $('#totp-wizard').classList.remove('hidden');
      setTimeout(() => $('#totp-code').focus(), 60);
    } catch { /* api() 已提示 */ }
  });

  $('#totp-secret-copy').addEventListener('click', async () => {
    const secret = $('#totp-secret').textContent;
    try {
      await navigator.clipboard.writeText(secret);
      toast('密钥已复制', 'success');
    } catch { toast('复制失败，请手动输入', 'error'); }
  });

  // 开启：第二步 验证码确认
  $('#totp-confirm-btn').addEventListener('click', async () => {
    const code = $('#totp-code').value.trim();
    if (!code) return toast('请输入验证码', 'error');
    try {
      const d = await api('/api/totp/verify', { method: 'POST', body: JSON.stringify({ code }) });
      state.totpEnabled = true;
      $('#totp-wizard').classList.add('hidden');
      showRecoveryCodes(d.recoveryCodes);
      toast('两步验证已开启 🎉', 'success');
    } catch { /* api() 已提示 */ }
  });

  // 关闭：需主密码确认
  $('#totp-disable-btn').addEventListener('click', async () => {
    const pw = $('#totp-disable-pw').value;
    if (!pw) return toast('请输入主密码确认', 'error');
    try {
      await api('/api/totp/disable', { method: 'POST', body: JSON.stringify({ password: pw }) });
      state.totpEnabled = false;
      renderTotpSection();
      toast('两步验证已关闭', 'success');
    } catch { /* api() 已提示 */ }
  });

  // 重新生成恢复码
  $('#recovery-regen-btn').addEventListener('click', async () => {
    try {
      const d = await api('/api/recovery/regenerate', { method: 'POST', body: '{}' });
      showRecoveryCodes(d.recoveryCodes);
    } catch { /* api() 已提示 */ }
  });

  // 已保存恢复码
  $('#recovery-done-btn').addEventListener('click', () => {
    $('#recovery-box').classList.add('hidden');
    renderTotpSection();
  });

  // 修改主密码
  $('#pw-change-btn').addEventListener('click', async () => {    const oldPw = $('#pw-old').value;
    const newPw = $('#pw-new').value;
    const newPw2 = $('#pw-new2').value;
    if (!oldPw) return toast('请输入当前主密码', 'error');
    if ([...newPw].length < 8) return toast('新主密码至少需要 8 位，建议 15 位以上', 'error');
    if (newPw !== newPw2) return toast('两次输入的新主密码不一致', 'error');
    try {
      await api('/api/password', { method: 'POST', body: JSON.stringify({ oldPassword: oldPw, newPassword: newPw }) });
      $('#pw-old').value = '';
      $('#pw-new').value = '';
      $('#pw-new2').value = '';
      toast('主密码已修改，所有数据已用新密码重新加密', 'success');
    } catch { /* api() 已提示 */ }
  });

  // 备份与恢复：复用顶栏的导出/导入入口
  $('#backup-export-btn').addEventListener('click', () => $('#export-btn').click());
  $('#backup-import-btn').addEventListener('click', () => $('#import-btn').click());
}

// ---------------- 附件 ----------------
let previewUrl = null; // 当前预览的对象 URL（关闭时释放）
let previewAtt = null; // 当前预览的附件 {id, name}

/** 打开附件预览（图片放大 / PDF 内嵌 / 纯文本显示；HTML 不预览，防 XSS） */
function openPreview({ id, url, name, size, mime }) {
  previewUrl = url;
  previewAtt = { id, name };
  $('#preview-name').textContent = name;
  $('#preview-name').title = name;
  $('#preview-size').textContent = fmtSize(size);
  const body = $('#preview-body');
  body.innerHTML = '';
  const m = String(mime).toLowerCase();
  if (/^image\//.test(m)) {
    const img = document.createElement('img');
    img.src = url;
    img.alt = name;
    body.appendChild(img);
  } else if (m === 'application/pdf') {
    const iframe = document.createElement('iframe');
    iframe.src = url;
    iframe.title = name;
    body.appendChild(iframe);
  } else {
    // 纯文本：以文本方式显示（textContent 写入，不解析 HTML，安全）
    fetch(url).then((r) => r.text()).then((t) => {
      const pre = document.createElement('pre');
      pre.textContent = t;
      body.appendChild(pre);
    }).catch(() => {
      body.innerHTML = '<p class="preview-unsupported">无法读取文件内容</p>';
    });
  }
  $('#preview-modal').classList.remove('hidden');
  document.body.classList.add('modal-open');
}

function closePreview() {
  $('#preview-modal').classList.add('hidden');
  $('#preview-body').innerHTML = '';
  if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
  previewAtt = null;
  // 条目弹窗还开着时保留滚动锁定
  if ($('#modal').classList.contains('hidden') && $('#settings-modal').classList.contains('hidden') && $('#view-modal').classList.contains('hidden')) {
    document.body.classList.remove('modal-open');
  }
}

function bindAttachEvents() {
  $('#attach-add-btn').addEventListener('click', () => $('#attach-file').click());

  // 上传（multipart，不能走 api() 的 JSON 头）
  $('#attach-file').addEventListener('change', async (ev) => {
    const files = [...ev.target.files];
    ev.target.value = '';
    if (!files.length) return;
    if (!state.editingId) {
      // 新增模式：立即上传到暂存区，保存条目时绑定
      for (const f of files) {
        const res = await uploadPendingAttachment(f);
        if (res.ok) { state.pendingAtts.push(res.attachment); toast(`「${f.name}」已上传`, 'success'); }
        else toast(`「${f.name}」${res.msg}`, 'error');
      }
      renderAttachSection(false);
      return;
    }
    // 编辑模式：立即上传到条目
    for (const f of files) {
      const res = await uploadAttachment(state.editingId, f);
      if (!res.ok) { toast(res.msg, 'error'); continue; }
      const entry = state.entries.find((e) => e.id === state.editingId);
      if (entry) {
        entry.attachments = entry.attachments || [];
        entry.attachments.push(res.attachment);
      }
      toast(`「${f.name}」已上传`, 'success');
    }
    renderAttachSection(true);
  });

  // 下载 / 预览 / 删除 / 移除暂存
  $('#attach-list').addEventListener('click', async (ev) => {
    const btn = ev.target.closest('button[data-act]');
    if (!btn) return;
    const row = btn.closest('.attach-row');
    const attId = row.dataset.id;
    const entry = state.entries.find((e) => e.id === state.editingId);
    const att = (entry?.attachments || []).find((a) => a.id === attId)
      || state.pendingAtts.find((a) => a.id === attId); // 新增模式的暂存附件也可预览/下载

    if (btn.dataset.act === 'att-del-pending') { // 移除新增模式下已上传但未绑定的附件
      try {
        const r = await fetch(`/api/pending-attachments/${attId}`, { method: 'DELETE' });
        if (r.ok) {
          state.pendingAtts = state.pendingAtts.filter((a) => a.id !== attId);
          renderAttachSection(false);
          toast('已移除', 'success');
        } else toast('移除失败', 'error');
      } catch { toast('移除失败', 'error'); }
      return;
    }

    if (btn.dataset.act === 'att-preview') {
      try {
        const r = await fetch(`/api/attachments/${attId}`);
        if (!r.ok) return toast('预览失败', 'error');
        const buf = await r.arrayBuffer();
        const blob = new Blob([buf], { type: att?.mime || 'application/octet-stream' });
        openPreview({ id: attId, url: URL.createObjectURL(blob), name: att?.name || '附件', size: att?.size || 0, mime: att?.mime || '' });
      } catch { toast('预览失败', 'error'); }
      return;
    }
    if (btn.dataset.act === 'att-dl') {
      try {
        const r = await fetch(`/api/attachments/${attId}`);
        if (!r.ok) return toast('下载失败', 'error');
        const blob = await r.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = att?.name || '附件';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      } catch { toast('下载失败', 'error'); }
    } else if (btn.dataset.act === 'att-del') {
      if (!btn.classList.contains('confirm')) { // 两步确认
        btn.classList.add('confirm');
        btn.innerHTML = ICONS.check;
        btn.style.color = 'var(--danger)';
        setTimeout(() => {
          btn.classList.remove('confirm');
          btn.innerHTML = ICONS.trash;
          btn.style.color = '';
        }, 3000);
        return;
      }
      try {
        const r = await fetch(`/api/attachments/${attId}`, { method: 'DELETE' });
        if (!r.ok) return toast('删除失败', 'error');
        entry.attachments = (entry.attachments || []).filter((x) => x.id !== attId);
        renderAttachSection(true);
        toast('附件已删除', 'success');
      } catch { toast('删除失败', 'error'); }
    }
  });

  // 预览弹窗：关闭 / 下载 / 遮罩关闭
  $('#preview-close').addEventListener('click', closePreview);
  bindBackdropClose('#preview-modal', closePreview);
  $('#preview-dl').addEventListener('click', async () => {
    if (!previewAtt || !previewAtt.id) return;
    try {
      const r = await fetch(`/api/attachments/${previewAtt.id}`);
      if (!r.ok) return toast('下载失败', 'error');
      const blob = await r.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = previewAtt.name || '附件';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch { toast('下载失败', 'error'); }
  });
}

// ---------------- 批量操作 ----------------
function positionBatchBar() {
  const topbar = document.querySelector('.topbar');
  $('#batch-bar').style.top = (topbar ? topbar.offsetHeight : 0) + 'px'; // 贴在顶栏正下方
}

function setBatchButtonLabel(label) {
  const button = $('#batch-btn');
  button.querySelector('.batch-label').textContent = label;
  button.title = label;
  button.setAttribute('aria-label', label);
}

function enterSelectMode() {
  state.selectMode = true;
  state.selected.clear();
  positionBatchBar();
  $('#batch-bar').classList.remove('hidden');
  setBatchButtonLabel('取消多选');
  renderGrid();
  updateBatchBar();
}

function exitSelectMode() {
  state.selectMode = false;
  state.selected.clear();
  $('#batch-bar').classList.add('hidden');
  $('#batch-cat-wrap').classList.add('hidden');
  setBatchButtonLabel('批量操作');
  renderGrid();
}

function updateBatchBar() {
  const n = state.selected.size;
  $('#batch-count').textContent = `已选 ${n} 项`;
  const visible = $('#batch-cat-wrap').classList.contains('hidden');
  $('#batch-cat-btn').classList.toggle('hidden', !visible);
}

function bindBatchEvents() {
  $('#batch-btn').addEventListener('click', () => {
    state.selectMode ? exitSelectMode() : enterSelectMode();
  });

  // 多选模式下窗口尺寸变化时保持工具条贴在顶栏下方
  window.addEventListener('resize', () => {
    if (state.selectMode) positionBatchBar();
  });

  // 全选当前筛选结果
  $('#batch-all').addEventListener('click', () => {
    const q = state.search.trim().toLowerCase();
    const all = state.entries.filter((e) => {
      if (state.category === '收藏' && !e.favorite) return false;
      if (state.category !== '全部' && state.category !== '收藏' && e.category !== state.category) return false;
      if (q) {
        const hay = [e.title, ...(e.fields || []).flatMap((f) => [f.name, f.value])].map((v) => String(v ?? '').toLowerCase());
        if (!hay.some((v) => v.includes(q))) return false;
      }
      return true;
    });
    if (all.length && state.selected.size === all.length) state.selected.clear();
    else all.forEach((e) => state.selected.add(e.id));
    renderGrid();
    updateBatchBar();
  });

  // 改分类：显示分类选择
  $('#batch-cat-btn').addEventListener('click', () => {
    const sel = $('#batch-cat-select');
    sel.innerHTML = state.categories.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    $('#batch-cat-wrap').classList.remove('hidden');
    updateBatchBar();
    sel.focus();
  });
  $('#batch-cat-cancel').addEventListener('click', () => {
    $('#batch-cat-wrap').classList.add('hidden');
    updateBatchBar();
  });
  $('#batch-cat-ok').addEventListener('click', async () => {
    const cat = $('#batch-cat-select').value;
    if (!state.selected.size) return;
    if (!cat) return toast('请先创建分类（设置 → 分类管理）', 'error');
    const ids = [...state.selected];
    let ok = 0;
    for (const e of state.entries.filter((x) => ids.includes(x.id))) {
      try {
        await api(`/api/entries/${e.id}`, { method: 'PUT', body: JSON.stringify({ title: e.title, subtitle: e.subtitle, category: cat, fields: e.fields }) });
        ok++;
      } catch { /* 单个失败继续 */ }
    }
    if (ok) { await loadCategories(); await loadEntries(); toast(`已将 ${ok} 条条目移动到「${cat}」`, 'success'); }
    exitSelectMode();
  });

  // 导出所选（加密子备份，可再次导入）
  $('#batch-export-btn').addEventListener('click', async () => {
    if (!state.selected.size) return toast('请先选择条目', 'error');
    try {
      const r = await fetch('/api/export-selected', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [...state.selected] }),
      });
      if (!r.ok) return toast('导出失败', 'error');
      const blob = await r.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `keystone-selected-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      toast(`已导出 ${state.selected.size} 条条目（加密备份）`, 'success');
    } catch { toast('导出失败', 'error'); }
  });

  // 批量删除（二次确认）
  $('#batch-delete-btn').addEventListener('click', async () => {
    const n = state.selected.size;
    if (!n) return toast('请先选择条目', 'error');
    if (!confirm(`确定删除选中的 ${n} 条条目吗？删除后不可恢复。`)) return;
    const ids = [...state.selected];
    let ok = 0;
    for (const id of ids) {
      try { await api(`/api/entries/${id}`, { method: 'DELETE' }); ok++; } catch { /* 继续 */ }
    }
    if (ok) { await loadEntries(); toast(`已删除 ${ok} 条条目`, 'success'); }
    exitSelectMode();
  });
}

// ---------------- 自动锁定时长设置 ----------------
function bindAutolockEvents() {
  $('#autolock-select').addEventListener('change', async (ev) => {
    const m = Number(ev.target.value);
    try {
      const d = await api('/api/settings', { method: 'POST', body: JSON.stringify({ autoLockMinutes: m }) });
      state.autoLockMinutes = d.autoLockMinutes;
      resetIdle(); // 用新时长重启闲置计时
      toast(`自动锁定已设为 ${m} 分钟`, 'success');
    } catch { /* api() 已提示 */ }
  });
}

// ---------------- 闲置自动锁定 ----------------
function resetIdle(record = true) {
  clearTimeout(state.idleTimer);
  if (record && state.unlocked) localStorage.setItem(ACTIVITY_KEY, String(Date.now()));
  state.idleTimer = setTimeout(lockNow, state.autoLockMinutes * 60 * 1000);
}

function startIdleWatch() {
  const EVENTS = ['click', 'keydown', 'touchstart', 'scroll'];
  EVENTS.forEach((e) => document.addEventListener(e, () => {
    const now = Date.now();
    if (state.unlocked && now - state.lastIdleReset > 30_000) {
      state.lastIdleReset = now;
      resetIdle();
      fetch('/api/activity', { method: 'POST' }).catch(() => {});
    }
  }, { passive: true }));
  window.addEventListener('storage', (ev) => {
    if (ev.key === ACTIVITY_KEY && state.unlocked) resetIdle(false);
    if (ev.key === LOCK_KEY && state.unlocked) showLock('另一标签页已锁定');
  });
}

async function lockNow() {
  if (!state.unlocked) return;
  const last = Number(localStorage.getItem(ACTIVITY_KEY)) || 0;
  if (Date.now() - last < state.autoLockMinutes * 60_000 - 1000) {
    resetIdle(false);
    return;
  }
  try { await fetch('/api/lock', { method: 'POST' }); } catch { /* 忽略 */ }
  showLock('已闲置超时，自动锁定');
  localStorage.setItem(LOCK_KEY, String(Date.now()));
}

// 会话状态轮询（服务端过期时兜底锁定）
function startPolling() {
  setInterval(async () => {
    try {
      const st = await fetch('/api/state').then((r) => r.json());
      if (state.unlocked && !st.unlocked) showLock('会话已过期，请重新解锁');
    } catch { /* 网络抖动忽略 */ }
  }, 30_000);
}

// ---------------- 启动 ----------------
(async function init() {
  applyTheme();
  renderConnectionSettings();
  bindEvents();
  bindSettingsEvents();
  bindEntryView();
  bindCategoryEvents();
  bindAttachEvents();
  bindFieldsEvents();
  bindBatchEvents();
  bindAutolockEvents();
  startIdleWatch();
  startPolling();

  try {
    const st = await api('/api/state');
    state.setup = st.setup;
    state.autoLockMinutes = st.autoLockMinutes || 30;
    state.totpEnabled = !!st.totpEnabled;
    state.httpsRequired = !!st.httpsRequired;
    state.secureConnection = !!st.secureConnection;
    renderConnectionSettings();
    if (!st.setup) {
      showView('setup');
      setTimeout(() => $('#setup-pw').focus(), 60);
    } else if (st.unlocked) {
      await enterMain();
    } else {
      showLock();
    }
  } catch {
    showLock();
  }
})();
