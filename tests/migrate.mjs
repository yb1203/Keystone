// 旧数据迁移测试：模拟旧版本 vault.json（无 categories 字段），验证自动回填
// 用法：先启动一个干净服务（PORT/DATA_DIR 指向 data-mig2），再运行本脚本前两部分，
//       重启服务后运行第三部分。
// 简化版：脚本自己分阶段做。这里只做文件操作与请求（服务进程由外部管理）。
import { readFileSync, writeFileSync } from 'node:fs';

const BASE = process.env.TEST_BASE || 'http://127.0.0.1:3778';
const FILE = 'E:/密码本/data-mig2/vault.json';
const step = process.argv[2];

async function req(path, opts = {}, cookie = '') {
  const r = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    ...opts,
  });
  const data = await r.json().catch(() => ({}));
  const sc = r.headers.getSetCookie ? r.headers.getSetCookie()[0] : r.headers.get('set-cookie');
  return { status: r.status, data, vsid: sc ? sc.split(';')[0] : null };
}

let cookie = '';
if (step === 'create') {
  // 阶段1：创建旧数据（带分类的条目）
  let r = await req('/api/setup', { method: 'POST', body: JSON.stringify({ password: 'MigTest@2024' }) });
  cookie = r.vsid;
  await req('/api/entries', { method: 'POST', body: JSON.stringify({ title: '微信', category: '社交', account: 'a@weixin' }) }, cookie);
  await req('/api/entries', { method: 'POST', body: JSON.stringify({ title: '招行卡', category: '银行', account: '6222...' }) }, cookie);
  console.log('创建完成，categories =', JSON.stringify((await req('/api/categories', {}, cookie)).data.categories));
} else if (step === 'strip') {
  // 阶段2：从文件中去掉 categories 字段（模拟旧版本格式）
  const data = JSON.parse(readFileSync(FILE, 'utf8'));
  delete data.categories;
  writeFileSync(FILE, JSON.stringify(data, null, 2) + '\n', 'utf8');
  const check = JSON.parse(readFileSync(FILE, 'utf8'));
  console.log('已移除 categories 字段:', !('categories' in check), '| 条目数:', check.entries.length);
} else if (step === 'verify') {
  // 阶段3：重启服务后验证回填
  let r = await req('/api/unlock', { method: 'POST', body: JSON.stringify({ password: 'MigTest@2024' }) });
  cookie = r.vsid;
  const cats = (await req('/api/categories', {}, cookie)).data.categories;
  const entries = (await req('/api/entries', {}, cookie)).data.entries;
  console.log('回填分类:', JSON.stringify(cats));
  console.log('条目数:', entries.length, '| 分类:', entries.map(e => e.category).join(','));
  const ok = JSON.stringify(cats) === JSON.stringify(['社交', '银行']) && entries.length === 2;
  console.log(ok ? '✅ 迁移验证通过' : '❌ 迁移验证失败');
  process.exitCode = ok ? 0 : 1;
}
