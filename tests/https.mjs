import { mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DATA_DIR = await mkdtemp(join(tmpdir(), 'keystone-https-'));
const PORT = String(41000 + Math.floor(Math.random() * 1000));
const BASE = `http://127.0.0.1:${PORT}`;
const server = spawn(process.execPath, ['server/index.js'], {
  cwd: ROOT,
  env: { ...process.env, DATA_DIR, PORT, HOST: '127.0.0.1', VAULT_TRUST_PROXY: 'true' },
  stdio: 'ignore',
});

function expect(value, message) {
  if (!value) throw new Error(message);
}

async function request(path, { secure = false, cookie = '', method = 'GET', body } = {}) {
  return fetch(BASE + path, {
    method,
    headers: {
      ...(secure ? { 'X-Forwarded-Proto': 'https' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { if ((await request('/api/health')).ok) { ready = true; break; } } catch { /* 启动中 */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  expect(ready, '测试服务未启动');

  let response = await request('/api/state');
  expect((await response.json()).httpsRequired === false, '默认应允许 HTTP');

  response = await request('/api/setup', { method: 'POST', body: { password: 'HttpsTest@2026' } });
  expect(response.ok, '测试密码库初始化失败');
  const cookie = response.headers.get('set-cookie').split(';')[0];

  response = await request('/api/settings/https', { method: 'POST', cookie, body: { httpsRequired: true } });
  expect(response.status === 400, '不能从 HTTP 开启 HTTPS 限制');

  response = await request('/api/settings/https', { secure: true, method: 'POST', cookie, body: { httpsRequired: true } });
  expect(response.ok, 'HTTPS 下应可开启限制');

  response = await request('/api/state');
  expect(response.status === 403, '开启后 HTTP API 应被拒绝');
  response = await request('/');
  expect(response.status === 403, '开启后 HTTP 页面应被拒绝');

  response = await request('/api/state', { secure: true });
  const state = await response.json();
  expect(response.ok && state.httpsRequired && state.secureConnection, 'HTTPS 应继续正常访问');
  expect(response.headers.get('strict-transport-security')?.includes('max-age='), 'HTTPS 响应缺少 HSTS');

  response = await request('/api/unlock', { secure: true, method: 'POST', body: { password: 'HttpsTest@2026' } });
  expect(response.ok && response.headers.get('set-cookie')?.includes('Secure'), 'HTTPS 解锁 Cookie 应带 Secure');

  response = await request('/api/settings/https', { secure: true, method: 'POST', cookie, body: { httpsRequired: false } });
  expect(response.ok, 'HTTPS 下应可关闭限制');
  expect(response.headers.get('strict-transport-security') === 'max-age=0', '关闭时应清除浏览器 HSTS');
  response = await request('/api/state');
  expect(response.ok, '关闭后 HTTP 应恢复访问');
  console.log('HTTPS 配置: ✓');
} finally {
  if (server.exitCode === null) {
    await new Promise((resolve) => { server.once('exit', resolve); server.kill('SIGTERM'); });
  }
  await rm(DATA_DIR, { recursive: true, force: true });
}
