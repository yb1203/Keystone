// UI 端到端测试：用系统 Chrome(headless + CDP) 驱动界面，逐步截图
// 运行：node tests/ui-test.mjs
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';

const BASE = 'http://127.0.0.1:3777';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFILE = 'E:/密码本/.chrome-profile';
const SHOTS = 'E:/密码本/shots';

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

// ---------- 3. 通过弹窗新增条目 ----------
async function addEntry(title, category, account, password, url, note, fav) {
  await evaluate(`document.querySelector('#add-btn').click()`);
  await sleep(300);
  await evaluate(`(() => {
    const set = (sel, v) => { const el = document.querySelector(sel); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
    set('#m-title', ${JSON.stringify(title)});
    const cat = document.querySelector('#m-cat');
    cat.value = ${JSON.stringify(category)};
    cat.dispatchEvent(new Event('change', { bubbles: true }));
    // 自定义字段：默认两行（账号/密码），填入值
    const rows = document.querySelectorAll('#fields-list .field-block');
    if (rows[0]) rows[0].querySelector('.f-value').value = ${JSON.stringify(account)};
    if (rows[1]) rows[1].querySelector('.f-value').value = ${JSON.stringify(password)};
    document.querySelector('#entry-form').requestSubmit();
    return true;
  })()`);
  await sleep(800);
  return await evaluate(`document.querySelectorAll('.card').length`);
}

check('新增条目 1', (await addEntry('微信', '社交', '13800138000', 'wxP@ss!2024', 'https://weixin.qq.com', '备用手机号', true)) === 1);
check('新增条目 2', (await addEntry('招商银行储蓄卡', '银行', '6222 0000 1234 5678', 'Card@2024#Ab', '', '预留手机号 13912345678', false)) === 2);
check('新增条目 3', (await addEntry('QQ 邮箱', '邮箱', 'user@qq.com', 'Mail@2024!Ok', 'https://mail.qq.com', '', false)) === 3);

// 卡片内容验证
check('卡片标题正确', await evaluate(`document.querySelector('.card h3').textContent === '微信'`));
check('卡片分类徽标正确', await evaluate(`document.querySelector('.card .badge').textContent === '社交'`));
check('账号字段有复制按钮', await evaluate(`document.querySelectorAll('.card-field')[0].querySelector('button[data-act="f-copy"]') !== null`));
check('密码默认掩码', await evaluate(`document.querySelector('.card-field .f-value.secret').textContent.includes('•')`));
await screenshot('3-条目列表亮色');

// ---------- 4. 搜索过滤 ----------
await evaluate(`(() => { const s = document.querySelector('#search'); s.value = '招行'; s.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
await sleep(300);
check('搜索"招行"只剩 1 条', await evaluate(`document.querySelectorAll('.card').length === 1`));
await evaluate(`(() => { const s = document.querySelector('#search'); s.value = ''; s.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
await sleep(300);

// ---------- 5. 分类筛选 ----------
await evaluate(`[...document.querySelectorAll('.chip')].find(c => c.dataset.cat === '银行').click()`);
await sleep(300);
check('筛选"银行"只剩 1 条', await evaluate(`document.querySelectorAll('.card').length === 1`));
await evaluate(`[...document.querySelectorAll('.chip')].find(c => c.dataset.cat === '全部').click()`);
await sleep(300);

// ---------- 6. 显示密码 / 复制 ----------
await evaluate(`document.querySelector('.card-field[data-idx="1"] button[data-act="f-eye"]').click()`);
await sleep(200);
check('眼睛切换显示明文', await evaluate(`document.querySelector('.card-field[data-idx="1"] .f-value').textContent === 'wxP@ss!2024'`));

// ---------- 7. 暗色模式 ----------
await evaluate(`document.querySelector('#theme-btn').click()`);
await sleep(400);
check('切换到暗色主题', await evaluate(`document.documentElement.dataset.theme === 'dark'`));
await screenshot('4-暗色主题');

// ---------- 8. 收藏筛选 ----------
await evaluate(`[...document.querySelectorAll('.chip')].find(c => c.dataset.cat === '收藏').click()`);
await sleep(300);
check('筛选"收藏"只有 1 条', await evaluate(`document.querySelectorAll('.card').length === 1`));
await evaluate(`[...document.querySelectorAll('.chip')].find(c => c.dataset.cat === '全部').click()`);
await sleep(300);

// ---------- 9. 编辑条目 ----------
await evaluate(`document.querySelector('.card button[data-act="edit"]').click()`);
await sleep(300);
check('编辑弹窗回填标题', await evaluate(`document.querySelector('#m-title').value === '微信'`));
await evaluate(`(() => { const t = document.querySelector('#m-title'); t.value = '微信（主号）'; t.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('#entry-form').requestSubmit(); return true; })()`);
await sleep(600);
check('编辑后标题更新', await evaluate(`document.querySelector('.card h3').textContent === '微信（主号）'`));

// ---------- 10. 删除（两步确认） ----------
await evaluate(`document.querySelector('.card button[data-act="delete"]').click()`);
await sleep(200);
check('首次点击进入确认态', await evaluate(`document.querySelector('.card button[data-act="delete"]').classList.contains('confirm')`));
await evaluate(`document.querySelector('.card button[data-act="delete"]').click()`);
await sleep(600);
check('确认后删除成功', await evaluate(`document.querySelectorAll('.card').length === 2`));

// ---------- 11. 锁定 ----------
await evaluate(`document.querySelector('#lock-now-btn').click()`);
await sleep(500);
check('点击锁定回到锁定界面', await evaluate(`!document.querySelector('#view-lock').classList.contains('hidden')`));
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
