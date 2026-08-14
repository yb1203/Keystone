'use strict';
/**
 * 数据存储模块
 *
 * 整个 Keystone 就是一个 JSON 文件（vault.json），结构：
 * {
 *   "version": 1,
 *   "kdf": { "salt": "...", "verifier": "...", "createdAt": 1234567890 },
 *   "entries": [
 *     {
 *       "id": "uuid",
 *       "category": "社交",          // 明文（仅用于分类筛选）
 *       "favorite": false,          // 明文（仅用于收藏筛选）
 *       "createdAt": 1234567890,
 *       "updatedAt": 1234567890,
 *       "fields": {                 // 全部加密：base64(iv||tag||ct)
 *         "title": "...", "account": "...", "password": "...",
 *         "url": "...", "note": "..."
 *       }
 *     }
 *   ]
 * }
 *
 * 写入采用「临时文件 + 原子重命名」，且每次覆盖前自动保留一份 .bak，
 * 即使中途断电也不会损坏主文件；主文件损坏时自动回退到 .bak。
 * 备份 = 直接复制这一个文件。
 */
const fs = require('node:fs/promises');
const path = require('node:path');

const DEFAULT_DATA = Object.freeze({ version: 1, kdf: null, categories: [], entries: [] });

class VaultStore {
  constructor(filePath) {
    this.file = filePath;
    this.data = structuredClone(DEFAULT_DATA);
    this._chain = Promise.resolve(); // 写入串行队列，避免并发覆盖
  }

  /** 读取数据文件；不存在则保持默认空库 */
  async load() {
    let raw = await this._readOrNull(this.file);
    if (raw === null) return;

    let parsed = this._parse(raw);
    if (parsed === null) {
      // 主文件损坏，尝试回退备份
      const bak = await this._readOrNull(this.file + '.bak');
      if (bak !== null) parsed = this._parse(bak);
      if (parsed === null) {
        throw new Error(
          `数据文件损坏且无法从备份恢复：${this.file}\n` +
          '请手动检查文件或恢复之前的备份，服务已停止以免覆盖数据。'
        );
      }
      console.warn('[vault] 主数据文件损坏，已从 .bak 备份恢复');
    }
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.entries)) {
      throw new Error(`数据文件格式无效：${this.file}`);
    }
    this._backfill(parsed);
    this.data = parsed;
  }

  /** 排队保存（原子写入 + 保留 .bak） */
  save() {
    this._chain = this._chain.then(() => this._saveNow());
    return this._chain;
  }

  /** 整体替换数据（导入备份用），保存成功后生效 */
  async replace(newData) {
    const clone = structuredClone(newData);
    clone.version = 1;
    this._backfill(clone); // 兼容旧备份：缺少 categories 时从条目回填
    await this._saveNow(clone); // 先落盘，成功后才切换内存
    this.data = clone;
  }

  /** 兼容旧版本数据：确保 categories 存在，缺失时从已有条目回填 */
  _backfill(data) {
    if (!Array.isArray(data.categories)) {
      data.categories = [...new Set(data.entries.map((e) => e.category).filter(Boolean))];
    }
  }

  async _saveNow(data = this.data) {
    const dir = path.dirname(this.file);
    await fs.mkdir(dir, { recursive: true });
    const json = JSON.stringify(data, null, 2);
    const tmp = this.file + '.tmp';
    await fs.writeFile(tmp, json, 'utf8');
    try {
      await fs.copyFile(this.file, this.file + '.bak'); // 保留上一个好版本
    } catch { /* 首次保存没有旧文件，忽略 */ }
    await fs.rename(tmp, this.file);
  }

  async _readOrNull(p) {
    try {
      return await fs.readFile(p, 'utf8');
    } catch {
      return null;
    }
  }

  _parse(raw) {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
}

module.exports = { VaultStore };
