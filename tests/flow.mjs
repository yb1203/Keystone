// 端到端 API 测试（Node 24+，与浏览器同样的 fetch + UTF-8）
// 运行：node tests/flow.mjs
import { createHmac } from 'node:crypto';
const BASE = process.env.TEST_BASE || 'http://127.0.0.1:3777';
let pass = 0, fail = 0;

function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
}

async function req(path, opts = {}, cookie = '') {
  const r = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    ...opts,
  });
  const data = await r.json().catch(() => ({}));
  const setCookie = r.headers.getSetCookie ? r.headers.getSetCookie()[0] : r.headers.get('set-cookie');
  const vsid = setCookie ? setCookie.split(';')[0] : null;
  return { status: r.status, data, vsid };
}

// ---- 测试用 TOTP 生成器（模拟身份验证器 App，与服务器同算法） ----
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32decode(s) {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0; const out = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch); if (idx === -1) continue;
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}
function totpAt(secret, counter) {
  const key = b32decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', key).update(buf).digest();
  const off = hmac[hmac.length - 1] & 0x0f;
  const bin = ((hmac[off] & 0x7f) << 24) | (hmac[off + 1] << 16) | (hmac[off + 2] << 8) | hmac[off + 3];
  return String(bin % 1000000).padStart(6, '0');
}
const totpNow = (secret, offset = 0) => totpAt(secret, Math.floor(Date.now() / 30000) + offset);

let cookie = '';
console.log('— 初始化流程 —');let r = await req('/api/state');
check('初始未初始化', r.data.setup === false);

r = await req('/api/setup', { method: 'POST', body: JSON.stringify({ password: 'short' }) });
check('弱密码被拒绝(400)', r.status === 400);

r = await req('/api/setup', { method: 'POST', body: JSON.stringify({ password: 'MyTest@2024Pass' }) });
check('创建 Keystone', r.status === 200 && r.data.ok, r.status);
cookie = r.vsid;

r = await req('/api/setup', { method: 'POST', body: JSON.stringify({ password: 'x' }) });
check('重复初始化被拒绝(409)', r.status === 409);

console.log('— 中文数据往返（自定义字段 + 类型 + 置顶） —');
const fieldVal = (entry, name) => (entry.fields || []).find((f) => f.name === name)?.value ?? '';
const fieldType = (entry, name) => (entry.fields || []).find((f) => f.name === name)?.type ?? '';
const fieldPinned = (entry, name) => !!(entry.fields || []).find((f) => f.name === name)?.pinned;
const fieldCopyable = (entry, name) => (entry.fields || []).find((f) => f.name === name)?.copyable !== false;
const payload = {
  title: '微信',
  subtitle: '工作用主号',
  category: '社交',
  favorite: true,
  icon: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  fields: [
    { name: '账号', type: 'text', value: '13800138000', pinned: '1', copyable: '0' },
    { name: '密码', type: 'password', value: 'wxP@ss中文密码123', pinned: '1', copyable: '1' },
    { name: '网址', type: 'url', value: 'https://weixin.qq.com', pinned: '0' },
    { name: '备注', type: 'text', value: '备用手机号 138-0000-0000' },
    { name: '安全问题', type: 'text', value: '我的小学' },
    { name: '已开启两步验证', type: 'boolean', value: '是' },
    { name: '卡有效期', type: 'date', value: '2028-12-31' },
    { name: '注册邮箱', type: 'email', value: 'wx@example.com' },
  ],
};
r = await req('/api/entries', { method: 'POST', body: JSON.stringify(payload) }, cookie);
check('新增条目', r.status === 201 && r.data.entry, r.status);
const e1 = r.data.entry;
check('标题中文正确', e1.title === '微信', JSON.stringify(e1.title));
check('副标题正确', e1.subtitle === '工作用主号', JSON.stringify(e1.subtitle));
check('图标正确', (e1.icon || '').startsWith('data:image/png'), JSON.stringify((e1.icon || '').slice(0, 30)));
check('分类中文正确', e1.category === '社交', JSON.stringify(e1.category));
check('自定义字段数正确', (e1.fields || []).length === 8);
check('密码字段中文正确', fieldVal(e1, '密码') === 'wxP@ss中文密码123');
check('字段类型正确(password)', fieldType(e1, '密码') === 'password');
check('字段类型正确(url)', fieldType(e1, '网址') === 'url');
check('布尔类型正确', fieldVal(e1, '已开启两步验证') === '是' && fieldType(e1, '已开启两步验证') === 'boolean');
check('日期类型正确', fieldVal(e1, '卡有效期') === '2028-12-31' && fieldType(e1, '卡有效期') === 'date');
check('邮箱类型正确', fieldVal(e1, '注册邮箱') === 'wx@example.com' && fieldType(e1, '注册邮箱') === 'email');
check('自定义字段(安全问题)正确', fieldVal(e1, '安全问题') === '我的小学');
check('置顶标记正确', fieldPinned(e1, '账号') === true && fieldPinned(e1, '密码') === true && fieldPinned(e1, '网址') === false && fieldPinned(e1, '备注') === false);
check('复制开关正确', fieldCopyable(e1, '账号') === false && fieldCopyable(e1, '密码') === true && fieldCopyable(e1, '备注') === true);

const payload2 = { title: '招商银行储蓄卡', category: '银行', favorite: false, fields: [{ name: '卡号', type: 'number', value: '6222 0000 1234 5678' }, { name: '密码', type: 'password', value: 'Card@2024' }] };
r = await req('/api/entries', { method: 'POST', body: JSON.stringify(payload2) }, cookie);
const e2 = r.data.entry;
check('新增银行卡', r.status === 201 && e2.category === '银行');
check('卡号字段正确', fieldVal(e2, '卡号') === '6222 0000 1234 5678');
check('卡号类型为数字', fieldType(e2, '卡号') === 'number');

// 空字段名被过滤；未知类型回退为文本
r = await req('/api/entries', { method: 'POST', body: JSON.stringify({ title: '空字段名', category: '社交', fields: [{ name: '  ', value: 'x' }, { name: '有效', type: 'weird', value: 'y' }] }) }, cookie);
check('空字段名被过滤', r.status === 201 && r.data.entry.fields.length === 1 && fieldVal(r.data.entry, '有效') === 'y');
check('未知类型回退为文本', fieldType(r.data.entry, '有效') === 'text');

// 分割线：用于字段分组（如多个 QQ 号 + 密码）
r = await req('/api/entries', { method: 'POST', body: JSON.stringify({
  title: 'QQ 分组', category: '社交',
  fields: [
    { name: 'QQ1', type: 'text', value: '11111', pinned: '1' },
    { name: '密码1', type: 'password', value: 'p1', pinned: '1' },
    { name: '第一组', type: 'divider', value: '' },
    { name: 'QQ2', type: 'text', value: '22222', pinned: '1' },
    { name: '密码2', type: 'password', value: 'p2', pinned: '1' },
  ],
}) }, cookie);
check('分割线类型保存', r.status === 201 && r.data.entry.fields.length === 5);
const dividerIdx = r.data.entry.fields.findIndex((f) => f.type === 'divider');
check('分割线位置正确', dividerIdx === 2 && r.data.entry.fields[dividerIdx].name === '第一组');
check('分割线值被忽略', r.data.entry.fields[dividerIdx].value === '');

r = await req('/api/entries', {}, cookie);
check('列表 4 条', r.data.entries.length === 4);

console.log('— 字段类型值校验 —');
// 数字字段含字母 → 400
r = await req('/api/entries', { method: 'POST', body: JSON.stringify({ title: '坏数字', category: '社交', fields: [{ name: '卡号', type: 'number', value: 'abc123' }] }) }, cookie);
check('数字字段含字母被拒(400)', r.status === 400);
// 数字字段允许空格/连字符（卡号、手机号）
r = await req('/api/entries', { method: 'POST', body: JSON.stringify({ title: '好数字', category: '社交', fields: [{ name: '卡号', type: 'number', value: '6222 0000-1234' }] }) }, cookie);
check('数字字段允许空格连字符', r.status === 201);
// 邮箱非法 → 400
r = await req('/api/entries', { method: 'POST', body: JSON.stringify({ title: '坏邮箱', category: '社交', fields: [{ name: '邮箱', type: 'email', value: 'not-an-email' }] }) }, cookie);
check('非法邮箱被拒(400)', r.status === 400);
// 网址不带协议 → 400
r = await req('/api/entries', { method: 'POST', body: JSON.stringify({ title: '坏网址', category: '社交', fields: [{ name: '网址', type: 'url', value: 'www.example.com' }] }) }, cookie);
check('网址缺协议被拒(400)', r.status === 400);
// 布尔非法值 → 400
r = await req('/api/entries', { method: 'POST', body: JSON.stringify({ title: '坏布尔', category: '社交', fields: [{ name: '开关', type: 'boolean', value: 'maybe' }] }) }, cookie);
check('布尔非法值被拒(400)', r.status === 400);
// 非法日期（2月30日）→ 400
r = await req('/api/entries', { method: 'POST', body: JSON.stringify({ title: '坏日期', category: '社交', fields: [{ name: '有效期', type: 'date', value: '2028-02-30' }] }) }, cookie);
check('非法日期被拒(400)', r.status === 400);
// 空值允许
r = await req('/api/entries', { method: 'POST', body: JSON.stringify({ title: '空值字段', category: '社交', fields: [{ name: '邮箱', type: 'email', value: '' }] }) }, cookie);
check('空值字段允许', r.status === 201);

console.log('— 编辑 / 删除 —');
// 编辑时不传 favorite → 保留原收藏状态（弹窗已无收藏入口，星标在卡片上）
r = await req(`/api/entries/${e1.id}`, { method: 'PUT', body: JSON.stringify({ ...payload, title: '微信（主号）' }) }, cookie);
check('编辑成功', r.status === 200 && r.data.entry.title === '微信（主号）');
check('编辑后收藏状态保留', r.data.entry.favorite === true);
check('编辑后字段保留', fieldVal(r.data.entry, '安全问题') === '我的小学');
// 移除图标
r = await req(`/api/entries/${e1.id}`, { method: 'PUT', body: JSON.stringify({ ...payload, title: '微信（主号）', icon: '' }) }, cookie);
check('移除图标', r.status === 200 && (r.data.entry.icon || '') === '');

r = await req('/api/entries', { method: 'POST', body: JSON.stringify({ title: '', category: '其他' }) }, cookie);
check('空名称被拒绝(400)', r.status === 400);

r = await req('/api/entries', { method: 'POST', body: JSON.stringify({ title: '无分类', category: '' }) }, cookie);
check('空分类被拒绝(400)', r.status === 400);

r = await req(`/api/entries/${e2.id}`, { method: 'DELETE' }, cookie);
check('删除成功', r.status === 200 && r.data.ok);

console.log('— 分类管理（手动创建） —');
r = await req('/api/categories', {}, cookie);
check('分类列表含已用分类', r.data.categories.includes('社交') && r.data.categories.includes('银行'));

r = await req('/api/categories', { method: 'POST', body: JSON.stringify({ name: '游戏账号' }) }, cookie);
check('创建分类', r.status === 201 && r.data.categories.includes('游戏账号'));

r = await req('/api/categories', { method: 'POST', body: JSON.stringify({ name: '游戏账号' }) }, cookie);
check('重复分类被拒绝(400)', r.status === 400);

r = await req('/api/categories', { method: 'POST', body: JSON.stringify({ name: '全部' }) }, cookie);
check('保留名称「全部」被拒绝(400)', r.status === 400);

r = await req('/api/categories', { method: 'POST', body: JSON.stringify({ name: '' }) }, cookie);
check('空名称分类被拒绝(400)', r.status === 400);

// 用新分类创建条目 → 自动注册
r = await req('/api/entries', { method: 'POST', body: JSON.stringify({ title: 'Steam 账号', category: '游戏账号', fields: [{ name: '账号', value: 'steam@user.com' }, { name: '密码', value: 'Game@2024' }] }) }, cookie);
check('用新分类创建条目', r.status === 201 && r.data.entry.category === '游戏账号');

// 删除被使用的分类 → 拒绝
r = await req(`/api/categories/${encodeURIComponent('游戏账号')}`, { method: 'DELETE' }, cookie);
check('删除在用分类被拒绝(400)', r.status === 400);

// 删除未使用分类 → 成功
r = await req(`/api/categories/${encodeURIComponent('银行')}`, { method: 'DELETE' }, cookie);
check('删除未用分类成功', r.status === 200 && !r.data.categories.includes('银行'));

r = await req('/api/categories', {}, cookie);
check('分类列表最终状态', r.data.categories.length === 2 && !r.data.categories.includes('银行'), JSON.stringify(r.data.categories));

// 分类重命名：改「游戏账号」→「游戏」，条目自动同步
r = await req(`/api/categories/${encodeURIComponent('游戏账号')}`, { method: 'PUT', body: JSON.stringify({ name: '游戏' }) }, cookie);
check('分类重命名成功', r.status === 200 && r.data.categories.includes('游戏') && !r.data.categories.includes('游戏账号'));
r = await req('/api/entries', {}, cookie);
check('条目分类自动同步', r.data.entries.find((x) => x.title === 'Steam 账号').category === '游戏');
r = await req(`/api/categories/${encodeURIComponent('游戏')}`, { method: 'PUT', body: JSON.stringify({ name: '社交' }) }, cookie);
check('重命名为已存在分类被拒(400)', r.status === 400);
r = await req(`/api/categories/${encodeURIComponent('游戏')}`, { method: 'PUT', body: JSON.stringify({ name: '全部' }) }, cookie);
check('重命名为保留名被拒(400)', r.status === 400);
r = await req(`/api/categories/${encodeURIComponent('不存在的分类')}`, { method: 'PUT', body: JSON.stringify({ name: '新名' }) }, cookie);
check('重命名不存在分类(404)', r.status === 404);

console.log('— 锁定 / 解锁 / 限流 —');
r = await req('/api/unlock', { method: 'POST', body: JSON.stringify({ password: 'WrongPass1' }) });
check('错误密码 401', r.status === 401);

r = await req('/api/lock', { method: 'POST' }, cookie);
check('手动锁定', r.status === 200);

r = await req('/api/entries', {}, cookie);
check('锁定后访问 401', r.status === 401);

r = await req('/api/unlock', { method: 'POST', body: JSON.stringify({ password: 'MyTest@2024Pass' }) });
check('正确密码解锁', r.status === 200);
cookie = r.vsid;

console.log('— 导出 / 导入（含旧版格式兼容） —');
// 先给 e1 重新设置图标，验证导出/导入会携带图标
await req(`/api/entries/${e1.id}`, { method: 'PUT', body: JSON.stringify({ ...payload, title: '微信（主号）' }) }, cookie);
r = await req('/api/export', {}, cookie);
const exported = r.data;
check('导出包含 kdf 与条目', exported.kdf && Array.isArray(exported.entries) && exported.entries.length === 6);
check('导出为密文(不含明文)', !JSON.stringify(exported).includes('wxP@ss中文密码123'));
check('导出包含图标', (exported.entries.find((x) => x.id === e1.id).icon || '').startsWith('data:image'));

r = await req('/api/import', { method: 'POST', body: JSON.stringify(exported) }, cookie);
check('导入成功', r.status === 200 && r.data.ok);
check('导入响应含附件缺失数', typeof r.data.missingAttachments === 'number');
check('导入后需重新解锁(401)', (await req('/api/entries', {}, cookie)).status === 401);

// 重新解锁，为后续用例建立有效会话
r = await req('/api/unlock', { method: 'POST', body: JSON.stringify({ password: 'MyTest@2024Pass' }) });
cookie = r.vsid;
r = await req('/api/entries', {}, cookie);
check('导入后图标保留', (r.data.entries.find((x) => x.id === e1.id).icon || '').startsWith('data:image'));

// 旧版格式兼容：构造 fields 为对象的 legacy 条目（title/account/password 直接加密在对象里）
r = await req('/api/export', {}, cookie);
const src = r.data.entries.find((x) => x.id === e1.id); // 微信（主号）
const legacyEntry = {
  id: 'legacy-test-1',
  category: src.category,
  favorite: false,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  fields: { title: src.title, account: src.fields[0].v, password: src.fields[1].v },
};
const legacyVault = { ...r.data, entries: [...r.data.entries, legacyEntry] };
r = await req('/api/import', { method: 'POST', body: JSON.stringify(legacyVault) }, cookie);
check('导入旧版格式条目成功', r.status === 200 && r.data.ok);

r = await req('/api/unlock', { method: 'POST', body: JSON.stringify({ password: 'MyTest@2024Pass' }) });
cookie = r.vsid;
r = await req('/api/entries', {}, cookie);
const legacyOut = r.data.entries.find((x) => x.id === 'legacy-test-1');
check('旧版条目标题可读', !!legacyOut && legacyOut.title === '微信（主号）', JSON.stringify(legacyOut && legacyOut.title));
check('旧版条目字段可读', !!legacyOut && fieldVal(legacyOut, '账号') === '13800138000' && fieldVal(legacyOut, '密码') === 'wxP@ss中文密码123');
check('旧版字段类型自动推断', !!legacyOut && fieldType(legacyOut, '账号') === 'text' && fieldType(legacyOut, '密码') === 'password');
check('旧版字段未置顶', !!legacyOut && fieldPinned(legacyOut, '账号') === false);
check('旧版字段默认可复制', !!legacyOut && fieldCopyable(legacyOut, '账号') === true);

console.log('— 两步验证 TOTP —');
// 未开启时状态
r = await req('/api/state', {}, cookie);
check('初始未开启两步验证', r.data.totpEnabled === false);

// 开启：第一步生成密钥
r = await req('/api/totp/start', { method: 'POST', body: '{}' }, cookie);
check('生成 TOTP 密钥', r.status === 200 && r.data.secret.length === 32 && r.data.recoveryCodes.length === 8, r.status);
const totpSecret = r.data.secret;
const recoveryCodes = r.data.recoveryCodes;
check('otpauth URI 包含密钥', (r.data.otpauth || '').includes(totpSecret));

// 开启：第二步错误验证码
r = await req('/api/totp/verify', { method: 'POST', body: JSON.stringify({ code: '000000' }) }, cookie);
check('错误验证码被拒绝', r.status === 400);

// 开启：第二步正确验证码（用测试 TOTP 生成器算出当前有效码）
const validCode = totpNow(totpSecret);
check('测试 TOTP 生成器产码有效', /^\d{6}$/.test(validCode));
r = await req('/api/totp/verify', { method: 'POST', body: JSON.stringify({ code: validCode }) }, cookie);
check('验证码确认启用', r.status === 200 && r.data.ok);

r = await req('/api/state', {}, cookie);
check('state 显示已开启', r.data.totpEnabled === true);

// 重复开启被拒
r = await req('/api/totp/start', { method: 'POST', body: '{}' }, cookie);
check('重复开启被拒绝', r.status === 400);

// 锁定后：无验证码 / 错误验证码 / 正确验证码
await req('/api/lock', { method: 'POST' }, cookie);
r = await req('/api/unlock', { method: 'POST', body: JSON.stringify({ password: 'MyTest@2024Pass' }) });
check('缺验证码解锁被拒', r.status === 401 && r.data.error.includes('两步验证'));
r = await req('/api/unlock', { method: 'POST', body: JSON.stringify({ password: 'MyTest@2024Pass', totp: '000000' }) });
check('错误验证码解锁被拒', r.status === 401);
r = await req('/api/unlock', { method: 'POST', body: JSON.stringify({ password: 'MyTest@2024Pass', totp: totpNow(totpSecret) }) });
check('正确验证码解锁成功', r.status === 200);
cookie = r.vsid;

// 恢复码解锁（模拟丢失验证器）
await req('/api/lock', { method: 'POST' }, cookie);
r = await req('/api/unlock', { method: 'POST', body: JSON.stringify({ password: 'MyTest@2024Pass', totp: recoveryCodes[0] }) });
check('恢复码解锁成功', r.status === 200);
cookie = r.vsid;

await req('/api/lock', { method: 'POST' }, cookie);
r = await req('/api/unlock', { method: 'POST', body: JSON.stringify({ password: 'MyTest@2024Pass', totp: recoveryCodes[0] }) });
check('恢复码一次性使用后失效', r.status === 401);

// 主密码错误 + 验证码正确也应被拒
r = await req('/api/unlock', { method: 'POST', body: JSON.stringify({ password: 'WrongPass1', totp: totpNow(totpSecret) }) });
check('主密码错误仍被拒', r.status === 401 && r.data.error.includes('主密码'));

// 关闭：错误主密码被拒 / 正确主密码成功
r = await req('/api/unlock', { method: 'POST', body: JSON.stringify({ password: 'MyTest@2024Pass', totp: totpNow(totpSecret) }) });
cookie = r.vsid;
r = await req('/api/totp/disable', { method: 'POST', body: JSON.stringify({ password: 'Wrong' }) }, cookie);
check('错误主密码无法关闭', r.status === 400);
r = await req('/api/totp/disable', { method: 'POST', body: JSON.stringify({ password: 'MyTest@2024Pass' }) }, cookie);
check('正确主密码关闭成功', r.status === 200);

r = await req('/api/state', {}, cookie);
check('关闭后 state 未开启', r.data.totpEnabled === false);

// 关闭后仅主密码即可解锁
await req('/api/lock', { method: 'POST' }, cookie);
r = await req('/api/unlock', { method: 'POST', body: JSON.stringify({ password: 'MyTest@2024Pass' }) });
check('关闭后仅主密码解锁', r.status === 200);
cookie = r.vsid;

console.log('— 附件上传 / 下载 / 删除 —');
// 未解锁访问被拒
let rr = await fetch(BASE + '/api/attachments/whatever', { headers: { Cookie: 'vsid=bogus' } });
check('未解锁下载被拒(401)', rr.status === 401);

// 上传（multipart）
const attContent = '附件测试内容：身份证照片占位-' + Date.now();
const fd = new FormData();
fd.append('file', new Blob([attContent], { type: 'text/plain' }), '测试附件.txt');
rr = await fetch(BASE + `/api/entries/${e1.id}/attachments`, { method: 'POST', body: fd, headers: { Cookie: cookie } });
const dd = await rr.json().catch(() => ({}));
check('上传附件(中文名)', rr.status === 201 && !!dd.attachment, `${rr.status}`);
const att1 = dd.attachment;
check('附件名正确', att1 && att1.name === '测试附件.txt', JSON.stringify(att1 && att1.name));

// 条目元数据包含附件
rr = await req('/api/entries', {}, cookie);
const e1Now = rr.data.entries.find((x) => x.id === e1.id);
check('条目含附件元数据', (e1Now.attachments || []).length === 1);

// 下载往返
rr = await fetch(BASE + `/api/attachments/${att1.id}`, { headers: { Cookie: cookie } });
const downloaded = Buffer.from(await rr.arrayBuffer());
check('下载成功且内容一致', rr.status === 200 && downloaded.toString('utf8') === attContent);
check('下载为附件响应头', (rr.headers.get('content-disposition') || '').includes('attachment'));

// 磁盘密文检查（DATA_DIR 需指向服务数据目录）
if (process.env.DATA_DIR) {
  const { readFileSync } = await import('node:fs');
  const disk = readFileSync(`${process.env.DATA_DIR}/attachments/${att1.id}.bin`);
  check('磁盘附件为密文', !disk.includes(Buffer.from(attContent)) && disk.length > 10);
} else {
  console.log('  (跳过磁盘密文检查：未设置 DATA_DIR)');
}

// 第二个附件 + 删除
const fd2 = new FormData();
fd2.append('file', new Blob([Buffer.from('second-file')], { type: 'application/octet-stream' }), 'second.bin');
rr = await fetch(BASE + `/api/entries/${e1.id}/attachments`, { method: 'POST', body: fd2, headers: { Cookie: cookie } });
const att2 = (await rr.json()).attachment;
check('上传第二个附件', rr.status === 201 && !!att2);

rr = await fetch(BASE + `/api/attachments/${att2.id}`, { method: 'DELETE', headers: { Cookie: cookie } });
check('删除附件', rr.status === 200);
rr = await req('/api/entries', {}, cookie);
check('删除后元数据移除', (rr.data.entries.find((x) => x.id === e1.id).attachments || []).length === 1);

// 不存在的附件 404
rr = await fetch(BASE + '/api/attachments/nonexistent', { headers: { Cookie: cookie } });
check('不存在附件 404', rr.status === 404);

// 超过大小限制（21MB > 20MB 默认）
const big = new FormData();
big.append('file', new Blob([Buffer.alloc(21 * 1024 * 1024)]), 'big.bin');
rr = await fetch(BASE + `/api/entries/${e1.id}/attachments`, { method: 'POST', body: big, headers: { Cookie: cookie } });
check('超大文件被拒绝(400)', rr.status === 400);

console.log('— 待绑定附件（新增条目：先上传后绑定） —');
// 未解锁上传被拒
rr = await fetch(BASE + '/api/pending-attachments', { method: 'POST', body: new FormData(), headers: { Cookie: 'vsid=bogus' } });
check('未解锁上传待绑定附件被拒(401)', rr.status === 401);

// 先上传（此时还没有条目）
const pendContent = '待绑定附件内容-' + Date.now();
const pfd = new FormData();
pfd.append('file', new Blob([pendContent], { type: 'text/plain' }), '待绑定.txt');
rr = await fetch(BASE + '/api/pending-attachments', { method: 'POST', body: pfd, headers: { Cookie: cookie } });
const pendAtt = (await rr.json()).attachment;
check('先上传待绑定附件', rr.status === 201 && !!pendAtt, `${rr.status}`);

// 暂存附件可下载
rr = await fetch(BASE + `/api/attachments/${pendAtt.id}`, { headers: { Cookie: cookie } });
const pendDown = Buffer.from(await rr.arrayBuffer());
check('待绑定附件可下载', rr.status === 200 && pendDown.toString('utf8') === pendContent);

// 创建条目并绑定
rr = await req('/api/entries', { method: 'POST', body: JSON.stringify({ title: '带附件的新条目', category: '社交', account: 'x', attachIds: [pendAtt.id] }) }, cookie);
check('保存条目并绑定附件', rr.status === 201 && (rr.data.entry.attachments || []).length === 1);
check('绑定后条目附件名正确', rr.data.entry.attachments[0].name === '待绑定.txt');

// 绑定后暂存已消耗
rr = await fetch(BASE + `/api/pending-attachments/${pendAtt.id}`, { method: 'DELETE', headers: { Cookie: cookie } });
check('绑定后暂存附件已消耗(404)', rr.status === 404);

// 取消流程：上传后手动删除
const cfd = new FormData();
cfd.append('file', new Blob([Buffer.from('cancel')], { type: 'text/plain' }), 'cancel.txt');
rr = await fetch(BASE + '/api/pending-attachments', { method: 'POST', body: cfd, headers: { Cookie: cookie } });
const cancelAtt = (await rr.json()).attachment;
rr = await fetch(BASE + `/api/pending-attachments/${cancelAtt.id}`, { method: 'DELETE', headers: { Cookie: cookie } });
check('手动删除待绑定附件', rr.status === 200);
rr = await fetch(BASE + `/api/attachments/${cancelAtt.id}`, { headers: { Cookie: cookie } });
check('删除后不可下载(404)', rr.status === 404);

console.log('— 批量导出与设置 —');
// 自动锁定时长设置
r = await req('/api/settings', { method: 'POST', body: JSON.stringify({ autoLockMinutes: 15 }) }, cookie);
check('设置自动锁定成功', r.status === 200 && r.data.autoLockMinutes === 15);
r = await req('/api/settings', { method: 'POST', body: JSON.stringify({ autoLockMinutes: 999 }) }, cookie);
check('非法时长被拒(400)', r.status === 400);
r = await req('/api/settings', { method: 'POST', body: JSON.stringify({ autoLockMinutes: 0 }) }, cookie);
check('0 分钟被拒(400)', r.status === 400);
r = await req('/api/state', {}, cookie);
check('state 反映新时长', r.data.autoLockMinutes === 15);

// 批量导出所选条目
r = await req('/api/export-selected', { method: 'POST', body: JSON.stringify({ ids: [e1.id] }) }, cookie);
check('批量导出所选条目', r.status === 200 && r.data.entries.length === 1 && r.data.entries[0].id === e1.id);
check('批量导出含附件内嵌', !!r.data.attachments && Object.keys(r.data.attachments).length >= 1);
r = await req('/api/export-selected', { method: 'POST', body: JSON.stringify({ ids: [] }) }, cookie);
check('空选择被拒(400)', r.status === 400);
r = await req('/api/export-selected', { method: 'POST', body: JSON.stringify({ ids: ['nonexistent'] }) }, cookie);
check('无匹配条目被拒(400)', r.status === 400);

console.log('— 修改主密码（全量重加密） —');
// 旧密码错误被拒
r = await req('/api/password', { method: 'POST', body: JSON.stringify({ oldPassword: 'WrongOld1', newPassword: 'NewPass@2024!' }) }, cookie);
check('旧密码错误被拒(400)', r.status === 400);
// 修改成功
r = await req('/api/password', { method: 'POST', body: JSON.stringify({ oldPassword: 'MyTest@2024Pass', newPassword: 'NewPass@2024!' }) }, cookie);
check('修改主密码成功', r.status === 200 && r.data.ok);
// 当前会话无缝继续
r = await req('/api/entries', {}, cookie);
check('修改后当前会话仍可用', r.status === 200);
// 解锁：旧密码失败 / 新密码成功
await req('/api/lock', { method: 'POST' }, cookie);
r = await req('/api/unlock', { method: 'POST', body: JSON.stringify({ password: 'MyTest@2024Pass' }) });
check('旧主密码解锁失败(401)', r.status === 401);
r = await req('/api/unlock', { method: 'POST', body: JSON.stringify({ password: 'NewPass@2024!' }) });
check('新主密码解锁成功', r.status === 200);
cookie = r.vsid;
// 数据完整（字段 + 附件重加密后可下载）
r = await req('/api/entries', {}, cookie);
const e1AfterPw = r.data.entries.find((x) => x.id === e1.id);
check('改密后条目完整', !!e1AfterPw && fieldVal(e1AfterPw, '密码') === 'wxP@ss中文密码123');
check('改密后副标题保留', e1AfterPw.subtitle === '工作用主号');
const attAfterPw = (e1AfterPw.attachments || [])[0];
if (attAfterPw) {
  const dr = await fetch(BASE + `/api/attachments/${attAfterPw.id}`, { headers: { Cookie: cookie } });
  check('改密后附件仍可下载', dr.status === 200);
} else {
  check('改密后附件仍可下载', false, '无附件');
}

console.log('— 限流（放最后，避免封禁影响其他用例） —');
let blocked = false;
for (let i = 0; i < 7; i++) {
  const rr = await req('/api/unlock', { method: 'POST', body: JSON.stringify({ password: 'Wrong' }) });
  if (rr.status === 429) { blocked = true; break; }
}
check('连续错误触发限流 429', blocked);

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
// 用 exitCode 让进程自然退出（等 fetch 的空闲连接关闭），
// 避免 Windows 上 process.exit 时 Node 的 libuv 断言噪音导致退出码错误
process.exitCode = fail ? 1 : 0;
