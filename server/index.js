'use strict';
/**
 * Keystone - 后端服务
 *
 * 极简零知识架构：
 *  - 首次访问创建主密码，服务端只保存 scrypt 盐和加密验证令牌
 *  - 解锁时用主密码派生密钥，密钥仅保存在服务器内存（按会话），重启即丢失 → 回到锁定态
 *  - 所有条目字段 AES-256-GCM 加密后才落盘，数据库/数据文件泄露也只是密文
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
const BACKUP_DIR = path.join(DATA_DIR, 'backups'); // 自动备份目录
const BACKUP_KEEP = Number(process.env.VAULT_BACKUP_KEEP) || 7; // 自动备份保留份数
const MAX_ATTACH_BYTES = (Number(process.env.VAULT_ATTACH_MAX_MB) || 20) * 1024 * 1024; // 单文件上限（默认 20MB）

// HTTPS 部署模式：开启后 Cookie 加 Secure 标志并启用 HSTS（必须走 TLS 反向代理）
const SECURE_MODE = process.env.VAULT_HTTPS === 'true';
// 部署在反向代理后面时开启，解锁限流才能看到真实客户端 IP
if (process.env.VAULT_TRUST_PROXY === 'true') app.set('trust proxy', 1);

// 附件上传：内存暂存（上限 20MB），文件名由服务端 UUID 生成，杜绝路径穿越
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ATTACH_BYTES },
});

// ---------------- 基础 ----------------
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '200mb' })); // 备份可能内嵌附件(base64)，放宽体积限制
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: blob:; connect-src 'self' blob:; frame-src 'self' blob:; " +
    "object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
  if (SECURE_MODE) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store'); // 敏感响应禁止缓存
  next();
});

const store = new VaultStore(DATA_FILE);

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

// ---------------- 会话工具 ----------------
function parseCookies(req) {
  const out = {};
  const h = req.headers.cookie;
  if (!h) return out;
  for (const part of h.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** 当前生效的自动锁定毫秒数（设置页可覆盖环境变量默认值） */
function currentAutoLockMs() {
  const m = Number(store.data.settings?.autoLockMinutes);
  return (Number.isFinite(m) && m >= 1 && m <= 240 ? m : Number(process.env.VAULT_AUTO_LOCK_MINUTES) || 30) * 60_000;
}

function getSession(req) {
  const sid = parseCookies(req).vsid;
  if (!sid) return null;
  const s = sessions.get(sid);
  if (!s) return null;
  if (Date.now() - s.lastActive > currentAutoLockMs()) {
    sessions.delete(sid); // 闲置超时自动锁定
    return null;
  }
  s.lastActive = Date.now(); // 滑动续期
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
function ensureCategory(name) {
  if (name && !store.data.categories.includes(name)) {
    store.data.categories.push(name);
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
async function writeAttachment(key, attId, data) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  await fs.mkdir(ATTACH_DIR, { recursive: true });
  await fs.writeFile(path.join(ATTACH_DIR, attId + '.bin'), Buffer.concat([iv, tag, ct]));
}

/** 解密读取附件内容；文件损坏时抛出异常 */
async function readAttachment(key, attId) {
  const buf = await fs.readFile(path.join(ATTACH_DIR, attId + '.bin'));
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

/** 删除附件文件（尽力而为，文件不存在不报错） */
async function removeAttachmentFile(attId) {
  try { await fs.unlink(path.join(ATTACH_DIR, attId + '.bin')); } catch { /* 忽略 */ }
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

// ---------------- API ----------------
app.get('/api/health', (req, res) => res.json({ ok: true, uptime: process.uptime() }));

app.get('/api/state', (req, res) => {
  res.json({
    setup: !!store.data.kdf,
    unlocked: !!getSession(req),
    autoLockMinutes: currentAutoLockMs() / 60_000,
    totpEnabled: !!totpEnabled(),
  });
});

/** 读取设置 */
app.get('/api/settings', auth, (req, res) => {
  res.json({ autoLockMinutes: currentAutoLockMs() / 60_000 });
});

/** 保存设置（自动锁定时长，分钟） */
app.post('/api/settings', auth, h(async (req, res) => {
  const m = Number(req.body?.autoLockMinutes);
  if (!Number.isFinite(m) || m < 1 || m > 240) {
    return res.status(400).json({ error: '自动锁定时长需在 1~240 分钟之间' });
  }
  store.data.settings = { ...(store.data.settings || {}), autoLockMinutes: Math.round(m) };
  await store.save();
  res.json({ ok: true, autoLockMinutes: currentAutoLockMs() / 60_000 });
}));

/** 首次初始化：创建主密码 */
app.post('/api/setup', h(async (req, res) => {
  if (store.data.kdf) return res.status(409).json({ error: 'Keystone 已初始化，不能重复创建' });
  const pw = String(req.body?.password ?? '');
  if (pw.length < 8) return res.status(400).json({ error: '主密码至少需要 8 位' });
  if (pw.length > 200) return res.status(400).json({ error: '主密码过长' });

  const { salt, verifier, key } = await createVault(pw);
  store.data.kdf = { salt, verifier, createdAt: Date.now() };
  await store.save();

  const sid = crypto.randomBytes(24).toString('base64url');
  sessions.set(sid, { key, lastActive: Date.now() });
  res.cookie('vsid', sid, { httpOnly: true, sameSite: 'strict', path: '/', secure: SECURE_MODE });
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
  let key;
  try {
    key = await unlockVault(pw, store.data.kdf);
  } catch {
    return fail('主密码错误');
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
  res.cookie('vsid', sid, { httpOnly: true, sameSite: 'strict', path: '/', secure: SECURE_MODE });
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

/** 用新密钥重加密一个条目（兼容旧版对象格式字段，顺带升级为新格式） */
function reencryptEntry(entry, oldKey, newKey) {
  let title = entry.title ? decrypt(oldKey, entry.title) : decrypt(oldKey, entry.fields?.title);
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
  entry.title = encrypt(newKey, title);
  if (entry.subtitle) entry.subtitle = encrypt(newKey, decrypt(oldKey, entry.subtitle));
  entry.fields = fields.map((f) => ({
    n: encrypt(newKey, f.name),
    t: encrypt(newKey, f.type),
    v: encrypt(newKey, f.value),
    p: encrypt(newKey, f.pinned ? '1' : '0'),
    c: encrypt(newKey, f.copyable === false ? '0' : '1'),
  }));
}

/** 修改主密码：验证旧密码 → 派生新密钥 → 全量重加密（条目/附件/两步验证） */
app.post('/api/password', auth, h(async (req, res) => {
  const oldPw = String(req.body?.oldPassword ?? '');
  const newPw = String(req.body?.newPassword ?? '');
  if (newPw.length < 8) return res.status(400).json({ error: '新主密码至少需要 8 位' });
  if (newPw.length > 200) return res.status(400).json({ error: '新主密码过长' });
  try {
    await unlockVault(oldPw, store.data.kdf); // 验证旧密码（失败即抛错）
  } catch {
    return res.status(400).json({ error: '旧主密码错误' });
  }
  const oldKey = req.session.key;

  // 预检：所有条目必须能完整解密，避免重加密中途失败导致数据不一致
  for (const entry of store.data.entries) {
    try {
      reencryptEntry(entry, oldKey, oldKey); // 用旧密钥"重加密"＝只读校验（顺带升级旧格式）
    } catch {
      return res.status(500).json({ error: '数据异常（存在损坏条目），无法修改主密码' });
    }
  }

  // 派生新密钥（新盐）
  const salt = crypto.randomBytes(16);
  const newKey = await deriveKey(newPw, salt);

  // 重加密所有条目（含旧版格式自动升级）
  for (const entry of store.data.entries) reencryptEntry(entry, oldKey, newKey);

  // 重加密附件文件（含待绑定附件）
  const reencryptFile = async (id) => {
    try {
      const plain = await readAttachment(oldKey, id);
      await writeAttachment(newKey, id, plain);
    } catch { /* 文件缺失/损坏则跳过 */ }
  };
  for (const entry of store.data.entries) {
    for (const att of entry.attachments || []) await reencryptFile(att.id);
  }
  for (const [, p] of pendingAtts) {
    for (const att of p.items.values()) await reencryptFile(att.id);
  }

  // 重加密两步验证密钥
  if (store.data.security?.totp?.secret) {
    store.data.security.totp.secret = encrypt(newKey, decrypt(oldKey, store.data.security.totp.secret));
  }

  // 更换盐与验证令牌
  const token = crypto.randomBytes(32);
  store.data.kdf = { salt: salt.toString('base64'), verifier: encrypt(newKey, token), createdAt: Date.now() };
  await store.save();

  // 当前会话无缝切换到新密钥（无需重新解锁）
  const s = sessions.get(req.session.sid);
  if (s) s.key = newKey;
  req.session.key = newKey;

  res.json({ ok: true, message: '主密码已修改' });
}));

/** 读取全部条目（服务端解密后返回） */
app.get('/api/entries', auth, (req, res) => {
  const key = req.session.key;
  const entries = [];
  for (const e of store.data.entries) {
    try {
      entries.push(toClient(e, key));
    } catch {
      console.warn(`[vault] 条目 ${e.id} 解密失败，已跳过（可能是损坏的备份）`);
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

  ensureCategory(category); // 新分类自动注册
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
  if (Array.isArray(body.attachIds) && pending) {
    entry.attachments = [];
    for (const id of body.attachIds) {
      const att = pending.items.get(id);
      if (att) {
        entry.attachments.push(att);
        pending.items.delete(id);
      }
    }
  }
  store.data.entries.push(entry);
  await store.save();
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

  ensureCategory(category); // 新分类自动注册
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
  if (body.fields !== undefined) { // 未传 fields 时保留原字段（兼容）
    const { fields, error } = parseFields(body.fields);
    if (error) return res.status(400).json({ error });
    entry.fields = encryptFields(fields ?? [], req.session.key);
  }
  await store.save();
  res.json({ entry: toClient(entry, req.session.key) });
}));

/** 删除条目（连同其附件文件） */
app.delete('/api/entries/:id', auth, h(async (req, res) => {
  const idx = store.data.entries.findIndex((e) => e.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '条目不存在' });
  const [removed] = store.data.entries.splice(idx, 1);
  for (const a of removed.attachments || []) await removeAttachmentFile(a.id); // 级联删除附件
  await store.save();
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
  found.entry.attachments = (found.entry.attachments || []).filter((a) => a.id !== found.att.id);
  await removeAttachmentFile(found.att.id);
  await store.save();
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

/** 导出加密备份（原始密文，不含主密码；附件加密文件以 base64 内嵌，单文件完整备份） */
app.get('/api/export', auth, h(async (req, res) => {
  const out = structuredClone(store.data);
  out.attachments = {};
  const ids = new Set();
  for (const e of out.entries) for (const a of e.attachments || []) ids.add(a.id);
  for (const id of ids) {
    try {
      const buf = await fs.readFile(path.join(ATTACH_DIR, id + '.bin'));
      out.attachments[id] = buf.toString('base64');
    } catch { /* 文件缺失则跳过 */ }
  }
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
  out.attachments = {};
  for (const e of out.entries) {
    for (const a of e.attachments || []) {
      try {
        const buf = await fs.readFile(path.join(ATTACH_DIR, a.id + '.bin'));
        out.attachments[a.id] = buf.toString('base64');
      } catch { /* 文件缺失则跳过 */ }
    }
  }
  const name = `keystone-selected-${new Date().toISOString().slice(0, 10)}.json`;
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.json(out);
}));

/**
 * 导入备份（恢复后需重新解锁）
 * - 已初始化：必须已解锁才能导入（防止未授权覆盖）
 * - 未初始化（全新部署）：允许直接恢复备份，恢复后使用备份对应的主密码解锁
 */
app.post('/api/import', h(async (req, res) => {
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

  // 还原备份内嵌的附件加密文件（id 校验为 UUID，防止路径穿越）
  if (d.attachments && typeof d.attachments === 'object') {
    await fs.mkdir(ATTACH_DIR, { recursive: true });
    for (const [id, b64] of Object.entries(d.attachments)) {
      if (!/^[0-9a-fA-F-]{36}$/.test(id) || typeof b64 !== 'string') continue;
      try {
        await fs.writeFile(path.join(ATTACH_DIR, id + '.bin'), Buffer.from(b64, 'base64'));
      } catch { /* 忽略损坏的附件数据 */ }
    }
  }
  await store.replace(d);

  // 统计备份引用的附件在本机是否缺失（附件文件不包含在备份 JSON 里）
  const refIds = new Set();
  for (const e of d.entries) for (const a of e.attachments || []) refIds.add(a.id);
  let missing = 0;
  for (const id of refIds) {
    try { await fs.access(path.join(ATTACH_DIR, id + '.bin')); } catch { missing++; }
  }

  sessions.clear(); // 主密码/密钥可能已变化，强制重新解锁
  res.clearCookie('vsid', { path: '/' });
  res.json({ ok: true, message: '导入成功，请重新解锁', missingAttachments: missing });
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
/** 复制一份当前数据文件到 backups 目录，保留最近 BACKUP_KEEP 份 */
async function makeBackup() {
  try {
    await fs.mkdir(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 10);
    await fs.copyFile(DATA_FILE, path.join(BACKUP_DIR, `vault-${stamp}.json`));
    const files = (await fs.readdir(BACKUP_DIR))
      .filter((f) => f.startsWith('vault-') && f.endsWith('.json'))
      .sort();
    for (const f of files.slice(0, Math.max(0, files.length - BACKUP_KEEP))) {
      await fs.unlink(path.join(BACKUP_DIR, f)).catch(() => {});
    }
  } catch (err) {
    console.warn('[backup] 自动备份失败:', err.message);
  }
}

// ---------------- 启动 ----------------
(async () => {
  await store.load();
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
