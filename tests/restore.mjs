// 导入导出完整验证（服务 A 建数据导出 → 全新服务 B 导入恢复）
// 分 3 步：create(建数据+导出) / restore(在全新服务器上导入) / verify(解锁校验)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHmac } from 'node:crypto';

const BASE = process.env.TEST_BASE || 'http://127.0.0.1:3782';
const EXPORT_FILE = process.env.EXPORT_FILE || 'E:/密码本/tests/backup-test.json';
const step = process.argv[2];

// 测试用 TOTP 生成器（模拟身份验证器 App）
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
const totpNow = (secret) => totpAt(secret, Math.floor(Date.now() / 30000));

async function req(path, opts = {}, cookie = '') {
  const r = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    ...opts,
  });
  const data = await r.json().catch(() => ({}));
  const sc = r.headers.getSetCookie ? r.headers.getSetCookie()[0] : r.headers.get('set-cookie');
  return { status: r.status, data, vsid: sc ? sc.split(';')[0] : null };
}
let pass = 0, fail = 0;
const check = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✅' : '  ❌'} ${n} ${x}`); };
let cookie = '';

if (step === 'create') {
  // 阶段1：服务 A 建库（分类+条目+TOTP+附件）并导出
  let r = await req('/api/setup', { method: 'POST', body: JSON.stringify({ password: 'Restore@2024' }) });
  cookie = r.vsid;
  await req('/api/categories', { method: 'POST', body: JSON.stringify({ name: '社交' }) }, cookie);
  await req('/api/categories', { method: 'POST', body: JSON.stringify({ name: '银行' }) }, cookie);
  r = await req('/api/entries', { method: 'POST', body: JSON.stringify({
    title: '微信', category: '社交', favorite: true,
    fields: [{ name: '账号', type: 'text', value: '13800138000', pinned: '1', copyable: '0' },
             { name: '密码', type: 'password', value: 'wx@2024!', pinned: '1' }],
  }) }, cookie);
  const entryId = r.data.entry.id;
  // 上传附件
  const attachContent = '附件内容-' + Date.now();
  const fd = new FormData();
  fd.append('file', new Blob([attachContent], { type: 'text/plain' }), '恢复测试.txt');
  await fetch(BASE + `/api/entries/${entryId}/attachments`, { method: 'POST', body: fd, headers: { Cookie: cookie } });
  writeFileSync(EXPORT_FILE + '.secret', JSON.stringify({ attachContent }), 'utf8');
  // 开启 TOTP（start + verify 两步）
  const tp = await req('/api/totp/start', { method: 'POST', body: '{}' }, cookie);
  const vv = await req('/api/totp/verify', { method: 'POST', body: JSON.stringify({ code: totpNow(tp.data.secret) }) }, cookie);
  console.log('(TOTP 已在服务 A 开启:', vv.status === 200, ')');
  const side = JSON.parse(readFileSync(EXPORT_FILE + '.secret', 'utf8'));
  writeFileSync(EXPORT_FILE + '.secret', JSON.stringify({ secret: tp.data.secret, attachContent: side.attachContent }), 'utf8');
  // 导出
  r = await req('/api/export', {}, cookie);
  writeFileSync(EXPORT_FILE, JSON.stringify(r.data, null, 2), 'utf8');
  console.log('✅ 已导出备份 →', EXPORT_FILE);
  console.log('   条目数:', r.data.entries.length, '| 分类数:', r.data.categories.length, '| 含 security:', !!r.data.security);
  console.log('   附件元数据:', (r.data.entries[0].attachments || []).length, '个');
} else if (step === 'restore') {
  // 阶段2：在全新服务 B（无库）上直接导入备份（无会话）
  const backup = JSON.parse(readFileSync(EXPORT_FILE, 'utf8'));
  const r = await req('/api/import', { method: 'POST', body: JSON.stringify(backup) }); // 不带 cookie！
  check('全新服务器可直接导入(200)', r.status === 200 && r.data.ok, String(r.status));
  check('附件全部还原(缺失数=0)', r.data.missingAttachments === 0, JSON.stringify(r.data.missingAttachments));
  const st = await req('/api/state');
  check('导入后 state.setup=true', st.data.setup === true);
  check('导入后 TOTP 状态保留', st.data.totpEnabled === true);
} else if (step === 'verify') {
  // 阶段3：用备份对应的主密码 + TOTP 解锁，校验数据（含附件下载）
  const { secret, attachContent } = JSON.parse(readFileSync(EXPORT_FILE + '.secret', 'utf8'));
  let r = await req('/api/unlock', { method: 'POST', body: JSON.stringify({ password: 'Restore@2024', totp: totpNow(secret) }) });
  check('用原主密码+验证码解锁', r.status === 200, String(r.status));
  cookie = r.vsid;
  r = await req('/api/entries', {}, cookie);
  const e = r.data.entries[0];
  check('条目恢复', e && e.title === '微信');
  check('自定义字段恢复', (e.fields || []).find(f => f.name === '账号')?.value === '13800138000');
  check('置顶/复制配置恢复', (e.fields || []).find(f => f.name === '账号')?.pinned === true
    && (e.fields || []).find(f => f.name === '账号')?.copyable === false);
  check('收藏状态恢复', e.favorite === true);
  const cats = await req('/api/categories', {}, cookie);
  check('分类恢复', JSON.stringify(cats.data.categories) === JSON.stringify(['社交', '银行']));
  check('附件元数据恢复', (e.attachments || []).length === 1);
  // 下载附件，验证内容一致（附件文件已随备份还原）
  const attId = (e.attachments || [])[0]?.id;
  if (attId) {
    const dr = await fetch(BASE + `/api/attachments/${attId}`, { headers: { Cookie: cookie } });
    const buf = Buffer.from(await dr.arrayBuffer());
    check('附件文件已还原且可下载', dr.status === 200 && buf.toString('utf8') === attachContent, String(dr.status));
  } else {
    check('附件文件已还原且可下载', false, '无附件');
  }
  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exitCode = fail ? 1 : 0;
}
