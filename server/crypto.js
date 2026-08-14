'use strict';
/**
 * 密码学模块（全部使用 Node 内置 crypto，无第三方依赖）
 *
 * 设计：
 *  - 密钥派生：scrypt（内存困难型 KDF，N=2^17, r=8, p=1，约 128MiB 内存）
 *    —— 主密码不存储、不可恢复，只能通过暴力破解尝试，成本极高
 *  - 数据加密：AES-256-GCM 认证加密，每条数据使用独立随机 12 字节 IV，
 *    解密时校验认证标签，密文被篡改会立即发现
 *  - 验证机制：初始化时生成 32 字节随机令牌，用派生密钥加密后存储；
 *    解锁时派生密钥并尝试解密该令牌，解密成功 = 主密码正确，
 *    无需存储任何可被离线爆破的密码哈希
 */
const crypto = require('node:crypto');
const { promisify } = require('node:util');

const KEY_LEN = 32; // AES-256
const IV_LEN = 12; // GCM 推荐 nonce 长度
const TAG_LEN = 16; // GCM 认证标签长度

// scrypt 参数：N=2^17, r=8, p=1 → 内存约 128MiB
const SCRYPT_OPTIONS = Object.freeze({
  N: 131072,
  r: 8,
  p: 1,
  maxmem: 256 * 1024 * 1024, // 必须大于实际内存占用(128MiB)
});

// Node 24 已移除 crypto.scrypt 的无回调 Promise 形式，用 promisify 包装回调版
const scryptAsync = promisify(crypto.scrypt);

/**
 * 从主密码派生 256 位加密密钥
 * @param {string} password 主密码
 * @param {Buffer} salt 随机盐
 * @returns {Promise<Buffer>} 32 字节密钥
 */
async function deriveKey(password, salt) {
  return scryptAsync(Buffer.from(password, 'utf8'), salt, KEY_LEN, SCRYPT_OPTIONS);
}

/**
 * AES-256-GCM 加密
 * @param {Buffer} key 32 字节密钥
 * @param {string} plain 明文（UTF-8）
 * @returns {string} base64(iv || tag || ciphertext)
 */
function encrypt(key, plain) {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

/**
 * AES-256-GCM 解密；认证失败（密码错误或密文被篡改）时抛出异常
 * @param {Buffer} key
 * @param {string} b64 base64(iv || tag || ciphertext)
 * @returns {string} 明文
 */
function decrypt(key, b64) {
  const buf = Buffer.from(b64, 'base64');
  if (buf.length < IV_LEN + TAG_LEN) throw new Error('密文格式无效');
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

/**
 * 初始化：生成盐、派生密钥、创建验证令牌
 * @param {string} password 主密码
 * @returns {Promise<{salt: string, verifier: string, key: Buffer}>}
 */
async function createVault(password) {
  const salt = crypto.randomBytes(16);
  const key = await deriveKey(password, salt);
  const token = crypto.randomBytes(32);
  const verifier = encrypt(key, token);
  return { salt: salt.toString('base64'), verifier, key };
}

/**
 * 解锁：派生密钥并验证主密码
 * @param {string} password
 * @param {{salt: string, verifier: string}} kdf 存储的密钥派生信息
 * @returns {Promise<Buffer>} 验证通过返回密钥；密码错误抛出异常
 */
async function unlockVault(password, kdf) {
  const key = await deriveKey(password, Buffer.from(kdf.salt, 'base64'));
  decrypt(key, kdf.verifier); // 解密失败即抛错
  return key;
}

module.exports = { deriveKey, encrypt, decrypt, createVault, unlockVault };
