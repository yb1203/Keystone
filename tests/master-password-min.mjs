import { mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DATA_DIR = await mkdtemp(join(tmpdir(), 'keystone-master-min-'));
const PORT = String(44000 + Math.floor(Math.random() * 1000));
const BASE = `http://127.0.0.1:${PORT}`;
const server = spawn(process.execPath, ['server/index.js'], {
  cwd: ROOT,
  env: { ...process.env, DATA_DIR, PORT, HOST: '127.0.0.1', VAULT_RESET_TOKEN: '' },
  stdio: 'ignore',
});

async function post(path, body, cookie = '') {
  const response = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
  return response;
}

try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(BASE + '/api/health')).ok) { ready = true; break; } } catch { /* 启动中 */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error('主密码下限测试服务未启动');

  let response = await post('/api/setup', { password: 'Abc1234' });
  if (response.status !== 400) throw new Error('7 位主密码应被拒绝');
  response = await post('/api/setup', { password: 'Abc12345' });
  if (!response.ok) throw new Error('8 位主密码应允许初始化');
  let cookie = response.headers.get('set-cookie').split(';')[0];

  response = await post('/api/password', { oldPassword: 'Abc12345', newPassword: 'Def6789' }, cookie);
  if (response.status !== 400) throw new Error('7 位新主密码应被拒绝');
  response = await post('/api/password', { oldPassword: 'Abc12345', newPassword: 'Def67890' }, cookie);
  if (!response.ok) throw new Error('8 位新主密码应允许修改');
  response = await post('/api/unlock', { password: 'Def67890' });
  if (!response.ok) throw new Error('8 位新主密码应正常解锁');
  console.log('主密码最少 8 位: ✓');
} finally {
  if (server.exitCode === null) {
    await new Promise((resolve) => { server.once('exit', resolve); server.kill('SIGTERM'); });
  }
  await rm(DATA_DIR, { recursive: true, force: true });
}
