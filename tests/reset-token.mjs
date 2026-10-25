// 验证 Compose 重置令牌：首次使用清空数据，相同令牌重启不会再次清空。
import { mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DATA_DIR = await mkdtemp(join(tmpdir(), 'keystone-reset-'));
let server;

function start(token = '') {
  const port = String(40000 + Math.floor(Math.random() * 1000));
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, DATA_DIR, PORT: port, HOST: '127.0.0.1', VAULT_RESET_TOKEN: token },
    stdio: 'ignore',
  });
  return { child, base: `http://127.0.0.1:${port}` };
}

async function waitForHealth(base) {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return;
    } catch { /* 服务仍在启动 */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('测试服务未能启动');
}

async function stop(child) {
  if (child.exitCode !== null) return;
  await new Promise((resolve) => {
    child.once('exit', resolve);
    child.kill('SIGTERM');
  });
}

async function state(base) {
  return (await fetch(`${base}/api/state`)).json();
}

try {
  let running = start();
  server = running.child;
  await waitForHealth(running.base);
  const setup = await fetch(`${running.base}/api/setup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'ResetTest@2026' }),
  });
  if (!setup.ok) throw new Error('创建测试密码库失败');
  await stop(server);

  running = start('reset-once');
  server = running.child;
  await waitForHealth(running.base);
  if ((await state(running.base)).setup) throw new Error('首次重置令牌未清空密码库');
  await stop(server);

  running = start('reset-once');
  server = running.child;
  await waitForHealth(running.base);
  const secondSetup = await fetch(`${running.base}/api/setup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'SecondReset@2026' }),
  });
  if (!secondSetup.ok || !(await state(running.base)).setup) throw new Error('相同令牌重启时意外再次重置');
  console.log('重置令牌: ✓');
} finally {
  if (server) await stop(server);
  await rm(DATA_DIR, { recursive: true, force: true });
}
