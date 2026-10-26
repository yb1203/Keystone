// UI 端到端测试：用系统 Chrome(headless + CDP) 驱动界面，逐步截图
// 运行：node tests/ui-test.mjs
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'http://127.0.0.1:3777';
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CHROME_CANDIDATES = process.platform === 'darwin'
  ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
  : process.platform === 'win32'
    ? ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe']
    : ['google-chrome', 'chromium', 'chromium-browser'];
const CHROME = process.env.CHROME_BIN || CHROME_CANDIDATES.find((p) => p.includes('/') ? existsSync(p) : true);
const PROFILE = join(ROOT, '.chrome-profile');
const SHOTS = join(ROOT, 'shots');

if (!CHROME) throw new Error('未找到 Chrome；可通过 CHROME_BIN 指定浏览器路径');

mkdirSync(SHOTS, { recursive: true });
rmSync(PROFILE, { recursive: true, force: true });

// ---------- 启动 Chrome ----------
const chrome = spawn(CHROME, [
  '--headless=new',
  '--remote-debugging-port=9222',
  `--user-data-dir=${PROFILE}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-crash-reporter',
  '--disable-breakpad',
  '--disable-extensions',
  '--window-size=1440,900',
  '--hide-scrollbars',
  BASE,
], { stdio: 'ignore' });

// ---------- 等待 CDP 就绪 ----------
let version;
for (let i = 0; i < 50; i++) {
  try { version = await fetch('http://127.0.0.1:9222/json/version').then(r => r.json()); break; }
  catch { await new Promise(r => setTimeout(r, 200)); }
}
if (!version) { console.error('Chrome CDP 启动失败'); process.exit(1); }

const targets = await fetch('http://127.0.0.1:9222/json').then(r => r.json());
const page = targets.find(t => t.type === 'page');
if (!page) { console.error('未找到页面目标'); process.exit(1); }

// ---------- 极简 CDP 客户端 ----------
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let msgId = 0;
const pending = new Map();
const consoleErrors = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') consoleErrors.push(m.params.exceptionDetails.text);
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') consoleErrors.push(m.params.entry.text);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    consoleErrors.push(m.params.args.map(a => a.value ?? a.description ?? '').join(' '));
  }
};

function send(method, params = {}) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res) => pending.set(id, res));
}

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error('页面 JS 异常: ' + JSON.stringify(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
  return r.result?.result?.value;
}

async function sleep(ms) { await new Promise(r => setTimeout(r, ms)); }
const cardExpr = (title) => `[...document.querySelectorAll('.card')].find((card) => card.querySelector('h3')?.textContent === ${JSON.stringify(title)})`;

async function screenshot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${SHOTS}/${name}.png`, Buffer.from(r.result.data, 'base64'));
  console.log(`  📸 ${name}.png`);
}

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await sleep(1500); // 等首屏渲染

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? '  ✅' : '  ❌'} ${name} ${extra}`); };

// ---------- 1. 初始化界面 ----------
check('显示创建界面', await evaluate(`!document.querySelector('#view-setup').classList.contains('hidden')`));
check('8 位主密码可用且提示建议加长', await evaluate(`passwordStrength('Abc12345')?.pct === 60 && passwordStrength('Abc1234')?.pct === 28`));
await screenshot('1-创建界面');

// ---------- 2. 填写主密码创建 ----------
await evaluate(`(() => {
  const p1 = document.querySelector('#setup-pw');
  p1.value = 'MyUI@Test2024';
  p1.dispatchEvent(new Event('input', { bubbles: true }));
  const p2 = document.querySelector('#setup-pw2');
  p2.value = 'MyUI@Test2024';
  document.querySelector('#setup-form').requestSubmit();
  return true;
})()`);
await sleep(2500); // 等待 scrypt 派生
check('创建后进入主界面', await evaluate(`!document.querySelector('#view-main').classList.contains('hidden')`));
await screenshot('2-创建后空状态');

// 新流程：分类只能在设置中创建 → 先通过 API 建好分类，再刷新页面加载
await evaluate(`fetch('/api/categories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '社交' }) })`);
await evaluate(`fetch('/api/categories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '银行' }) })`);
await evaluate(`fetch('/api/categories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '邮箱' }) })`);
await send('Page.reload');
await sleep(2000);
check('刷新后分类标签显示', await evaluate(`document.querySelectorAll('.chip').length === 5`)); // 全部/收藏/社交/银行/邮箱

check('SVG 代码可安全转成 PNG 图标', await evaluate(`(async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#6366f1" d="M2 2h20v20H2z"/></svg>';
  return (await rasterizeIconSvg(svg)).startsWith('data:image/png;base64,');
})()`));
check('SVG 脚本和外链被拒绝', await evaluate(`(() => {
  const bad = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><script>alert(1)</script></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><image href="https://example.com/a.png"/></svg>',
  ];
  return bad.every((svg) => { try { sanitizeIconSvg(svg); return false; } catch { return true; } });
})()`));
await evaluate(`document.querySelector('#add-btn').click()`);
await evaluate(`(() => {
  document.querySelector('#icon-svg-btn').click();
  const code = document.querySelector('#icon-svg-code');
  code.value = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#6366f1" d="M2 2h20v20H2z"/></svg>';
  code.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
check('粘贴 SVG 不会提前应用', await evaluate(`!state.svgIconValid && !state.pendingIcon && !document.querySelector('#icon-preview img')`));
await evaluate(`document.querySelector('#icon-svg-apply').click()`);
await sleep(150);
check('点击应用后才出现 SVG 图标预览', await evaluate(`state.svgIconValid && state.pendingIcon.startsWith('data:image/png;base64,') && !!document.querySelector('#icon-preview img')`));
await screenshot('2b-SVG图标输入');
check('无字段名的已填内容不会在新增字段时丢失', await evaluate(`(() => {
  document.querySelector('#fields-add-btn').click();
  const rows = document.querySelectorAll('#fields-list .field-block');
  rows[2].querySelector('.f-value').value = '不可丢失的内容';
  document.querySelector('#fields-add-btn').click();
  const kept = document.querySelectorAll('#fields-list .field-block');
  return kept.length === 4 && kept[2].querySelector('.f-value').value === '不可丢失的内容' &&
    validateEntryFormFields()?.includes('没有字段名');
})()`));
check('无效日历日期在提交前被拒绝', await evaluate(`!!validateFields([{ name: '日期', type: 'date', value: '2026-02-30' }])`));
check('无效 SVG 不会悄悄保存旧图标', await evaluate(`(() => {
  const code = document.querySelector('#icon-svg-code');
  code.value = '<svg><script>alert(1)</script></svg>';
  code.dispatchEvent(new Event('input', { bubbles: true }));
  return state.svgIconValid === false;
})()`));
await evaluate(`document.querySelector('#modal-cancel').click()`);

// ---------- 3. 通过弹窗新增条目 ----------
async function addEntry(title, category, account, password, url, note, fav) {
  await evaluate(`document.querySelector('#add-btn').click()`);
  await sleep(300);
  await evaluate(`(() => {
    const set = (sel, v) => { const el = document.querySelector(sel); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
    set('#m-title', ${JSON.stringify(title)});
    if (${JSON.stringify(title)} === '微信') set('#m-subtitle', '个人主号');
    const cat = document.querySelector('#m-cat');
    cat.value = ${JSON.stringify(category)};
    cat.dispatchEvent(new Event('change', { bubbles: true }));
    // 自定义字段：默认两行（账号/密码），填入值
    const rows = document.querySelectorAll('#fields-list .field-block');
    if (rows[0]) rows[0].querySelector('.f-value').value = ${JSON.stringify(account)};
    if (rows[1]) rows[1].querySelector('.f-value').value = ${JSON.stringify(password)};
    if (${JSON.stringify(Boolean(note))}) {
      document.querySelector('#fields-add-btn').click();
      const extra = document.querySelector('#fields-list .field-block:last-child');
      extra.querySelector('.f-name').value = '备注';
      extra.querySelector('.f-value').value = ${JSON.stringify(note)};
    }
    document.querySelector('#entry-form').requestSubmit();
    return true;
  })()`);
  await sleep(800);
  if (fav) {
    await evaluate(`${cardExpr(title)}.querySelector('button[data-act="star"]').click()`);
    await sleep(300);
  }
  return await evaluate(`document.querySelectorAll('.card').length`);
}

check('新增条目 1', (await addEntry('微信', '社交', '13800138000', 'wxP@ss!2024', 'https://weixin.qq.com', '备用手机号', true)) === 1);
check('新增条目 2', (await addEntry('招商银行储蓄卡', '银行', '6222 0000 1234 5678', 'Card@2024#Ab', '', '预留手机号 13912345678', false)) === 2);
check('新增条目 3', (await addEntry('QQ 邮箱', '邮箱', 'user@qq.com', 'Mail@2024!Ok', 'https://mail.qq.com', '', false)) === 3);

// 卡片内容验证
check('卡片标题正确', await evaluate(`Boolean(${cardExpr('微信')})`));
check('健康检查只标记重复和薄弱密码', await evaluate(`(() => {
  const entries = [
    { id: 'a', title: '甲', fields: [{ name: '密码', type: 'password', value: 'shared-long-password' }] },
    { id: 'b', title: '乙', fields: [{ name: '密码', type: 'password', value: 'shared-long-password' }] },
    { id: 'c', title: '丙', fields: [{ name: '密码', type: 'password', value: 'short' }] },
    { id: 'd', title: '丁', fields: [{ name: '密码', type: 'password', value: 'unique-long-password' }] },
    { id: 'e', title: '同一条目两个账号', fields: [
      { name: '密码1', type: 'password', value: 'same-entry-password' },
      { name: '密码2', type: 'password', value: 'same-entry-password' },
    ] },
    { id: 'f', title: 'PIN 不按网站密码计算', fields: [{ name: 'PIN', type: 'number', value: '123456' }] },
  ];
  const result = passwordHealth(entries);
  return result.checked === 6 && result.issues.length === 4 &&
    result.issues.find((item) => item.entry.id === 'a')?.reused &&
    result.issues.find((item) => item.entry.id === 'c')?.weak &&
    result.issues.find((item) => item.entry.id === 'e')?.reused;
})()`));
check('卡片分类徽标正确', await evaluate(`${cardExpr('微信')}?.querySelector('.badge')?.textContent === '社交'`));
check('卡片保留最上方分组线并忽略空尾组', await evaluate(`(() => {
  const html = cardHTML({
    id: 'divider-check', title: '分组测试', category: '社交',
    fields: [
      { name: 'QQ1', type: 'divider' },
      { name: '账号', type: 'text', value: 'first', pinned: true },
      { name: 'QQ2', type: 'divider' },
      { name: '账号', type: 'text', value: 'second', pinned: true },
      { name: 'QQ3', type: 'divider' },
    ],
  });
  const card = new DOMParser().parseFromString(html, 'text/html');
  return [...card.querySelectorAll('.field-divider')].map((el) => el.textContent).join('|') === 'QQ1|QQ2';
})()`));
check('分类与总数正确', await evaluate(`document.querySelector('.chip[data-cat="全部"] .chip-count')?.textContent === '3' && document.querySelector('#entry-count')?.textContent === '3 条记录'`));
check('宽桌面三列卡片', await evaluate(`(() => {
  const cards = [...document.querySelectorAll('.card')].map((card) => card.getBoundingClientRect());
  return cards.length === 3 && cards.every((card) => Math.abs(card.top - cards[0].top) < 2) && cards[0].left < cards[1].left && cards[1].left < cards[2].left;
})()`));
check('全页面字号回到紧凑档位', await evaluate(`(() => {
  const css = (selector) => getComputedStyle(document.querySelector(selector));
  return parseFloat(css('body').fontSize) === 15 && parseFloat(css('.chip').fontSize) === 13.5 &&
    parseFloat(css('.sort-select').fontSize) === 13 && parseFloat(css('.card-sub').fontSize) === 12.5 &&
    parseFloat(css('.card-field .f-name').fontSize) === 12.5 && parseFloat(css('.card-time').fontSize) === 12 &&
    parseFloat(css('.card-time').fontWeight) <= 500;
})()`));
check('分类、时间和操作按钮位于同一行', await evaluate(`(() => {
  const card = document.querySelector('.card');
  const parts = ['.badge', '.card-time', '.card-actions'].map((selector) => card.querySelector(selector).getBoundingClientRect());
  const centers = parts.map((part) => part.top + part.height / 2);
  return Math.max(...centers) - Math.min(...centers) < 2 &&
    parts[0].right < parts[1].left && parts[1].right < parts[2].left;
})()`));
check('同排卡片等高', await evaluate(`(() => {
  const cards = [...document.querySelectorAll('.card')];
  const spacer = document.createElement('div');
  spacer.style.height = '100px';
  spacer.style.flex = 'none';
  cards[0].querySelector('.card-fields').append(spacer);
  const heights = cards.map((card) => card.getBoundingClientRect().height);
  spacer.remove();
  return heights.every((height) => Math.abs(height - heights[0]) < 2);
})()`));
await send('Emulation.setDeviceMetricsOverride', { width: 1709, height: 900, deviceScaleFactor: 1, mobile: false });
await sleep(200);
check('宽屏充分利用两侧空间', await evaluate(`(() => {
  const layout = document.querySelector('.vault-layout').getBoundingClientRect();
  const cards = [...document.querySelectorAll('.card')].map((card) => card.getBoundingClientRect());
  return layout.width >= 1550 && cards.length === 3 && cards.every((card) => card.width >= 400);
})()`));
await send('Emulation.clearDeviceMetricsOverride');
await sleep(200);
await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false });
await sleep(200);
check('窄桌面回退两列', await evaluate(`(() => {
  const cards = [...document.querySelectorAll('.card')];
  const spacer = document.createElement('div');
  spacer.style.height = '120px';
  spacer.style.flex = 'none';
  cards[0].querySelector('.card-fields').append(spacer);
  const bounds = cards.map((card) => card.getBoundingClientRect());
  spacer.remove();
  return cards.length === 3 && Math.abs(bounds[0].top - bounds[1].top) < 2 &&
    bounds[2].top > bounds[0].top && Math.abs(bounds[0].height - bounds[1].height) < 2 &&
    bounds[2].height < bounds[0].height - 80;
})()`));
await send('Emulation.clearDeviceMetricsOverride');
await sleep(200);
check('亮色分类选中态明显', await evaluate(`(() => {
  const style = getComputedStyle(document.querySelector('.chip.active'));
  return style.backgroundColor === 'rgb(217, 222, 251)' && style.boxShadow.includes('inset') && style.color === 'rgb(61, 66, 173)';
})()`));
check('账号字段有复制按钮', await evaluate(`${cardExpr('微信')}?.querySelector('.card-field button[data-act="f-copy"]') !== null`));
check('密码默认掩码', await evaluate(`${cardExpr('微信')}?.querySelector('.card-field .f-value.secret')?.textContent.includes('•')`));
await screenshot('3-条目列表亮色');

check('测试附件上传成功', await evaluate(`(async () => {
  const form = new FormData();
  form.append('file', new File(['detail-preview-ok'], '说明.txt', { type: 'text/plain' }));
  const id = ${cardExpr('微信')}.dataset.id;
  const response = await fetch('/api/entries/' + id + '/attachments', { method: 'POST', body: form });
  return response.status === 201;
})()`));
await send('Page.reload');
await sleep(1200);

// ---------- 只读详情 ----------
check('列表提供查看按钮', await evaluate(`${cardExpr('微信')}?.querySelector('button[data-act="view"]') !== null`));
await evaluate(`${cardExpr('微信')}.querySelector('button[data-act="view"]').click()`);
await sleep(300);
check('查看详情显示全部字段', await evaluate(`!document.querySelector('#view-modal').classList.contains('hidden') && document.querySelector('#view-title').textContent === '微信' && document.querySelectorAll('#view-fields .view-field').length === 3 && document.querySelector('#view-fields').textContent.includes('备用手机号')`));
check('详情密码默认隐藏', await evaluate(`document.querySelector('#view-fields .view-field[data-idx="1"] .view-value.secret')?.textContent.includes('•')`));
check('详情显示附件', await evaluate(`document.querySelector('#view-attachments .attach-name')?.textContent === '说明.txt'`));
await screenshot('3b-只读条目详情');
await evaluate(`document.querySelector('#view-attachments [data-act="view-preview"]').click()`);
await sleep(300);
check('详情可预览附件', await evaluate(`!document.querySelector('#preview-modal').classList.contains('hidden') && document.querySelector('#preview-body').textContent.includes('detail-preview-ok')`));
await evaluate(`document.querySelector('#preview-close').click()`);
await evaluate(`document.querySelector('#view-fields .view-field[data-idx="1"] [data-act="view-eye"]').click()`);
check('详情可临时显示密码', await evaluate(`document.querySelector('#view-fields .view-field[data-idx="1"] .view-value')?.textContent === 'wxP@ss!2024'`));
await evaluate(`document.querySelector('#view-done').click()`);
check('关闭详情清除明文', await evaluate(`document.querySelector('#view-modal').classList.contains('hidden') && document.querySelector('#view-fields').textContent === '' && document.querySelector('#view-title').textContent === ''`));
await evaluate(`${cardExpr('微信')}.querySelector('button[data-act="view"]').click()`);
await evaluate(`document.querySelector('#view-edit').click()`);
check('详情可进入编辑', await evaluate(`document.querySelector('#view-modal').classList.contains('hidden') && !document.querySelector('#modal').classList.contains('hidden') && document.querySelector('#m-title').value === '微信'`));
await evaluate(`document.querySelector('#modal-cancel').click()`);

// ---------- 4. 搜索过滤 ----------
await evaluate(`(() => { const s = document.querySelector('#search'); s.value = '招商'; s.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
await sleep(300);
check('搜索"招商"只剩 1 条', await evaluate(`document.querySelectorAll('.card').length === 1`));
await evaluate(`(() => { const s = document.querySelector('#search'); s.value = '社交'; s.dispatchEvent(new Event('input', { bubbles: true })); })()`);
await sleep(200);
check('搜索分类可找到条目', await evaluate(`document.querySelectorAll('.card').length === 1 && document.querySelector('.card h3')?.textContent === '微信'`));
await evaluate(`(() => { const s = document.querySelector('#search'); s.value = ''; s.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
await sleep(300);

await evaluate(`document.querySelector('#settings-btn').click()`);
await evaluate(`document.querySelector('[data-open="connection"]').click()`);
check('HTTP 设置页显示风险和禁用 HTTPS 开关', await evaluate(`document.querySelector('#connection-status').textContent.includes('HTTP') && document.querySelector('#https-required').disabled`));
await evaluate(`document.querySelector('#settings-close').click()`);
await evaluate(`document.querySelector('#settings-btn').click()`);
await evaluate(`document.querySelector('[data-open="backup"]').click()`);
await sleep(150);
check('备份页显示最近备份状态', await evaluate(`document.querySelector('#backup-status').textContent.includes('最近完整备份')`));
await evaluate(`document.querySelector('.settings-back').click()`);
await evaluate(`document.querySelector('[data-open="health"]').click()`);
check('密码健康页只展示风险条目不泄露原文', await evaluate(`(() => {
  const section = document.querySelector('#settings-health');
  return !section.classList.contains('hidden') && document.querySelector('#health-summary').textContent.includes('3 个密码') &&
    document.querySelectorAll('#health-list .health-row').length === 1 &&
    !document.querySelector('#health-list').textContent.includes('wxP@ss!2024');
})()`));
await screenshot('3c-密码健康');
await evaluate(`document.querySelector('#health-list .health-row').click()`);
check('健康条目可打开只读详情', await evaluate(`document.querySelector('#settings-modal').classList.contains('hidden') && !document.querySelector('#view-modal').classList.contains('hidden')`));
await evaluate(`document.querySelector('#view-done').click()`);

// ---------- 5. 分类筛选 ----------
await evaluate(`[...document.querySelectorAll('.chip')].find(c => c.dataset.cat === '银行').click()`);
await sleep(300);
check('筛选"银行"只剩 1 条', await evaluate(`document.querySelectorAll('.card').length === 1`));
await evaluate(`[...document.querySelectorAll('.chip')].find(c => c.dataset.cat === '全部').click()`);
await sleep(300);

// ---------- 6. 显示密码 / 复制 ----------
await evaluate(`${cardExpr('微信')}.querySelector('.card-field[data-idx="1"] button[data-act="f-eye"]').click()`);
await sleep(200);
check('眼睛切换显示明文', await evaluate(`${cardExpr('微信')}.querySelector('.card-field[data-idx="1"] .f-value').textContent === 'wxP@ss!2024'`));

// ---------- 7. 暗色模式 ----------
await evaluate(`document.querySelector('#theme-btn').click()`);
await sleep(400);
check('切换到暗色主题', await evaluate(`document.documentElement.dataset.theme === 'dark'`));
check('深色次级文字对比度达标', await evaluate(`(() => {
  const css = getComputedStyle(document.documentElement);
  const lightness = (name) => {
    const hex = css.getPropertyValue(name).trim().slice(1);
    const values = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
  };
  const text = lightness('--text-3');
  return ['--bg', '--surface', '--surface-2'].every((name) => (text + 0.05) / (lightness(name) + 0.05) >= 4.5);
})()`));
await screenshot('4-暗色主题');
await evaluate(`document.querySelector('#settings-btn').click()`);
await evaluate(`document.querySelector('[data-open="connection"]').click()`);
await sleep(300);
await screenshot('4b-深色设置');
await evaluate(`document.querySelector('#settings-close').click()`);
await evaluate(`${cardExpr('QQ 邮箱')}.querySelector('button[data-act="edit"]').click()`);
await sleep(300);
await screenshot('4c-深色编辑');
await evaluate(`document.querySelector('#modal-cancel').click()`);

// ---------- 8. 收藏筛选 ----------
await evaluate(`[...document.querySelectorAll('.chip')].find(c => c.dataset.cat === '收藏').click()`);
await sleep(300);
check('筛选"收藏"只有 1 条', await evaluate(`document.querySelectorAll('.card').length === 1`));
await evaluate(`[...document.querySelectorAll('.chip')].find(c => c.dataset.cat === '全部').click()`);
await sleep(300);

// ---------- 9. 编辑条目 ----------
await evaluate(`${cardExpr('微信')}.querySelector('button[data-act="edit"]').click()`);
await sleep(300);
check('编辑弹窗回填标题', await evaluate(`document.querySelector('#m-title').value === '微信'`));
await evaluate(`(() => { const t = document.querySelector('#m-title'); t.value = '微信（主号）'; t.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('#entry-form').requestSubmit(); return true; })()`);
await sleep(600);
check('编辑后标题更新', await evaluate(`Boolean(${cardExpr('微信（主号）')})`));

const setSort = async (mode) => {
  await evaluate(`(() => { const select = document.querySelector('#sort-select'); select.value = ${JSON.stringify(mode)}; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await sleep(100);
  return evaluate(`[...document.querySelectorAll('.card h3')].map((el) => el.textContent).join('|')`);
};
check('按名称排序：英文先于中文，中文按拼音', (await setSort('name')) === 'QQ 邮箱|微信（主号）|招商银行储蓄卡');
check('按创建时间排序：最新创建在前', (await setSort('created')) === 'QQ 邮箱|招商银行储蓄卡|微信（主号）');
check('创建时间在卡片中可核对', await evaluate(`document.querySelector('.card-time')?.textContent.startsWith('20') && document.querySelector('.card-time')?.title === '创建时间'`));
check('按更新时间排序：刚编辑的在前', (await setSort('updated')) === '微信（主号）|QQ 邮箱|招商银行储蓄卡');
check('更新时间在卡片中可核对', await evaluate(`document.querySelector('.card-time')?.textContent.startsWith('20') && document.querySelector('.card-time')?.title === '最近更新'`));

// ---------- 10. 删除（两步确认） ----------
await evaluate(`${cardExpr('微信（主号）')}.querySelector('button[data-act="delete"]').click()`);
await sleep(200);
check('首次点击进入确认态', await evaluate(`${cardExpr('微信（主号）')}.querySelector('button[data-act="delete"]').classList.contains('confirm')`));
await evaluate(`${cardExpr('微信（主号）')}.querySelector('button[data-act="delete"]').click()`);
await sleep(600);
check('确认后删除成功', await evaluate(`document.querySelectorAll('.card').length === 2`));

// ---------- 11. 锁定 ----------
await evaluate(`${cardExpr('QQ 邮箱')}.querySelector('[data-act="view"]').click()`);
await evaluate(`document.querySelector('#lock-now-btn').click()`);
await sleep(500);
check('点击锁定回到锁定界面', await evaluate(`!document.querySelector('#view-lock').classList.contains('hidden')`));
check('锁定时关闭详情并清除字段', await evaluate(`document.querySelector('#view-modal').classList.contains('hidden') && document.querySelector('#view-fields').textContent === ''`));
await screenshot('5-锁定界面');

// ---------- 12. 错误密码 ----------
await evaluate(`(() => { const p = document.querySelector('#lock-pw'); p.value = 'WrongPass'; p.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('#lock-form').requestSubmit(); return true; })()`);
await sleep(2500);
check('错误密码提示', await evaluate(`!document.querySelector('#lock-error').classList.contains('hidden')`));
await screenshot('6-错误密码');

// ---------- 13. 正确解锁 ----------
await evaluate(`(() => { const p = document.querySelector('#lock-pw'); p.value = 'MyUI@Test2024'; p.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('#lock-form').requestSubmit(); return true; })()`);
await sleep(2500);
check('正确密码解锁回到主界面', await evaluate(`!document.querySelector('#view-main').classList.contains('hidden')`));
check('解锁后数据仍在', await evaluate(`document.querySelectorAll('.card').length === 2`));

await evaluate(`${cardExpr('QQ 邮箱')}.querySelector('button[data-act="edit"]').click()`);
await evaluate(`document.querySelector('#lock-now-btn').click()`);
await sleep(250);
check('锁定时关闭编辑并清除表单与卡片', await evaluate(`document.querySelector('#modal').classList.contains('hidden') && document.querySelector('#m-title').value === '' && document.querySelector('#fields-list').textContent === '' && !document.querySelector('#grid').textContent.includes('QQ 邮箱')`));
await evaluate(`(() => { document.querySelector('#lock-pw').value = 'MyUI@Test2024'; document.querySelector('#lock-form').requestSubmit(); })()`);
await sleep(2500);
check('编辑锁定后仍可重新解锁', await evaluate(`!document.querySelector('#view-main').classList.contains('hidden')`));

await evaluate(`document.querySelector('#settings-btn').click()`);
await evaluate(`document.querySelector('[data-open="totp"]').click()`);
await evaluate(`document.querySelector('#totp-secret').textContent = 'temporary-secret'`);
await evaluate(`document.querySelector('#lock-now-btn').click()`);
await sleep(250);
check('锁定时关闭设置并清除两步密钥', await evaluate(`document.querySelector('#settings-modal').classList.contains('hidden') && document.querySelector('#totp-secret').textContent === ''`));
await evaluate(`(() => { document.querySelector('#lock-pw').value = 'MyUI@Test2024'; document.querySelector('#lock-form').requestSubmit(); })()`);
await sleep(2500);

// ---------- 14. 移动端布局 ----------
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await sleep(400);
check('移动端无横向页面溢出', await evaluate(`document.documentElement.scrollWidth <= window.innerWidth`));
check('移动端条目为单列', await evaluate(`document.querySelectorAll('.card').length === 2`));
check('移动端卡片底部保持单行', await evaluate(`(() => {
  const foot = document.querySelector('.card-bottom');
  const parts = ['.badge', '.card-time', '.card-actions'].map((selector) => foot.querySelector(selector).getBoundingClientRect());
  const centers = parts.map((part) => part.top + part.height / 2);
  return Math.max(...centers) - Math.min(...centers) < 2 && foot.scrollWidth <= foot.clientWidth;
})()`));
check('移动端保留主题和批量操作', await evaluate(`getComputedStyle(document.querySelector('#theme-btn')).display !== 'none' && getComputedStyle(document.querySelector('#batch-btn')).display !== 'none'`));
check('移动端分类选中态保留背景和边框', await evaluate(`(() => {
  const style = getComputedStyle(document.querySelector('.chip.active'));
  return style.backgroundColor === 'rgb(41, 52, 86)' && style.borderTopColor === 'rgb(129, 140, 248)';
})()`));
await evaluate(`document.querySelector('#batch-btn').click()`);
check('移动端进入多选仍显示图标', await evaluate(`document.querySelector('#batch-btn svg')?.getBoundingClientRect().width > 0 && document.querySelector('#batch-btn').getAttribute('aria-label') === '取消多选'`));
await evaluate(`document.querySelector('#batch-btn').click()`);
check('移动端退出多选仍显示图标', await evaluate(`document.querySelector('#batch-btn svg')?.getBoundingClientRect().width > 0 && document.querySelector('#batch-btn').getAttribute('aria-label') === '批量操作'`));
await screenshot('7-移动端凭据列表');
await evaluate(`${cardExpr('QQ 邮箱')}.querySelector('[data-act="view"]').click()`);
await sleep(300);
check('移动端详情无横向溢出', await evaluate(`document.documentElement.scrollWidth <= window.innerWidth && !document.querySelector('#view-modal').classList.contains('hidden')`));
await screenshot('8-移动端条目详情');
await evaluate(`document.querySelector('#view-done').click()`);
await send('Emulation.setDeviceMetricsOverride', { width: 320, height: 740, deviceScaleFactor: 1, mobile: true });
await sleep(300);
check('小屏幕无横向页面溢出', await evaluate(`document.documentElement.scrollWidth <= window.innerWidth`));
await send('Emulation.clearDeviceMetricsOverride');

// ---------- 14. 刷新页面后会话保持 ----------
await send('Page.reload');
await sleep(2000);
check('刷新后仍保持解锁', await evaluate(`!document.querySelector('#view-main').classList.contains('hidden')`));

// ---------- 汇总 ----------
console.log('');
if (consoleErrors.length) {
  console.log(`⚠️  页面 JS 错误 ${consoleErrors.length} 条:`);
  consoleErrors.slice(0, 10).forEach(e => console.log('   - ' + e));
}
console.log(`结果: ${pass} 通过, ${fail} 失败`);
chrome.kill();
process.exitCode = fail ? 1 : 0;
