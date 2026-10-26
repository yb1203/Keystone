'use strict';
/**
 * Keystone - 后端服务
 *
 * 服务端加密架构：
 *  - 首次访问创建主密码，服务端只保存 scrypt 盐和加密验证令牌
 *  - 解锁时用主密码派生密钥，密钥仅保存在服务器内存（按会话），重启即丢失 → 回到锁定态
 *  - 条目内容和附件以 AES-256-GCM 加密落盘；分类和时间等元数据仍为明文
 *  - 解锁接口限流，防止暴力破解
 */
const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const express = require('express');
const multer = require('multer');

const { encrypt, decrypt, deriveKey, createVault, unlockVault } = require('./crypto');
const { VaultStore } = require('./store');
const {
  generateSecret, verifyTotp, generateRecoveryCodes,
  hashRecoveryCode, matchesRecoveryCode, otpauthUri,
} = require('./totp');

// ---------------- 配置 ----------------
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'vault.json');
const AUTO_LOCK_MS = (Number(process.env.VAULT_AUTO_LOCK_MINUTES) || 30) * 60_000; // 环境变量默认值（可被设置页覆盖）
const MAX_ATTEMPTS = Number(process.env.VAULT_UNLOCK_MAX_ATTEMPTS) || 5;
const LOCKOUT_MS = (Number(process.env.VAULT_UNLOCK_LOCKOUT_SECONDS) || 60) * 1000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const ATTACH_DIR = path.join(DATA_DIR, 'attachments'); // 附件加密文件目录
const BACKUP_DIR = process.env.VAULT_BACKUP_DIR || path.join(DATA_DIR, 'backups'); // 可设为独立挂载目录
const REKEY_JOURNAL_FILE = path.join(DATA_DIR, '.rekey-journal.json');
const IMPORT_JOURNAL_FILE = path.join(DATA_DIR, '.import-journal.json');
const RESET_MARKER_FILE = path.join(DATA_DIR, '.reset-token');
const BACKUP_KEEP = Number(process.env.VAULT_BACKUP_KEEP) || 7; // 自动备份保留份数
const MAX_ATTACH_BYTES = (Number(process.env.VAULT_ATTACH_MAX_MB) || 20) * 1024 * 1024; // 单文件上限（默认 20MB）
const RESET_TOKEN = String(process.env.VAULT_RESET_TOKEN || '').trim();

// 兼容旧部署变量；设置页的 HTTPS 要求另存于密码库设置中。
const SECURE_MODE = process.env.VAULT_HTTPS === 'true';

// 附件上传：内存暂存（上限 20MB），文件名由服务端 UUID 生成，杜绝路径穿越
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ATTACH_BYTES },
});

// ---------------- 基础 ----------------
const app = express();
app.disable('x-powered-by');
// 部署在反向代理后面时开启，解锁限流才能看到真实客户端 IP
if (process.env.VAULT_TRUST_PROXY === 'true') app.set('trust proxy', 1);
app.use('/api/import', express.json({ limit: '200mb' })); // 只有完整备份导入需要大请求体
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: blob:; connect-src 'self' blob:; frame-src 'self' blob:; " +
    "object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
  if (req.secure && (SECURE_MODE || store.data.settings?.httpsRequired)) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  }
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store'); // 敏感响应禁止缓存
  next();
});

const store = new VaultStore(DATA_FILE);
app.use((req, res, next) => {
  if (!store.data.settings?.httpsRequired || req.secure || req.path === '/api/health') return next();
  if (req.path.startsWith('/api/')) return res.status(403).json({ error: '此密码库已要求 HTTPS，请使用 HTTPS 地址访问' });
  res.status(403).type('text/plain').send('此密码库已要求 HTTPS，请使用 HTTPS 地址访问');
});

function connectionSettings(req) {
  return { httpsRequired: !!store.data.settings?.httpsRequired, secureConnection: req.secure };
}

function sessionCookieOptions(req) {
  return { httpOnly: true, sameSite: 'strict', path: '/', secure: req.secure || SECURE_MODE || !!store.data.settings?.httpsRequired };
}

/**
 * 由 Compose 显式请求时清空数据卷。令牌只保存哈希；相同令牌只会执行一次，
 * 既方便忘记主密码后的重新初始化，也避免每次容器重启都误删数据。
 */
async function resetVaultIfRequested() {
  if (!RESET_TOKEN) return;
  const tokenHash = crypto.createHash('sha256').update(RESET_TOKEN).digest('hex');
  let previous = '';
  try { previous = (await fs.readFile(RESET_MARKER_FILE, 'utf8')).trim(); } catch { /* 首次执行 */ }
  if (previous === tokenHash) return;

  await fs.rm(DATA_FILE, { force: true });
  await fs.rm(DATA_FILE + '.bak', { force: true });
  await fs.rm(REKEY_JOURNAL_FILE, { force: true });
  await fs.rm(IMPORT_JOURNAL_FILE, { force: true });
  await fs.rm(IMPORT_JOURNAL_FILE + '.tmp', { force: true });
  await fs.rm(ATTACH_DIR, { recursive: true, force: true });
  for (const name of await fs.readdir(DATA_DIR).catch(() => [])) {
    if (/^attachments\.import-[0-9a-f-]{36}\.(next|old)$/.test(name)) {
      await fs.rm(path.join(DATA_DIR, name), { recursive: true, force: true });
    }
  }
  if (BACKUP_DIR === path.join(DATA_DIR, 'backups')) {
    await fs.rm(BACKUP_DIR, { recursive: true, force: true });
  }
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(RESET_MARKER_FILE, tokenHash, { mode: 0o600 });
  console.warn('[vault] 已按 VAULT_RESET_TOKEN 请求清空密码库');
}

// 会话：sessionId -> { key: Buffer, lastActive: number }（密钥仅存内存）
const sessions = new Map();
// 解锁失败计数：ip -> { count, until }
const attempts = new Map();
// 开启两步验证的待确认状态：sessionId -> { secret, recovery, expires }（仅存内存，10 分钟有效）
const totpPending = new Map();
const TOTP_PENDING_TTL_MS = 10 * 60 * 1000;
// 新增条目时的待绑定附件：sessionId -> { expires, items: Map(attId -> att) }（先上传，保存条目时绑定）
const pendingAtts = new Map();
const PENDING_ATT_TTL_MS = 30 * 60 * 1000;
let vaultMaintenance = false;
let vaultRecoveryNeeded = false;
let setupInProgress = false;
let activeDerivations = 0;
const MAX_ACTIVE_DERIVATIONS = 2;
const backupStatus = { lastSuccess: null, lastError: null };
const COMMON_MASTER_PASSWORDS = new Set([
  'password', 'password123', 'password12345', 'password123456', '123456', '123456789',
  '123456789012', 'qwerty123', 'qwerty123456', 'admin123', 'admin12345678',
  'letmein123456', 'iloveyou12345',
]);

function masterPasswordError(password, label = '主密码') {
  if ([...password].length < 8) return `${label}至少需要 8 位，建议使用 15 位以上的独特短语`;
  if (password.length > 200) return `${label}过长`;
  if (COMMON_MASTER_PASSWORDS.has(password.toLowerCase()) || /^(.)\1{7,}$/u.test(password)) {
    return `${label}过于常见，请换一个独特的密码短语`;
  }
  return null;
}

// ---------------- 会话工具 ----------------
function parseCookies(req) {
  const out = {};
  const h = req.headers.cookie;
  if (!h) return out;
  for (const part of h.split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    try {
      out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    } catch { /* 畸形 Cookie 视为无效，不影响其他请求 */ }
  }
  return out;
}

/** 当前生效的自动锁定毫秒数（设置页可覆盖环境变量默认值） */
function currentAutoLockMs() {
  const m = Number(store.data.settings?.autoLockMinutes);
  return (Number.isFinite(m) && m >= 1 && m <= 240 ? m : Number(process.env.VAULT_AUTO_LOCK_MINUTES) || 30) * 60_000;
}

function getSession(req, touch = true) {
  const sid = parseCookies(req).vsid;
  if (!sid) return null;
  const s = sessions.get(sid);
  if (!s) return null;
  if (Date.now() - s.lastActive > currentAutoLockMs()) {
    sessions.delete(sid); // 闲置超时自动锁定
    return null;
  }
  if (touch) s.lastActive = Date.now(); // 真实操作才滑动续期
  return { sid, key: s.key };
}

/** 需要已解锁的接口 */
function auth(req, res, next) {
  const s = getSession(req);
  if (!s) return res.status(401).json({ error: '未解锁或会话已过期' });
  req.session = s;
  next();
}

/** 异步路由包装：异常统一交给错误中间件 */
const h = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const withVaultMaintenance = (fn) => h(async (req, res, next) => {
  if (vaultMaintenance) return res.status(409).json({ error: '密码库正在执行重要操作，请稍后再试' });
  vaultMaintenance = true;
  try {
    return await fn(req, res, next);
  } finally {
    vaultMaintenance = false;
  }
});

app.use('/api', (req, res, next) => {
  if (vaultRecoveryNeeded) return res.status(503).json({ error: '密码库需要重启以恢复中断的主密码修改' });
  if (vaultMaintenance && !['/health', '/state', '/lock'].includes(req.path)) {
    return res.status(409).json({ error: '密码库正在执行重要操作，请稍后再试' });
  }
  next();
});

// 定期清理过期会话、限流记录、TOTP 待确认状态与待绑定附件
setInterval(() => {
  const now = Date.now();
  const lockMs = currentAutoLockMs();
  for (const [id, s] of sessions) if (now - s.lastActive > lockMs) sessions.delete(id);
  for (const [ip, a] of attempts) if (a.until && now > a.until + 3_600_000) attempts.delete(ip);
  for (const [sid, p] of totpPending) if (p.expires < now) totpPending.delete(sid);
  // 待绑定附件：会话已失效或超时则连同文件一起清理
  for (const [sid, p] of pendingAtts) {
    if (p.expires < now || !sessions.has(sid)) {
      for (const att of p.items.values()) removeAttachmentFile(att.id);
      pendingAtts.delete(sid);
    }
  }
}, 60_000).unref();

// ---------------- 条目加解密（自定义字段：{n: 加密名, t: 加密类型, v: 加密值} 列表） ----------------
const MAX_FIELDS = 30;
const FIELD_NAME_LIMIT = 60;
const FIELD_VALUE_LIMIT = 2000;
const FIELD_TYPES = ['text', 'password', 'url', 'number', 'boolean', 'date', 'email', 'divider'];

/** 按字段类型校验值；返回错误信息或 null */
function validateFieldValue(name, type, value) {
  if (value === '') return null; // 空值允许
  switch (type) {
    case 'number':
      if (!/^[\d\s\-+()]+$/.test(value)) return `「${name}」不是有效的数字（仅限数字、空格、- + ( )）`;
      break;
    case 'date':
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return `「${name}」日期格式应为 YYYY-MM-DD`;
      else {
        const d = new Date(value + 'T00:00:00Z');
        if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) return `「${name}」不是有效日期`;
      }
      break;
    case 'email':
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return `「${name}」不是有效的邮箱地址`;
      break;
    case 'boolean':
      if (value !== '是' && value !== '否') return `「${name}」布尔值只能为 是 或 否`;
      break;
    case 'url':
      if (!/^https?:\/\//i.test(value)) return `「${name}」网址应以 http:// 或 https:// 开头`;
      break;
  }
  return null;
}

/**
 * 解析并清洗自定义字段列表
 * @returns {{fields: (array|null), error: (string|null)}} fields 为 null 表示未传（编辑时保留原字段）
 */
function parseFields(bodyFields) {
  if (bodyFields === undefined) return { fields: null, error: null };
  if (!Array.isArray(bodyFields)) return { fields: [], error: null };
  const fields = [];
  for (const f of bodyFields) {
    const name = String(f?.name ?? '').trim().slice(0, FIELD_NAME_LIMIT);
    if (!name) continue;
    const type = FIELD_TYPES.includes(f?.type) ? f.type : 'text';
    const value = String(f?.value ?? '').slice(0, FIELD_VALUE_LIMIT);
    const err = validateFieldValue(name, type, value);
    if (err) return { fields: null, error: err };
    const pinned = (f?.pinned === true || f?.pinned === '1' || f?.pinned === '是') ? '1' : '0';
    const copyable = (f?.copyable === false || f?.copyable === '0' || f?.copyable === '否') ? '0' : '1'; // 默认开启
    fields.push({ name, type, value, pinned, copyable });
    if (fields.length >= MAX_FIELDS) break;
  }
  return { fields, error: null };
}

/** 加密自定义字段列表 */
function encryptFields(fields, key) {
  return fields.map((f) => ({
    n: encrypt(key, f.name),
    t: encrypt(key, f.type),
    v: encrypt(key, f.value),
    p: encrypt(key, f.pinned === '1' ? '1' : '0'),
    c: encrypt(key, f.copyable === '0' ? '0' : '1'),
  }));
}

/** 根据字段名推断类型（兼容没有 type 的旧数据） */
function inferFieldType(name) {
  return /(密码|口令|password|passwd|pin|secret)/i.test(name) ? 'password' : 'text';
}

/** 解密自定义字段列表；兼容旧格式（对象 或 无 type/置顶标记的数组） */
function decryptFields(fields, key) {
  if (Array.isArray(fields)) {
    return fields.map((f) => ({
      name: decrypt(key, f.n),
      type: f.t ? decrypt(key, f.t) : inferFieldType(decrypt(key, f.n)),
      value: decrypt(key, f.v),
      pinned: f.p ? decrypt(key, f.p) === '1' : false,
      copyable: f.c ? decrypt(key, f.c) === '1' : true, // 旧数据默认显示复制按钮
    }));
  }
  // 最旧版：{ account, password, url, note }（title 单独处理）
  const out = [];
  const legacy = [
    ['账号', 'text', fields?.account],
    ['密码', 'password', fields?.password],
    ['网址', 'url', fields?.url],
    ['备注', 'text', fields?.note],
  ];
  for (const [name, type, blob] of legacy) {
    if (blob) out.push({ name, type, value: decrypt(key, blob), pinned: false, copyable: true });
  }
  return out;
}

function toClient(entry, key) {
  let title;
  if (entry.title) title = decrypt(key, entry.title);
  else title = decrypt(key, entry.fields?.title); // 旧版：标题加密在 fields 里
  return {
    id: entry.id, category: entry.category, favorite: entry.favorite,
    createdAt: entry.createdAt, updatedAt: entry.updatedAt,
    attachments: entry.attachments || [],
    title,
    subtitle: entry.subtitle ? decrypt(key, entry.subtitle) : '',
    icon: entry.icon || '', // 明文元数据：内置图标 emoji 或上传的 dataURL
    fields: decryptFields(entry.fields, key),
  };
}

function cleanCategory(v) {
  return String(v ?? '').trim().slice(0, 20);
}

/** 条目保存时自动注册新出现的分类 */
function ensureCategory(name, data = store.data) {
  if (name && !data.categories.includes(name)) {
    data.categories.push(name);
  }
}

// ---------------- 附件辅助 ----------------
/** 清理文件名：去掉路径分隔符与控制字符，防止路径穿越与换行头注入 */
function sanitizeFileName(name) {
  // multer/busboy 默认按 latin1 解码 multipart 文件名，中文会变乱码（如 æµè¯）；
  // 若这些 latin1 字节恰好是合法 UTF-8 文本，则重新按 UTF-8 解码恢复（含 U+FFFD 说明并非 UTF-8，保留原名）
  const raw = String(name ?? '附件');
  const redecoded = Buffer.from(raw, 'latin1').toString('utf8');
  const fixed = redecoded.includes('\uFFFD') ? raw : redecoded;
  const n = fixed
    .replace(/[\\/]/g, '_')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .trim()
    .slice(0, 100);
  return n || '附件';
}

/** 按附件 id 找到所在条目与附件元数据 */
function findAttachment(attId) {
  for (const e of store.data.entries) {
    const att = (e.attachments || []).find((a) => a.id === attId);
    if (att) return { entry: e, att };
  }
  return null;
}

/** 加密附件内容：header(iv 12B + tag 16B) + 密文 */
async function writeAttachment(key, attId, data, suffix = '') {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  await fs.mkdir(ATTACH_DIR, { recursive: true });
  await fs.writeFile(attachmentPath(attId, suffix), Buffer.concat([iv, tag, ct]));
}

/** 解密读取附件内容；文件损坏时抛出异常 */
async function readAttachment(key, attId) {
  const buf = await fs.readFile(attachmentPath(attId));
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

/** 删除附件文件（尽力而为，文件不存在不报错） */
async function removeAttachmentFile(attId) {
  try { await fs.unlink(attachmentPath(attId)); } catch { /* 忽略 */ }
}

/** 启动时清理孤儿附件：磁盘上有但任何条目都不引用的加密文件 */
async function cleanupOrphanAttachments() {
  let files;
  try { files = await fs.readdir(ATTACH_DIR); } catch { return; } // 目录不存在 = 无附件
  const valid = new Set();
  for (const e of store.data.entries) for (const a of e.attachments || []) valid.add(a.id);
  let removed = 0;
  for (const f of files) {
    if (!f.endsWith('.bin')) continue;
    const id = f.slice(0, -4);
    if (!valid.has(id)) {
      try { await fs.unlink(path.join(ATTACH_DIR, f)); removed++; } catch { /* 忽略 */ }
    }
  }
  if (removed > 0) console.warn(`[vault] 已清理 ${removed} 个孤儿附件文件`);
}

async function cleanupStaleRekeyFiles() {
  let files;
  try { files = await fs.readdir(ATTACH_DIR); } catch { return; }
  for (const name of files) {
    if (/^[0-9a-f-]{36}\.bin\.rekey-[0-9a-f-]{36}\.(next|old)$/.test(name)) {
      await fs.rm(path.join(ATTACH_DIR, name), { force: true });
    }
  }
}

// ---------------- API ----------------
app.get('/api/health', (req, res) => res.json({ ok: true, uptime: process.uptime() }));

app.get('/api/state', (req, res) => {
  res.json({
    setup: !!store.data.kdf,
    unlocked: !!getSession(req, false),
    autoLockMinutes: currentAutoLockMs() / 60_000,
    totpEnabled: !!totpEnabled(),
    ...connectionSettings(req),
  });
});

app.post('/api/activity', auth, (req, res) => res.json({ ok: true }));

/** 读取设置 */
app.get('/api/settings', auth, (req, res) => {
  res.json({ autoLockMinutes: currentAutoLockMs() / 60_000, ...connectionSettings(req) });
});

/** 保存设置（自动锁定时长，分钟） */
app.post('/api/settings', auth, h(async (req, res) => {
  const m = Number(req.body?.autoLockMinutes);
  if (!Number.isFinite(m) || m < 1 || m > 240) {
    return res.status(400).json({ error: '自动锁定时长需在 1~240 分钟之间' });
  }
  store.data.settings = { ...(store.data.settings || {}), autoLockMinutes: Math.round(m) };
  await store.save();
  res.json({ ok: true, autoLockMinutes: currentAutoLockMs() / 60_000, ...connectionSettings(req) });
}));

app.post('/api/settings/https', auth, h(async (req, res) => {
  const required = req.body?.httpsRequired;
  if (typeof required !== 'boolean') return res.status(400).json({ error: 'HTTPS 设置无效' });
  if (!req.secure) return res.status(400).json({ error: '请先配置 HTTPS 反向代理，并从 HTTPS 地址打开 Keystone' });
  store.data.settings = { ...(store.data.settings || {}), httpsRequired: required };
  await store.save();
  res.setHeader('Strict-Transport-Security', required || SECURE_MODE ? 'max-age=31536000' : 'max-age=0');
  res.json({ ok: true, ...connectionSettings(req) });
}));

/** 首次初始化：创建主密码 */
app.post('/api/setup', h(async (req, res) => {
  if (store.data.kdf || setupInProgress) return res.status(409).json({ error: 'Keystone 已初始化或正在初始化' });
  const pw = String(req.body?.password ?? '');
  const policyError = masterPasswordError(pw);
  if (policyError) return res.status(400).json({ error: policyError });

  if (activeDerivations >= MAX_ACTIVE_DERIVATIONS) return res.status(503).json({ error: '解锁请求较多，请稍后再试' });
  setupInProgress = true;
  activeDerivations++;
  let created;
  try {
    created = await createVault(pw);
    const nextData = structuredClone(store.data);
    nextData.kdf = { salt: created.salt, verifier: created.verifier, createdAt: Date.now() };
    await store.replace(nextData);
  } finally {
    activeDerivations--;
    setupInProgress = false;
  }
  const { key } = created;

  const sid = crypto.randomBytes(24).toString('base64url');
  sessions.set(sid, { key, lastActive: Date.now() });
  res.cookie('vsid', sid, sessionCookieOptions(req));
  res.json({ ok: true });
}));

/** 解锁（TOTP 开启时需主密码 + 动态验证码，或用一次性恢复码） */
app.post('/api/unlock', h(async (req, res) => {
  if (!store.data.kdf) return res.status(400).json({ error: '尚未初始化 Keystone' });
  const ip = req.ip;
  const att = attempts.get(ip);
  if (att && att.until && Date.now() < att.until) {
    const wait = Math.ceil((att.until - Date.now()) / 1000);
    return res.status(429).json({ error: `尝试次数过多，请 ${wait} 秒后再试` });
  }

  // 统一失败处理：记录尝试次数，超限封禁
  const fail = (msg) => {
    const a = att || { count: 0, until: 0 };
    a.count += 1;
    if (a.count >= MAX_ATTEMPTS) {
      a.until = Date.now() + LOCKOUT_MS;
      a.count = 0;
    }
    attempts.set(ip, a);
    res.status(401).json({ error: msg });
  };

  const pw = String(req.body?.password ?? '');
  if (pw.length > 200) return res.status(400).json({ error: '主密码过长' });
  if (activeDerivations >= MAX_ACTIVE_DERIVATIONS) return res.status(503).json({ error: '解锁请求较多，请稍后再试' });
  let key;
  activeDerivations++;
  try {
    key = await unlockVault(pw, store.data.kdf);
  } catch {
    return fail('主密码错误');
  } finally {
    activeDerivations--;
  }

  // 两步验证校验（仅当已开启）
  if (totpEnabled()) {
    const code = String(req.body?.totp ?? '').trim();
    let passed = false;
    if (code) {
      let secret = null;
      try { secret = decrypt(key, store.data.security.totp.secret); } catch { /* 密文损坏则走恢复码 */ }
      if (secret && verifyTotp(secret, code)) passed = true;
      else passed = await useRecoveryCode(code, store.data.security.recovery); // 恢复码可绕过验证器
    }
    if (!passed) return fail(code ? '两步验证失败：验证码错误' : '请输入两步验证码');
  }

  if (att) attempts.delete(ip);
  const sid = crypto.randomBytes(24).toString('base64url');
  sessions.set(sid, { key, lastActive: Date.now() });
  res.cookie('vsid', sid, sessionCookieOptions(req));
  res.json({ ok: true });
}));

/** 手动锁定 */
app.post('/api/lock', (req, res) => {
  const s = getSession(req);
  if (s) sessions.delete(s.sid);
  res.clearCookie('vsid', { path: '/' });
  res.json({ ok: true });
});

// ---------------- 两步验证（TOTP）辅助 ----------------
function totpEnabled() {
  const sec = store.data.security;
  return !!(sec && sec.totp && sec.totp.secret);
}

/** 尝试使用一次性恢复码；命中则标记已用并持久化 */
async function useRecoveryCode(code, list) {
  if (!Array.isArray(list)) return false;
  for (const entry of list) {
    if (entry.used) continue;
    if (matchesRecoveryCode(code, entry)) {
      entry.used = true;
      await store.save();
      return true;
    }
  }
  return false;
}

// ---------------- 两步验证（TOTP）接口 ----------------

/** 开启两步验证 - 第一步：生成密钥与恢复码（暂存内存，10 分钟内确认） */
app.post('/api/totp/start', auth, (req, res) => {
  if (totpEnabled()) return res.status(400).json({ error: '两步验证已开启，请先关闭' });
  const secret = generateSecret();
  const recovery = generateRecoveryCodes();
  totpPending.set(req.session.sid, {
    secret,
    recovery,
    expires: Date.now() + TOTP_PENDING_TTL_MS,
  });
  res.json({
    secret,
    otpauth: otpauthUri(secret),
    recoveryCodes: recovery,
  });
});

/** 开启两步验证 - 第二步：用验证器 App 的验证码确认后持久化 */
app.post('/api/totp/verify', auth, h(async (req, res) => {
  const pending = totpPending.get(req.session.sid);
  if (!pending || pending.expires < Date.now()) {
    return res.status(400).json({ error: '验证会话已过期，请重新开始' });
  }
  const code = String(req.body?.code ?? '').trim();
  if (!verifyTotp(pending.secret, code)) {
    return res.status(400).json({ error: '验证码错误，请检查 App 显示的 6 位数字' });
  }
  const key = req.session.key;
  store.data.security = {
    totp: { secret: encrypt(key, pending.secret) },
    recovery: pending.recovery.map((c) => ({ ...hashRecoveryCode(c), used: false })),
  };
  totpPending.delete(req.session.sid);
  await store.save();
  res.json({ ok: true, recoveryCodes: pending.recovery });
}));

/** 关闭两步验证（需重新输入主密码确认） */
app.post('/api/totp/disable', auth, h(async (req, res) => {
  if (!totpEnabled()) return res.status(400).json({ error: '两步验证未开启' });
  const pw = String(req.body?.password ?? '');
  if (pw.length < 8) return res.status(400).json({ error: '请输入主密码确认' });
  try {
    await unlockVault(pw, store.data.kdf); // 重新验证主密码，防止已解锁会话被劫持者关闭
  } catch {
    return res.status(400).json({ error: '主密码错误，无法关闭两步验证' });
  }
  store.data.security = null;
  await store.save();
  res.json({ ok: true });
}));

/** 重新生成恢复码（旧码立即全部作废） */
app.post('/api/recovery/regenerate', auth, h(async (req, res) => {
  if (!totpEnabled()) return res.status(400).json({ error: '两步验证未开启' });
  const codes = generateRecoveryCodes();
  store.data.security.recovery = codes.map((c) => ({ ...hashRecoveryCode(c), used: false }));
  await store.save();
  res.json({ ok: true, recoveryCodes: codes });
}));

// ---------------- 修改主密码 ----------------

/** 用新密钥重加密一个条目（兼容旧版对象格式字段，返回新对象而不修改原数据） */
function reencryptEntry(entry, oldKey, newKey) {
  const next = structuredClone(entry);
  const title = entry.title ? decrypt(oldKey, entry.title) : decrypt(oldKey, entry.fields?.title);
  const fields = [];
  if (Array.isArray(entry.fields)) {
    for (const f of entry.fields) {
      fields.push({
        name: decrypt(oldKey, f.n),
        type: f.t ? decrypt(oldKey, f.t) : inferFieldType(decrypt(oldKey, f.n)),
        value: decrypt(oldKey, f.v),
        pinned: f.p ? decrypt(oldKey, f.p) === '1' : false,
        copyable: f.c ? decrypt(oldKey, f.c) === '1' : true,
      });
    }
  } else {
    const legacy = [
      ['账号', 'text', entry.fields?.account],
      ['密码', 'password', entry.fields?.password],
      ['网址', 'url', entry.fields?.url],
      ['备注', 'text', entry.fields?.note],
    ];
    for (const [name, type, blob] of legacy) {
      if (blob) fields.push({ name, type, value: decrypt(oldKey, blob), pinned: false, copyable: true });
    }
  }
  next.title = encrypt(newKey, title);
  if (entry.subtitle) next.subtitle = encrypt(newKey, decrypt(oldKey, entry.subtitle));
  else delete next.subtitle;
  next.fields = fields.map((f) => ({
    n: encrypt(newKey, f.name),
    t: encrypt(newKey, f.type),
    v: encrypt(newKey, f.value),
    p: encrypt(newKey, f.pinned ? '1' : '0'),
    c: encrypt(newKey, f.copyable === false ? '0' : '1'),
  }));
  return next;
}

function attachmentPath(attId, suffix = '') {
  return path.join(ATTACH_DIR, `${attId}.bin${suffix}`);
}

async function removeFiles(paths) {
  await Promise.all(paths.map((p) => fs.unlink(p).catch(() => {})));
}

async function clearPendingAttachments() {
  const files = [];
  for (const pending of pendingAtts.values()) {
    for (const att of pending.items.values()) files.push(attachmentPath(att.id));
  }
  pendingAtts.clear();
  await removeFiles(files);
}

async function recoverRekey() {
  let journal;
  try { journal = JSON.parse(await fs.readFile(REKEY_JOURNAL_FILE, 'utf8')); }
  catch (err) {
    if (err.code === 'ENOENT') return;
    throw new Error(`主密码修改日志无法读取，已停止启动：${err.message}`);
  }
  if (!journal || !/^\.rekey-[0-9a-f-]+$/.test(journal.tx) ||
      !Array.isArray(journal.ids) || !journal.ids.every((id) => /^[0-9a-f-]{36}$/.test(id)) ||
      typeof journal.oldSalt !== 'string' || typeof journal.newSalt !== 'string' ||
      !journal.oldDigests || !journal.newDigests ||
      !journal.ids.every((id) => /^[0-9a-f]{64}$/.test(journal.oldDigests[id]) && /^[0-9a-f]{64}$/.test(journal.newDigests[id]))) {
    throw new Error('主密码修改日志格式无效，已停止启动');
  }
  const salt = store.data.kdf?.salt;
  if (salt !== journal.oldSalt && salt !== journal.newSalt) {
    throw new Error('主密码修改日志与数据文件不匹配，已停止启动');
  }
  for (const id of journal.ids) {
    const current = attachmentPath(id);
    const old = attachmentPath(id, `${journal.tx}.old`);
    const next = attachmentPath(id, `${journal.tx}.next`);
    if (salt === journal.oldSalt) {
      const hasOld = await fs.stat(old).then(() => true, () => false);
      if (hasOld) await fs.rename(old, current);
      const digest = crypto.createHash('sha256').update(await fs.readFile(current)).digest('hex');
      if (digest !== journal.oldDigests[id]) throw new Error(`附件 ${id} 无法恢复旧版本，已停止启动`);
      await fs.rm(next, { force: true });
    } else {
      const digest = crypto.createHash('sha256').update(await fs.readFile(current)).digest('hex');
      if (digest !== journal.newDigests[id]) throw new Error(`附件 ${id} 与新主密码不匹配，已停止启动`);
      await fs.rm(old, { force: true });
      await fs.rm(next, { force: true });
    }
  }
  await fs.rm(REKEY_JOURNAL_FILE);
  console.warn('[vault] 已恢复中断的主密码修改');
}

/** 修改主密码：验证旧密码 → 派生新密钥 → 全量重加密（条目/附件/两步验证） */
app.post('/api/password', auth, withVaultMaintenance(async (req, res) => {
  const oldPw = String(req.body?.oldPassword ?? '');
  const newPw = String(req.body?.newPassword ?? '');
  const policyError = masterPasswordError(newPw, '新主密码');
  if (policyError) return res.status(400).json({ error: policyError });
  try {
    await unlockVault(oldPw, store.data.kdf); // 验证旧密码（失败即抛错）
  } catch {
    return res.status(400).json({ error: '旧主密码错误' });
  }
  const oldKey = req.session.key;
  const salt = crypto.randomBytes(16);
  const newKey = await deriveKey(newPw, salt);

  // 全部先在内存中生成新数据；任一密文损坏都不会改动当前库。
  let nextData;
  try {
    nextData = structuredClone(store.data);
    nextData.entries = store.data.entries.map((entry) => reencryptEntry(entry, oldKey, newKey));
    if (store.data.security?.totp?.secret) {
      nextData.security.totp.secret = encrypt(newKey, decrypt(oldKey, store.data.security.totp.secret));
    }
  } catch {
    return res.status(500).json({ error: '数据异常（存在无法解密的条目或两步验证信息），无法修改主密码' });
  }
  // 旧版本导入可能遗留内嵌附件密文；真实附件以 attachments 目录为准。
  delete nextData.attachments;
  const token = crypto.randomBytes(32);
  nextData.kdf = { salt: salt.toString('base64'), verifier: encrypt(newKey, token), createdAt: Date.now() };

  const ids = [...new Set(store.data.entries.flatMap((entry) =>
    (entry.attachments || []).map((att) => att.id)))];
  const tx = `.rekey-${crypto.randomUUID()}`;
  const staged = ids.map((id) => attachmentPath(id, `${tx}.next`));
  const previous = ids.map((id) => attachmentPath(id, `${tx}.old`));
  let journalWritten = false;
  const oldDigests = {};
  const newDigests = {};

  try {
    // 先写入独立临时文件。任一附件缺失或损坏都会中止，原文件保持不动。
    for (const id of ids) {
      oldDigests[id] = crypto.createHash('sha256').update(await fs.readFile(attachmentPath(id))).digest('hex');
      const plain = await readAttachment(oldKey, id);
      await writeAttachment(newKey, id, plain, `${tx}.next`);
      newDigests[id] = crypto.createHash('sha256').update(await fs.readFile(attachmentPath(id, `${tx}.next`))).digest('hex');
    }

    const journalTmp = REKEY_JOURNAL_FILE + '.tmp';
    await fs.writeFile(journalTmp, JSON.stringify({ tx, ids, oldSalt: store.data.kdf.salt, newSalt: nextData.kdf.salt, oldDigests, newDigests }), { mode: 0o600 });
    await fs.rename(journalTmp, REKEY_JOURNAL_FILE);
    journalWritten = true;

    // 文件切换失败时立即回滚，避免主数据与附件使用不同密钥。
    for (const id of ids) {
      const current = attachmentPath(id);
      const next = attachmentPath(id, `${tx}.next`);
      const old = attachmentPath(id, `${tx}.old`);
      await fs.rename(current, old);
      try {
        await fs.rename(next, current);
      } catch (err) {
        await fs.rename(old, current).catch(() => {});
        throw err;
      }
    }
    await store.replace(nextData);
  } catch (err) {
    try {
      if (journalWritten) await recoverRekey();
      else await removeFiles(staged);
    } catch (recoveryError) {
      vaultRecoveryNeeded = true;
      console.error('[password] 回滚失败，服务已禁止继续操作，需重启恢复:', recoveryError.message);
      return res.status(500).json({ error: '修改主密码中断，请重启服务完成恢复' });
    }
    console.error('[password] 主密码修改失败:', err.message);
    return res.status(500).json({ error: '修改主密码失败，数据未变更' });
  }
  await removeFiles(previous);
  await fs.rm(REKEY_JOURNAL_FILE, { force: true });

  // 新密钥只交给新的会话；旧标签页和设备不能再用旧密钥写入数据。
  sessions.clear();
  totpPending.clear();
  await clearPendingAttachments();
  const sid = crypto.randomBytes(24).toString('base64url');
  sessions.set(sid, { key: newKey, lastActive: Date.now() });
  res.cookie('vsid', sid, sessionCookieOptions(req));
  res.json({ ok: true, message: '主密码已修改，其他会话已锁定' });
}));

/** 读取全部条目（服务端解密后返回） */
app.get('/api/entries', auth, (req, res) => {
  const key = req.session.key;
  const entries = [];
  for (const e of store.data.entries) {
    try {
      entries.push(toClient(e, key));
    } catch {
      console.warn(`[vault] 条目 ${e.id} 解密失败`);
      return res.status(500).json({ error: '发现无法解密的条目，请从备份恢复后重试' });
    }
  }
  res.json({ entries });
});

/** 新增条目 */
app.post('/api/entries', auth, h(async (req, res) => {
  const body = req.body ?? {};
  const title = String(body.title ?? '').trim().slice(0, 60);
  if (!title) return res.status(400).json({ error: '请填写名称' });
  const category = cleanCategory(body.category);
  if (!category) return res.status(400).json({ error: '请选择或新建分类' });

  const { fields, error } = parseFields(body.fields);
  if (error) return res.status(400).json({ error });
  const subtitle = String(body.subtitle ?? '').trim().slice(0, 120);
  const entry = {
    id: crypto.randomUUID(),
    category,
    favorite: !!body.favorite,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    title: encrypt(req.session.key, title),
    fields: encryptFields(fields ?? [], req.session.key),
  };
  if (subtitle) entry.subtitle = encrypt(req.session.key, subtitle);
  const icon = String(body.icon ?? '').slice(0, 150000);
  if (icon) entry.icon = icon;
  // 绑定新增流程中"先上传、保存时再关联"的附件（attachIds 仅限本会话的待绑定附件）
  const pending = pendingAtts.get(req.session.sid);
  const consumedPendingIds = [];
  if (Array.isArray(body.attachIds) && pending) {
    entry.attachments = [];
    for (const id of body.attachIds) {
      const att = pending.items.get(id);
      if (att) {
        entry.attachments.push(att);
        consumedPendingIds.push(id);
      }
    }
  }
  const nextData = structuredClone(store.data);
  ensureCategory(category, nextData); // 所有校验完成后再注册新分类
  nextData.entries.push(entry);
  await store.replace(nextData);
  for (const id of consumedPendingIds) pending.items.delete(id);
  res.status(201).json({ entry: toClient(entry, req.session.key) });
}));

/** 更新条目 */
app.put('/api/entries/:id', auth, h(async (req, res) => {
  const entry = store.data.entries.find((e) => e.id === req.params.id);
  if (!entry) return res.status(404).json({ error: '条目不存在' });
  const body = req.body ?? {};
  const title = String(body.title ?? '').trim().slice(0, 60);
  if (!title) return res.status(400).json({ error: '请填写名称' });
  const category = cleanCategory(body.category);
  if (!category) return res.status(400).json({ error: '请选择或新建分类' });

  let parsedFields = null;
  if (body.fields !== undefined) {
    const parsed = parseFields(body.fields);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    parsedFields = parsed.fields;
  }
  ensureCategory(category); // 所有可能失败的字段校验完成后再注册新分类
  entry.category = category;
  if (body.favorite !== undefined) entry.favorite = !!body.favorite; // 未传则保留原收藏状态（弹窗已无收藏入口，星标在卡片上）
  entry.updatedAt = Date.now();
  entry.title = encrypt(req.session.key, title);
  if (body.subtitle !== undefined) { // 未传则保留原副标题
    const sub = String(body.subtitle ?? '').trim().slice(0, 120);
    if (sub) entry.subtitle = encrypt(req.session.key, sub);
    else delete entry.subtitle;
  }
  if (body.icon !== undefined) { // 未传则保留原图标
    const icon = String(body.icon ?? '').slice(0, 150000);
    if (icon) entry.icon = icon;
    else delete entry.icon;
  }
  if (parsedFields !== null) { // 未传 fields 时保留原字段（兼容）
    entry.fields = encryptFields(parsedFields, req.session.key);
  }
  await store.save();
  res.json({ entry: toClient(entry, req.session.key) });
}));

/** 收藏仅改变分类状态，不算凭据内容更新。 */
app.patch('/api/entries/:id/favorite', auth, h(async (req, res) => {
  const entry = store.data.entries.find((e) => e.id === req.params.id);
  if (!entry) return res.status(404).json({ error: '条目不存在' });
  if (typeof req.body?.favorite !== 'boolean') return res.status(400).json({ error: '收藏状态无效' });
  entry.favorite = req.body.favorite;
  await store.save();
  res.json({ entry: toClient(entry, req.session.key) });
}));

/** 删除条目（连同其附件文件） */
app.delete('/api/entries/:id', auth, h(async (req, res) => {
  const idx = store.data.entries.findIndex((e) => e.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '条目不存在' });
  const nextData = structuredClone(store.data);
  const [removed] = nextData.entries.splice(idx, 1);
  await store.replace(nextData);
  for (const a of removed.attachments || []) await removeAttachmentFile(a.id); // 元数据成功落盘后再级联删除
  res.json({ ok: true });
}));

// ---------------- 附件（加密存储） ----------------

/** 上传附件（multipart/form-data，字段名 file） */
app.post('/api/entries/:id/attachments', auth, upload.single('file'), h(async (req, res) => {
  const entry = store.data.entries.find((e) => e.id === req.params.id);
  if (!entry) return res.status(404).json({ error: '条目不存在' });
  if (!req.file || req.file.size === 0) return res.status(400).json({ error: '请选择要上传的文件' });

  const attId = crypto.randomUUID();
  await writeAttachment(req.session.key, attId, req.file.buffer);
  const att = {
    id: attId,
    name: sanitizeFileName(req.file.originalname),
    mime: req.file.mimetype || 'application/octet-stream',
    size: req.file.size,
    createdAt: Date.now(),
  };
  entry.attachments = entry.attachments || [];
  entry.attachments.push(att);
  await store.save();
  res.status(201).json({ attachment: att });
}));

/** 上传"待绑定附件"（新增条目流程：选文件立即上传，保存条目时通过 attachIds 关联） */
app.post('/api/pending-attachments', auth, upload.single('file'), h(async (req, res) => {
  if (!req.file || req.file.size === 0) return res.status(400).json({ error: '请选择要上传的文件' });

  const attId = crypto.randomUUID();
  await writeAttachment(req.session.key, attId, req.file.buffer);
  const att = {
    id: attId,
    name: sanitizeFileName(req.file.originalname),
    mime: req.file.mimetype || 'application/octet-stream',
    size: req.file.size,
    createdAt: Date.now(),
  };
  if (!pendingAtts.has(req.session.sid)) {
    pendingAtts.set(req.session.sid, { expires: Date.now() + PENDING_ATT_TTL_MS, items: new Map() });
  }
  pendingAtts.get(req.session.sid).items.set(attId, att);
  res.status(201).json({ attachment: att });
}));

/** 取消待绑定附件（用户移除或取消新增时调用） */
app.delete('/api/pending-attachments/:id', auth, h(async (req, res) => {
  const pending = pendingAtts.get(req.session.sid);
  const att = pending && pending.items.get(req.params.id);
  if (!att) return res.status(404).json({ error: '附件不存在' });
  pending.items.delete(att.id);
  await removeAttachmentFile(att.id);
  res.json({ ok: true });
}));

/** 下载附件（需解锁；始终按附件下载处理，防止上传的 HTML/SVG 被浏览器内联执行） */
app.get('/api/attachments/:id', auth, h(async (req, res) => {
  const found = findAttachment(req.params.id);
  let att = found?.att;
  if (!att) {
    // 新增流程中已上传但尚未绑定到条目的附件也可下载
    const pending = pendingAtts.get(req.session.sid);
    att = pending?.items.get(req.params.id) || null;
  }
  if (!att) return res.status(404).json({ error: '附件不存在' });
  let data;
  try {
    data = await readAttachment(req.session.key, att.id);
  } catch {
    return res.status(500).json({ error: '附件解密失败，文件可能已损坏' });
  }
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(att.name)}`);
  res.setHeader('Content-Length', String(data.length));
  res.setHeader('Cache-Control', 'no-store');
  res.send(data);
}));

/** 删除附件 */
app.delete('/api/attachments/:id', auth, h(async (req, res) => {
  const found = findAttachment(req.params.id);
  if (!found) return res.status(404).json({ error: '附件不存在' });
  const nextData = structuredClone(store.data);
  const nextEntry = nextData.entries.find((e) => e.id === found.entry.id);
  nextEntry.attachments = (nextEntry.attachments || []).filter((a) => a.id !== found.att.id);
  await store.replace(nextData);
  await removeAttachmentFile(found.att.id); // 元数据成功落盘后再删除文件
  res.json({ ok: true });
}));

// ---------------- 分类管理（全部由用户手动创建） ----------------

/** 分类列表 */
app.get('/api/categories', auth, (req, res) => {
  res.json({ categories: store.data.categories });
});

/** 创建分类 */
app.post('/api/categories', auth, h(async (req, res) => {
  const name = cleanCategory(req.body?.name);
  if (!name) return res.status(400).json({ error: '请输入分类名称' });
  if (name === '全部' || name === '收藏') return res.status(400).json({ error: '该名称已被系统占用' });
  if (store.data.categories.includes(name)) return res.status(400).json({ error: '分类已存在' });
  store.data.categories.push(name);
  await store.save();
  res.status(201).json({ categories: store.data.categories });
}));

/** 重命名分类（自动同步该分类下所有条目） */
app.put('/api/categories/:name', auth, h(async (req, res) => {
  const oldName = req.params.name; // Express 已自动 URL 解码
  const newName = cleanCategory(req.body?.name);
  if (!newName) return res.status(400).json({ error: '请输入分类名称' });
  if (newName === '全部' || newName === '收藏') return res.status(400).json({ error: '该名称已被系统占用' });
  const idx = store.data.categories.indexOf(oldName);
  if (idx === -1) return res.status(404).json({ error: '分类不存在' });
  if (newName === oldName) return res.json({ categories: store.data.categories }); // 未变化
  if (store.data.categories.includes(newName)) return res.status(400).json({ error: '分类已存在' });
  store.data.categories[idx] = newName;
  for (const e of store.data.entries) {
    if (e.category === oldName) e.category = newName; // 条目分类是明文元数据，直接同步
  }
  await store.save();
  res.json({ categories: store.data.categories });
}));

/** 删除分类（分类下还有条目时拒绝，防止数据悬空） */
app.delete('/api/categories/:name', auth, h(async (req, res) => {
  const name = req.params.name; // Express 已自动 URL 解码
  const idx = store.data.categories.indexOf(name);
  if (idx === -1) return res.status(404).json({ error: '分类不存在' });
  const used = store.data.entries.filter((e) => e.category === name).length;
  if (used > 0) {
    return res.status(400).json({ error: `该分类下还有 ${used} 条记录，请先修改或删除这些记录` });
  }
  store.data.categories.splice(idx, 1);
  await store.save();
  res.json({ categories: store.data.categories });
}));

function attachmentIds(entries) {
  return [...new Set(entries.flatMap((entry) => (entry.attachments || []).map((att) => att.id)))];
}

async function readCompleteAttachments(entries) {
  const attachments = {};
  const missing = [];
  for (const id of attachmentIds(entries)) {
    if (!/^[0-9a-fA-F-]{36}$/.test(id)) {
      missing.push(id);
      continue;
    }
    try {
      attachments[id] = (await fs.readFile(attachmentPath(id))).toString('base64');
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      missing.push(id);
    }
  }
  return { attachments, missing };
}

function vaultDigest(data) {
  return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

async function pathExists(file) {
  try { await fs.access(file); return true; } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
}

async function recoverImport() {
  if (!await pathExists(IMPORT_JOURNAL_FILE)) return;
  const journal = JSON.parse(await fs.readFile(IMPORT_JOURNAL_FILE, 'utf8'));
  if (!/^[0-9a-f-]{36}$/.test(journal.tx) ||
      !/^[0-9a-f]{64}$/.test(journal.newDigest) || !/^[0-9a-f]{64}$/.test(journal.oldDigest)) {
    throw new Error('导入恢复记录无效，已停止启动以保护数据');
  }
  const stage = `${ATTACH_DIR}.import-${journal.tx}.next`;
  const previous = `${ATTACH_DIR}.import-${journal.tx}.old`;
  const hasPrevious = await pathExists(previous);
  const digest = vaultDigest(store.data);
  if (hasPrevious && digest === journal.newDigest &&
      (journal.oldDigest !== journal.newDigest || journal.committed)) {
    if (!await pathExists(ATTACH_DIR)) throw new Error('导入附件目录缺失，已停止启动');
    await fs.rm(previous, { recursive: true, force: true });
  } else if (digest === journal.oldDigest) {
    if (hasPrevious) {
      await fs.rm(ATTACH_DIR, { recursive: true, force: true });
      await fs.rename(previous, ATTACH_DIR);
    }
  } else if (!hasPrevious && digest === journal.newDigest && await pathExists(ATTACH_DIR)) {
    // 主数据已经提交，旧附件目录也已清理；只需删除残留的恢复记录。
  } else {
    throw new Error('导入数据状态不明确，已停止启动以保护数据');
  }
  await fs.rm(stage, { recursive: true, force: true });
  await fs.rm(IMPORT_JOURNAL_FILE, { force: true });
  await fs.rm(IMPORT_JOURNAL_FILE + '.tmp', { force: true });
}

async function cleanupStaleImportFiles() {
  await fs.rm(IMPORT_JOURNAL_FILE + '.tmp', { force: true });
  let names;
  try { names = await fs.readdir(DATA_DIR); } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
  for (const name of names) {
    if (/^attachments\.import-[0-9a-f-]{36}\.(next|old)$/.test(name)) {
      await fs.rm(path.join(DATA_DIR, name), { recursive: true, force: true });
    }
  }
}

app.get('/api/backup/status', auth, h(async (req, res) => {
  let lastSuccessfulAt = backupStatus.lastSuccess;
  try {
    const names = (await fs.readdir(BACKUP_DIR)).filter((name) => /^vault-\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort();
    if (names.length) {
      const stat = await fs.stat(path.join(BACKUP_DIR, names.at(-1)));
      lastSuccessfulAt = Math.max(lastSuccessfulAt || 0, stat.mtimeMs);
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  let missingAttachments = 0;
  for (const id of attachmentIds(store.data.entries)) {
    if (!/^[0-9a-fA-F-]{36}$/.test(id) || !await pathExists(attachmentPath(id))) missingAttachments++;
  }
  res.json({ lastSuccessfulAt, lastError: backupStatus.lastError, missingAttachments });
}));

/** 导出加密备份（原始密文，不含主密码；附件加密文件以 base64 内嵌，单文件完整备份） */
app.get('/api/export', auth, h(async (req, res) => {
  const out = structuredClone(store.data);
  const result = await readCompleteAttachments(out.entries);
  if (result.missing.length) return res.status(409).json({ error: `导出失败：${result.missing.length} 个附件文件缺失，未生成不完整备份` });
  out.attachments = result.attachments;
  const name = `vault-backup-${new Date().toISOString().slice(0, 10)}.json`;
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.json(out);
}));

/** 导出所选条目（加密子备份，格式与完整备份一致，可再次导入恢复） */
app.post('/api/export-selected', auth, h(async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((id) => typeof id === 'string') : [];
  if (!ids.length) return res.status(400).json({ error: '请选择要导出的条目' });
  const out = structuredClone(store.data);
  out.entries = store.data.entries.filter((e) => ids.includes(e.id));
  if (!out.entries.length) return res.status(400).json({ error: '没有找到所选条目' });
  const result = await readCompleteAttachments(out.entries);
  if (result.missing.length) return res.status(409).json({ error: `导出失败：${result.missing.length} 个附件文件缺失，未生成不完整备份` });
  out.attachments = result.attachments;
  const name = `keystone-selected-${new Date().toISOString().slice(0, 10)}.json`;
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.json(out);
}));

/**
 * 导入备份（恢复后需重新解锁）
 * - 已初始化：必须已解锁才能导入（防止未授权覆盖）
 * - 未初始化（全新部署）：允许直接恢复备份，恢复后使用备份对应的主密码解锁
 */
app.post('/api/import', withVaultMaintenance(async (req, res) => {
  const unlocked = !!getSession(req);
  if (store.data.kdf && !unlocked) {
    return res.status(401).json({ error: '未解锁或会话已过期' });
  }
  const d = req.body;
  if (!d || typeof d !== 'object' ||
      !d.kdf || typeof d.kdf.salt !== 'string' || typeof d.kdf.verifier !== 'string' ||
      !Array.isArray(d.entries)) {
    return res.status(400).json({ error: '备份文件格式无效' });
  }
  for (const e of d.entries) {
    if (!e || typeof e.id !== 'string' || !e.fields || typeof e.fields !== 'object') {
      return res.status(400).json({ error: '备份文件格式无效' });
    }
  }

  // 附件是备份传输字段，不属于 vault.json；缺失或损坏时拒绝整份备份。
  const { attachments: embeddedAttachments, ...nextData } = d;
  if (embeddedAttachments !== undefined && (!embeddedAttachments || typeof embeddedAttachments !== 'object' || Array.isArray(embeddedAttachments))) {
    return res.status(400).json({ error: '备份附件格式无效' });
  }
  const refs = attachmentIds(nextData.entries);
  const files = new Map();
  for (const id of refs) {
    const b64 = embeddedAttachments?.[id];
    if (!/^[0-9a-fA-F-]{36}$/.test(id) || typeof b64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) {
      return res.status(400).json({ error: '备份缺少有效的附件文件，未修改当前密码库' });
    }
    const bytes = Buffer.from(b64, 'base64');
    if (bytes.length < 28 || bytes.toString('base64') !== b64) {
      return res.status(400).json({ error: '备份附件数据损坏，未修改当前密码库' });
    }
    files.set(id, bytes);
  }
  nextData.version = 1;
  if (!Array.isArray(nextData.categories)) {
    nextData.categories = [...new Set(nextData.entries.map((entry) => entry.category).filter(Boolean))];
  }
  const tx = crypto.randomUUID();
  const stage = `${ATTACH_DIR}.import-${tx}.next`;
  const previous = `${ATTACH_DIR}.import-${tx}.old`;
  let journalWritten = false;
  let dataCommitted = false;
  try {
    await fs.mkdir(stage, { recursive: true, mode: 0o700 });
    for (const [id, bytes] of files) await fs.writeFile(path.join(stage, `${id}.bin`), bytes, { mode: 0o600 });
    await fs.mkdir(ATTACH_DIR, { recursive: true, mode: 0o700 });
    const journal = { tx, oldDigest: vaultDigest(store.data), newDigest: vaultDigest(nextData) };
    await fs.writeFile(IMPORT_JOURNAL_FILE + '.tmp', JSON.stringify(journal), { mode: 0o600 });
    await fs.rename(IMPORT_JOURNAL_FILE + '.tmp', IMPORT_JOURNAL_FILE);
    journalWritten = true;
    await fs.rename(ATTACH_DIR, previous);
    await fs.rename(stage, ATTACH_DIR);
    await store.replace(nextData);
    dataCommitted = true;
    journal.committed = true;
    await fs.writeFile(IMPORT_JOURNAL_FILE + '.tmp', JSON.stringify(journal), { mode: 0o600 });
    await fs.rename(IMPORT_JOURNAL_FILE + '.tmp', IMPORT_JOURNAL_FILE);
  } catch (err) {
    if (dataCommitted) {
      vaultRecoveryNeeded = true;
      console.error('[import] 主数据已提交但恢复记录更新失败，需重启确认:', err.message);
      return res.status(500).json({ error: '导入提交中断，请重启服务完成恢复' });
    }
    try {
      if (journalWritten) await recoverImport();
      else await fs.rm(stage, { recursive: true, force: true });
    } catch (recoveryError) {
      vaultRecoveryNeeded = true;
      console.error('[import] 回滚失败，需重启恢复:', recoveryError.message);
      return res.status(500).json({ error: '导入中断，请重启服务完成恢复' });
    }
    console.error('[import] 导入失败:', err.message);
    return res.status(500).json({ error: '导入失败，当前密码库未变更' });
  }
  try {
    await fs.rm(previous, { recursive: true, force: true });
    await fs.rm(IMPORT_JOURNAL_FILE, { force: true });
  } catch (err) {
    console.warn('[import] 提交后清理失败，将在重启时继续:', err.message);
  }

  sessions.clear(); // 主密码/密钥可能已变化，强制重新解锁
  totpPending.clear();
  await clearPendingAttachments();
  await makeBackup(true);
  res.clearCookie('vsid', { path: '/' });
  res.json({ ok: true, message: '导入成功，请重新解锁', missingAttachments: 0 });
}));

// ---------------- 前端静态资源 ----------------
// HTML/JS/CSS 每次重新校验，防止浏览器缓存旧文件导致前后端文件混用
app.use(express.static(PUBLIC_DIR, {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
}));
app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

// ---------------- 错误处理 ----------------
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err instanceof multer.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE'
      ? `文件超过大小限制（${MAX_ATTACH_BYTES / 1024 / 1024}MB）`
      : '文件上传失败';
    return res.status(400).json({ error: msg });
  }
  console.error('[error]', req.method, req.path, err.message);
  res.status(500).json({ error: '服务器内部错误' });
});

// ---------------- 自动备份 ----------------
/** 自动备份使用与手动导出相同的完整密文格式，附件缺失时不覆盖旧备份。 */
async function makeBackup(force = false) {
  let tmp;
  try {
    if (vaultMaintenance && !force) return;
    await fs.mkdir(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 10);
    const out = structuredClone(store.data);
    out.attachments = {};
    const ids = new Set(out.entries.flatMap((entry) => (entry.attachments || []).map((att) => att.id)));
    for (const id of ids) {
      out.attachments[id] = (await fs.readFile(attachmentPath(id))).toString('base64');
    }
    tmp = path.join(BACKUP_DIR, `.vault-${stamp}-${crypto.randomUUID()}.tmp`);
    await fs.writeFile(tmp, JSON.stringify(out), { mode: 0o600 });
    await fs.rename(tmp, path.join(BACKUP_DIR, `vault-${stamp}.json`));
    const files = (await fs.readdir(BACKUP_DIR))
      .filter((f) => f.startsWith('vault-') && f.endsWith('.json'))
      .sort();
    for (const f of files.slice(0, Math.max(0, files.length - BACKUP_KEEP))) {
      await fs.unlink(path.join(BACKUP_DIR, f)).catch(() => {});
    }
    backupStatus.lastSuccess = Date.now();
    backupStatus.lastError = null;
  } catch (err) {
    console.warn('[backup] 自动备份失败:', err.message);
    backupStatus.lastError = '最近一次自动备份失败，请检查存储空间和附件文件';
    if (tmp) await fs.rm(tmp, { force: true }).catch(() => {});
  }
}

// ---------------- 启动 ----------------
(async () => {
  await resetVaultIfRequested();
  await store.load();
  await recoverImport();
  await cleanupStaleImportFiles();
  await recoverRekey();
  await cleanupStaleRekeyFiles();
  await cleanupOrphanAttachments(); // 清理失效的附件加密文件
  if (store.data.kdf) await makeBackup(); // 已有数据则启动时备份一次
  setInterval(() => { if (store.data.kdf) makeBackup(); }, 24 * 60 * 60 * 1000).unref(); // 每天备份
  app.listen(PORT, HOST, () => {
    console.log('=====================================');
    console.log('  Keystone 已启动');
    console.log(`  地址: http://${HOST}:${PORT}`);
    console.log(`  数据文件: ${DATA_FILE}`);
    console.log(`  闲置自动锁定: ${AUTO_LOCK_MS / 60_000} 分钟`);
    console.log('=====================================');
  });
})().catch((err) => {
  console.error('启动失败:', err.message);
  process.exit(1);
});
