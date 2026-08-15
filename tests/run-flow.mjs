// 自包含 API 流程测试：临时启动独立服务与数据目录，不触碰本地密码库。
import { mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DATA_DIR = await mkdtemp(join(tmpdir(), 'keystone-flow-'));
const PORT = String(39000 + Math.floor(Math.random() * 1000));
const BASE = `http://127.0.0.1:${PORT}`;
let server;
let output = '';

function waitForExit(child) {
  return new Promise((resolve) => child.once('exit', resolve));
}

async function waitForHealth() {
  for (let i = 0; i < 100; i++) {
    try {
      const response = await fetch(`${BASE}/api/health`);
      if (response.ok) return;
    } catch { /* 服务仍在启动 */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`测试服务未能启动：${output}`);
}

try {
  server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, DATA_DIR, PORT, HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (chunk) => { output += chunk; });
  server.stderr.on('data', (chunk) => { output += chunk; });
  await waitForHealth();

  const test = spawn(process.execPath, ['tests/flow.mjs'], {
    cwd: ROOT,
    env: { ...process.env, DATA_DIR, TEST_BASE: BASE },
    stdio: 'inherit',
  });
  const code = await new Promise((resolve) => test.once('exit', resolve));
  process.exitCode = code || 0;
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  if (server && !server.killed) {
    server.kill('SIGTERM');
    await waitForExit(server);
  }
  await rm(DATA_DIR, { recursive: true, force: true });
}
