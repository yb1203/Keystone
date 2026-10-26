import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm, readFile, writeFile, rename, copyFile, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DATA_DIR = await mkdtemp(join(tmpdir(), 'keystone-rekey-'));
const PORT = String(42000 + Math.floor(Math.random() * 1000));
const BASE = `http://127.0.0.1:${PORT}`;
const JOURNAL = join(DATA_DIR, '.rekey-journal.json');
let server;

const digest = (buf) => createHash('sha256').update(buf).digest('hex');
const expect = (value, message) => { if (!value) throw new Error(message); };

async function start() {
  server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT, env: { ...process.env, DATA_DIR, PORT, HOST: '127.0.0.1' }, stdio: 'ignore',
  });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(BASE + '/api/health')).ok) return; } catch { /* 启动中 */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('测试服务未启动');
}

async function stop() {
  if (!server || server.exitCode !== null) return;
  await new Promise((resolve) => { server.once('exit', resolve); server.kill('SIGTERM'); });
}

async function json(path, method, body, cookie) {
  const response = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
  return { response, data: await response.json().catch(() => ({})) };
}

async function unlock(password) {
  const { response } = await json('/api/unlock', 'POST', { password });
  expect(response.ok, '恢复后无法解锁');
  return response.headers.get('set-cookie').split(';')[0];
}

async function download(id, cookie) {
  const response = await fetch(BASE + `/api/attachments/${id}`, { headers: { Cookie: cookie } });
  expect(response.ok && await response.text() === 'rekey-attachment', '恢复后附件无法下载');
}

try {
  await start();
  let result = await json('/api/setup', 'POST', { password: 'OldPass@2026' });
  expect(result.response.ok, '创建密码库失败');
  let cookie = result.response.headers.get('set-cookie').split(';')[0];
  result = await json('/api/entries', 'POST', { title: 'Recovery', category: 'Test', fields: [] }, cookie);
  expect(result.response.ok, '创建条目失败');
  const entryId = result.data.entry.id;
  const form = new FormData();
  form.append('file', new Blob(['rekey-attachment']), 'test.txt');
  const upload = await fetch(BASE + `/api/entries/${entryId}/attachments`, { method: 'POST', headers: { Cookie: cookie }, body: form });
  expect(upload.ok, '附件上传失败');
  const id = (await upload.json()).attachment.id;
  const file = join(DATA_DIR, 'attachments', `${id}.bin`);
  const before = JSON.parse(await readFile(join(DATA_DIR, 'vault.json'), 'utf8'));
  const oldBlob = await readFile(file);
  await stop();

  const tx1 = `.rekey-${randomUUID()}`;
  const fakeNew = Buffer.from('new-encrypted-blob');
  await writeFile(file + tx1 + '.next', fakeNew);
  await rename(file, file + tx1 + '.old');
  await writeFile(JOURNAL, JSON.stringify({
    tx: tx1, ids: [id], oldSalt: before.kdf.salt, newSalt: 'new-salt-not-committed',
    oldDigests: { [id]: digest(oldBlob) }, newDigests: { [id]: digest(fakeNew) },
  }));
  await start();
  cookie = await unlock('OldPass@2026');
  await download(id, cookie);
  await access(JOURNAL).then(() => { throw new Error('旧版本恢复后日志未清除'); }, () => {});

  result = await json('/api/password', 'POST', { oldPassword: 'OldPass@2026', newPassword: 'NewPass@2026' }, cookie);
  expect(result.response.ok, '正常修改主密码失败');
  const after = JSON.parse(await readFile(join(DATA_DIR, 'vault.json'), 'utf8'));
  const newBlob = await readFile(file);
  await stop();

  const tx2 = `.rekey-${randomUUID()}`;
  await copyFile(file, file + tx2 + '.next');
  await writeFile(file + tx2 + '.old', oldBlob);
  await writeFile(JOURNAL, JSON.stringify({
    tx: tx2, ids: [id], oldSalt: before.kdf.salt, newSalt: after.kdf.salt,
    oldDigests: { [id]: digest(oldBlob) }, newDigests: { [id]: digest(newBlob) },
  }));
  await start();
  cookie = await unlock('NewPass@2026');
  await download(id, cookie);
  await access(JOURNAL).then(() => { throw new Error('新版本恢复后日志未清除'); }, () => {});
  console.log('主密码修改中断恢复: ✓');
} finally {
  await stop();
  await rm(DATA_DIR, { recursive: true, force: true });
}
