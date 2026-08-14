// 运行时体检：用最小 DOM 桩加载 app.js，捕获初始化阶段的第一处真实报错
import { readFileSync } from 'node:fs';

const el = () => ({
  classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } },
  addEventListener(){}, removeEventListener(){},
  set innerHTML(v){}, get innerHTML(){ return ''; },
  set textContent(v){}, get textContent(){ return ''; },
  value: '', checked: false, type: 'text', disabled: false, dataset: {}, style: {},
  querySelector(){ return el(); }, querySelectorAll(){ return []; },
  closest(){ return null; }, focus(){}, select(){}, click(){},
  scrollIntoView(){}, appendChild(){}, remove(){},
});

global.document = {
  querySelector(){ return el(); },
  querySelectorAll(){ return []; },
  documentElement: { dataset: {} },
  body: { classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } } },
  addEventListener(){},
};
global.window = { addEventListener(){} };
global.localStorage = { getItem(){ return null; }, setItem(){} };
global.matchMedia = () => ({ matches: false, addEventListener(){} });
global.FormData = class {};
global.URL = { createObjectURL(){ return 'blob:x'; }, revokeObjectURL(){} };
global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ setup: false, unlocked: false, autoLockMinutes: 30, totpEnabled: false, entries: [], categories: [] }), text: async () => '', blob: async () => new Blob(), arrayBuffer: async () => new ArrayBuffer(0), headers: { get: () => null }, getSetCookie: () => [] });

process.on('unhandledRejection', (err) => {
  console.log('!!! 初始化异常:', err && err.stack ? err.stack.split('\n').slice(0, 4).join('\n') : err);
  process.exit(1);
});

try {
  // 模拟 <script src="app.js"> 直接执行
  eval(readFileSync('E:/密码本/public/app.js', 'utf8'));
  setTimeout(() => { console.log('app.js 加载与初始化无异常'); process.exit(0); }, 500);
} catch (e) {
  console.log('!!! 加载异常:', e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : e.message);
  process.exit(1);
}
