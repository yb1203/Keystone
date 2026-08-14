'use strict';
/**
 * TOTP 两步验证模块（零依赖，基于 Node 内置 crypto）
 *
 *  - TOTP：RFC 6238，HMAC-SHA1，30 秒周期，6 位数字（与 Google Authenticator 等兼容）
 *  - 密钥：160 位随机，base32 编码（RFC 4648），可由身份验证器 App 手动输入
 *  - 验证容差：允许当前/前后各 1 个周期（±30 秒），容忍时钟偏移
 *  - 恢复码：启用时生成 8 个一次性恢复码，SHA-256 加盐哈希存储，
 *    用于丢失验证器时解锁；每个恢复码只能使用一次
 */
const crypto = require('node:crypto');

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const PERIOD_SECONDS = 30;
const DIGITS = 6;
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉易混淆的 0/O/1/I

/** base32 编码（无填充） */
function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** base32 解码（容忍小写与空格） */
function base32Decode(s) {
  const clean = String(s).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** 生成 160 位随机密钥（base32 字符串） */
function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

/** 计算指定计数器的 TOTP 码（HMAC-SHA1） */
function totpAt(secretB32, counter) {
  const secret = base32Decode(secretB32);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', secret).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3];
  return String(bin % 10 ** DIGITS).padStart(DIGITS, '0');
}

/**
 * 校验 TOTP 码
 * @param {string} secretB32
 * @param {string} code 用户输入（容忍空格）
 * @param {object} [opts] { window=1, now=Date.now() }
 */
function verifyTotp(secretB32, code, opts = {}) {
  const window = opts.window ?? 1;
  const now = opts.now ?? Date.now();
  const c = String(code ?? '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(c)) return false;
  try {
    const counter = Math.floor(now / 1000 / PERIOD_SECONDS);
    for (let i = -window; i <= window; i++) {
      if (totpAt(secretB32, counter + i) === c) return true;
    }
  } catch {
    return false;
  }
  return false;
}

/** 生成恢复码（格式 XXXX-XXXX-XXXX-XXXX） */
function generateRecoveryCodes(count = 8) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    let code = '';
    for (let j = 0; j < 16; j++) {
      if (j > 0 && j % 4 === 0) code += '-';
      code += RECOVERY_ALPHABET[crypto.randomInt(RECOVERY_ALPHABET.length)];
    }
    codes.push(code);
  }
  return codes;
}

/** 恢复码加盐哈希（存储用，不可逆；与校验使用相同的规范化：大写、去空格与连字符） */
function hashRecoveryCode(code) {
  const normalized = String(code).toUpperCase().replace(/[\s-]/g, '');
  const salt = crypto.randomBytes(16);
  const hash = crypto.createHash('sha256').update(salt).update(normalized).digest('hex');
  return { salt: salt.toString('base64'), hash };
}

/** 校验恢复码（规范化：大写、去空格与连字符） */
function matchesRecoveryCode(code, entry) {
  const normalized = String(code).toUpperCase().replace(/[\s-]/g, '');
  const h = crypto.createHash('sha256')
    .update(Buffer.from(entry.salt, 'base64'))
    .update(normalized)
    .digest();
  const expected = Buffer.from(entry.hash, 'hex');
  return h.length === expected.length && crypto.timingSafeEqual(h, expected);
}

/** 生成 otpauth URI（供身份验证器添加；algorithm/digits/period 省略=默认 SHA1/6位/30秒） */
function otpauthUri(secretB32, label = 'Keystone', issuer = 'Keystone') {
  const params = new URLSearchParams({ secret: secretB32, issuer });
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}

module.exports = {
  generateSecret,
  verifyTotp,
  generateRecoveryCodes,
  hashRecoveryCode,
  matchesRecoveryCode,
  otpauthUri,
};
