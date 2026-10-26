import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm, readFile, writeFile, cp, rename, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DATA_DIR = await mkdtemp(join(tmpdir(), 'keystone-import-'));
const PORT = String(43000 + Math.floor(Math.random() * 1000));
const BASE = `http://127.0.0.1:${PORT}`;
const VAULT = join(DATA_DIR, 'vault.json');
const ATTACH = join(DATA_DIR, 'attachments');
const JOURNAL = join(DATA_DIR, '.import-journal.json');
const PASSWORD = 'ImportRecoveryPass2026';
let server;

const digest = (data) => createHash('sha256').update(JSON.stringify(data)).digest('hex');
const expect = (condition, message) => { if (!condition) throw new Error(message); };

async function start() {
  server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT, env: { ...process.env, DATA_DIR, PORT, HOST: '127.0.0.1' }, stdio: 'ignore',
  });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(BASE + '/api/health')).ok) return; } catch { /* 启动中 */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('导入恢复测试服务未启动');
}

async function stop() {
  if (server?.exitCode === null) {
    await new Promise((resolve) => { server.once('exit', resolve); server.kill('SIGTERM'); });
  }
}

async function json(path, method = 'GET', body, cookie = '') {
  const response = await fetch(BASE + path, {
    method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { response, data: await response.json().catch(() => ({})) };
}

async function upload(entryId, content, cookie) {
  const form = new FormData();
  form.append('file', new Blob([content]), `${content}.txt`);
  const response = await fetch(`${BASE}/api/entries/${entryId}/attachments`, {
    method: 'POST', headers: { Cookie: cookie }, body: form,
  });
  expect(response.ok, '创建测试附件失败');
  return (await response.json()).attachment.id;
}

async function unlock() {
  const { response } = await json('/api/unlock', 'POST', { password: PASSWORD });
  expect(response.ok, '导入恢复后无法解锁');
  return response.headers.get('set-cookie').split(';')[0];
}

async function expectAttachment(id, cookie, content, status = 200) {
  const response = await fetch(`${BASE}/api/attachments/${id}`, { headers: { Cookie: cookie } });
  expect(response.status === status, `附件 ${id} 状态错误：${response.status}`);
  if (status === 200) expect(await response.text() === content, '附件内容不正确');
}

try {
  await start();
  const setup = await json('/api/setup', 'POST', { password: PASSWORD });
  expect(setup.response.ok, '创建测试密码库失败');
  let cookie = setup.response.headers.get('set-cookie').split(';')[0];
  const created = await json('/api/entries', 'POST', { title: '导入恢复', category: '测试', fields: [] }, cookie);
  expect(created.response.ok, '创建测试条目失败');
  const entryId = created.data.entry.id;
  const firstId = await upload(entryId, 'first-attachment', cookie);
  const oldData = JSON.parse(await readFile(VAULT, 'utf8'));
  const oldSnap = join(DATA_DIR, 'snapshot-old');
  await cp(ATTACH, oldSnap, { recursive: true });

  const secondId = await upload(entryId, 'second-attachment', cookie);
  const newData = JSON.parse(await readFile(VAULT, 'utf8'));
  const newSnap = join(DATA_DIR, 'snapshot-new');
  await cp(ATTACH, newSnap, { recursive: true });
  await stop();

  const journal = (tx) => ({ tx, oldDigest: digest(oldData), newDigest: digest(newData) });
  const rollbackTx = randomUUID();
  await writeFile(VAULT, JSON.stringify(oldData));
  await rm(ATTACH, { recursive: true });
  await cp(oldSnap, ATTACH, { recursive: true });
  await cp(newSnap, `${ATTACH}.import-${rollbackTx}.next`, { recursive: true });
  await rename(ATTACH, `${ATTACH}.import-${rollbackTx}.old`);
  await rename(`${ATTACH}.import-${rollbackTx}.next`, ATTACH);
  await writeFile(JOURNAL, JSON.stringify(journal(rollbackTx)));
  await start();
  cookie = await unlock();
  await expectAttachment(firstId, cookie, 'first-attachment');
  await expectAttachment(secondId, cookie, '', 404);
  await access(JOURNAL).then(() => { throw new Error('回滚后记录未清理'); }, () => {});
  await stop();

  const commitTx = randomUUID();
  await writeFile(VAULT, JSON.stringify(newData));
  await rm(ATTACH, { recursive: true });
  await cp(newSnap, ATTACH, { recursive: true });
  await cp(oldSnap, `${ATTACH}.import-${commitTx}.old`, { recursive: true });
  await writeFile(JOURNAL, JSON.stringify(journal(commitTx)));
  await start();
  cookie = await unlock();
  await expectAttachment(firstId, cookie, 'first-attachment');
  await expectAttachment(secondId, cookie, 'second-attachment');
  await access(JOURNAL).then(() => { throw new Error('提交后记录未清理'); }, () => {});
  console.log('备份导入中断恢复: ✓');
} finally {
  await stop();
  await rm(DATA_DIR, { recursive: true, force: true });
}
