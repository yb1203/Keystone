// 体检：app.js 引用的 #id 是否都在 index.html 中存在；HTML 是否有重复 id；标签是否闭合
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const html = readFileSync(join(ROOT, 'public', 'index.html'), 'utf8');
const js = readFileSync(join(ROOT, 'public', 'app.js'), 'utf8');

// 1. HTML 重复 id
const ids = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
console.log('HTML 重复 id:', dup.length ? [...new Set(dup)].join(', ') : '无');

// 2. app.js 引用的 #id
const refs = [...js.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g)].map((m) => m[1]);
const uniqueRefs = [...new Set(refs)];
const missing = uniqueRefs.filter((r) => !ids.includes(r));
console.log('JS 引用但 HTML 缺失的 id:', missing.length ? missing.join(', ') : '无');
console.log('共引用', uniqueRefs.length, '个 id, HTML 共', ids.length, '个 id');

// 3. 设置弹窗关键元素
for (const k of ['settings-btn', 'settings-menu', 'settings-cats', 'settings-password', 'settings-totp', 'settings-close', 'totp-actions', 'cat-chips']) {
  console.log(`  ${k}: ${ids.includes(k) ? '✓' : '✗ 缺失!'}`);
}

// 4. 标签闭合粗检（div 开闭）
const openD = (html.match(/<div\b/g) || []).length;
const closeD = (html.match(/<\/div>/g) || []).length;
console.log(`div 开/闭: ${openD}/${closeD} ${openD === closeD ? '✓' : '✗ 不平衡!'}`);
const openS = (html.match(/<section\b/g) || []).length;
const closeS = (html.match(/<\/section>/g) || []).length;
console.log(`section 开/闭: ${openS}/${closeS} ${openS === closeS ? '✓' : '✗'}`);
const openF = (html.match(/<form\b/g) || []).length;
const closeF = (html.match(/<\/form>/g) || []).length;
console.log(`form 开/闭: ${openF}/${closeF} ${openF === closeF ? '✓' : '✗'}`);
