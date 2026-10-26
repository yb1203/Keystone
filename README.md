# 🔐 Keystone

极简、私密的个人密码管理器。**Docker 一键部署**，服务端加密，自托管 —— 所有数据都掌握在你自己手里。

> Keystone（拱心石）：建筑里承重的那块中心石。你的主密码，就是撑起整个密码库的拱心石。

## ✨ 功能

**条目管理**
- 🔒 **服务端加密**：主密码 → scrypt 派生密钥 → AES-256-GCM 加密敏感字段；密钥仅存在于服务器内存，重启即自动锁定
- 🃏 **卡片式首页**：分类筛选、收藏、搜索（命中高亮）、排序（最近更新/名称/创建时间）
- 📝 **自定义字段**：字段名+值完全自定义，类型可选 **文本/密码/网址/数字/布尔/日期/邮箱**
- 📌 **卡片配置**：字段可置顶到首页卡片（最多 4 条，可展开全部）、可开关复制按钮
- — **分割线分组**：多个同类型账号（如 3 个 QQ）可用分割线在卡片上分组显示
- 🏷 **分类管理**：完全手动创建，支持重命名（自动同步条目）、删除、标签云展示
- 🖼 **图标**：上传图片作为卡片图标（自动压缩，未设置则显示分类色首字）
- 📎 **附件**：上传证件/截图等，加密存储，支持图片/PDF/文本**预览**
- 🎲 **密码生成器**、一键复制、自动锁定
- 🩺 **密码健康**：解锁后在浏览器内检查重复使用和明显薄弱的密码，不上传给第三方

**安全**
- 🔑 **两步验证（TOTP）**：可选开启，解锁需主密码 + 动态验证码，带 8 个一次性恢复码，扫码添加
- 🔑 **修改主密码**：全量重加密（含附件），其他已打开的会话会立即锁定，避免旧密钥继续写入
- 🛡 **解锁限流**：连错 5 次封禁 1 分钟
- 🛡 **主密码建议**：新建和修改至少 8 位，建议使用 15 位以上的独特密码短语
- ⏱ **自动锁定时长**：设置页可调（1~240 分钟）

**备份**
- 💾 **导出/导入**：单文件加密备份（含条目、附件、图标、两步验证配置），全新部署可直接恢复
- 💾 **自动备份**：每天将条目和加密附件一起备份到 `data/backups/`，保留最近 7 份
- 💾 **完整性检查**：附件缺失时拒绝导出或导入不完整备份；设置页显示最近完整备份与附件状态

**可靠性**
- 🔄 **安全导入**：恢复附件后不在 `vault.json` 重复保存附件内容，避免数据文件与自动备份膨胀
- 🧩 **恢复保护**：主数据文件缺失或损坏时，自动尝试使用 `.bak` 备份恢复
- 🧩 **导入保护**：先校验并暂存附件，再切换数据；导入中断时重启可恢复到一致状态
- ⏱ **可靠自动锁定**：后台状态检查不会延长会话；闲置时间达到设置值后服务端会锁定

## 🚀 快速开始（Docker 部署）

### Docker Compose 直接部署

在任何 Docker Compose 管理界面中创建项目，项目名称填写 `keystone`，将以下内容直接粘贴为 `docker-compose.yml` 后启动：

```yaml
services:
  keystone:
    build:
      context: https://github.com/yb1203/Keystone.git#main
    image: keystone:latest
    container_name: keystone
    ports:
      - "3000:3000"
    environment:
      VAULT_AUTO_LOCK_MINUTES: "30"
      VAULT_UNLOCK_MAX_ATTEMPTS: "5"
      VAULT_UNLOCK_LOCKOUT_SECONDS: "60"
      VAULT_ATTACH_MAX_MB: "20"
      VAULT_BACKUP_KEEP: "7"
      # 忘记主密码时，改成新的非空值后重新部署一次即可清空密码库。
      # 同一个值只会生效一次；留空表示不重置。
      VAULT_RESET_TOKEN: ""
      VAULT_HTTPS: "false"
      VAULT_TRUST_PROXY: "false"
    volumes:
      - vault-data:/app/data
    restart: unless-stopped

volumes:
  vault-data:
```

启动后访问 `http://服务器IP:3000`。若端口已被占用，将 `"3000:3000"` 改成 `"3001:3000"`。同一份配置也保存在 [docker-compose.yml](docker-compose.yml)。

> **从旧版本升级：** 如果你此前使用的是未声明 `vault-data` 的旧 Compose 配置，请在替换为新版配置前，先通过界面「导出」保存加密备份。新版会使用命名卷保存数据；部署完成后可在首次初始化页面选择「从备份恢复」。旧匿名卷不会被主动删除，但不会自动挂载到新版服务。

### 在线命令部署（Linux 服务器）

服务器已安装并启动 Docker、Docker Compose v2 与 Git 后，在准备部署的目录执行：

```bash
curl -fsSL https://raw.githubusercontent.com/yb1203/Keystone/main/scripts/install.sh | bash
```

脚本会克隆项目到当前目录的 `keystone/`，构建并启动服务。访问 `http://服务器IP:3000` 完成首次初始化。需要指定目录时：

```bash
curl -fsSL https://raw.githubusercontent.com/yb1203/Keystone/main/scripts/install.sh | KEYSTONE_INSTALL_DIR=/srv/keystone bash
```

再次执行同一条命令即可拉取最新代码并更新容器；脚本发现未提交的本地改动时会停止，不会覆盖它们。

### 手动部署

```bash
# 1. 构建并启动（Docker Compose 会从 GitHub 获取构建代码）
docker compose up -d --build --remove-orphans

# 2. 打开浏览器
#    http://你的服务器IP:3000

# 3. 首次访问设置主密码
#    ⚠️ 主密码无法找回，务必牢记！忘记 = 数据永久丢失
```

数据保存在 Docker 卷 `vault-data` 中（`/app/data/`），更新或重建容器不会丢失。删除容器前请先导出加密备份。

**忘记主密码并需要重新开始：** 无需进入服务器找文件。将 Compose 里的 `VAULT_RESET_TOKEN` 改成一个新的非空值，例如 `reset-20261026`，重新部署一次即可清空密码库并回到首次初始化。相同令牌只会执行一次，重置完成后可改回空值。

默认可通过 HTTP 在本机或可信内网使用；非本机 HTTP 访问会显示持续提醒。**公网访问必须加 HTTPS**：先用 Caddy / Nginx 配置证书并反代到 3000 端口，在 Compose 中设置 `VAULT_TRUST_PROXY=true`，然后从 HTTPS 地址打开 Keystone，在「设置 → 连接安全」开启「仅允许 HTTPS 访问」。此项会保存到密码库，重启容器后仍生效；开启后 HTTP 请求将被拒绝。反代应阻止外部直接访问 3000 端口，且仅在可信反代后使用 `VAULT_TRUST_PROXY=true`。设置页不会自动申请证书。

若反向代理与 Compose 运行在同一台主机，可将端口映射改为 `127.0.0.1:3000:3000`，让代理访问本机 3000；若代理也是容器，请只通过内部 Docker 网络连接 Keystone，移除对外的 `ports`。**不要在启用 `VAULT_TRUST_PROXY=true` 时仍将 3000 端口暴露给外部**，否则直连请求可以伪造代理头，绕过 HTTPS 检查。

## 💻 本地运行

需要 Node.js 20+：

```bash
npm install
npm start          # 默认 http://localhost:3000
```

## ⚙️ 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `3000` | 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `DATA_DIR` | `./data` | 数据目录（vault.json + attachments/ + backups/） |
| `VAULT_AUTO_LOCK_MINUTES` | `30` | 闲置自动锁定默认值（分钟，设置页可改） |
| `VAULT_UNLOCK_MAX_ATTEMPTS` | `5` | 解锁最大失败次数 |
| `VAULT_UNLOCK_LOCKOUT_SECONDS` | `60` | 失败封禁时长（秒） |
| `VAULT_ATTACH_MAX_MB` | `20` | 单个附件大小上限（MB） |
| `VAULT_BACKUP_KEEP` | `7` | 自动备份保留份数 |
| `VAULT_BACKUP_DIR` | `DATA_DIR/backups` | 自动备份目录；可挂载到独立磁盘或卷 |
| `VAULT_RESET_TOKEN` | 空 | 改为新的非空值并重启时清空密码库；相同值只执行一次 |
| `VAULT_HTTPS` | `false` | 兼容旧部署：强制 Cookie Secure；通常改用设置页「仅允许 HTTPS」即可 |
| `VAULT_TRUST_PROXY` | `false` | 仅在可信反代后设为 `true`，使服务识别 HTTPS 和真实客户端 IP；须阻止直连 3000 端口 |

## 🛡 安全模型

| 威胁 | 防护 |
|---|---|
| 数据文件被拷贝 | 标题、字段、两步验证密钥与附件内容均以 AES-256-GCM 加密 |
| 离线暴力破解 | scrypt（128MiB 内存成本）+ 认证加密 |
| 网络嗅探 | 生产必须 HTTPS |
| 暴力破解解锁 | 限流：5 次失败封禁 1 分钟 |
| 主密码泄露 | 可选两步验证（TOTP） |
| 浏览器 XSS | 输出全量转义 + CSP 头 |
| 上传恶意文件 | 附件加密存储、强制下载不内联、预览限制类型 |

**架构说明**：本项目是"服务端加密"架构，不是浏览器端零知识架构。主密码在解锁时发送给服务器，解密密钥存在于服务器内存。服务器被完全攻破时，解锁状态下可读取明文（与 Bitwarden 的浏览器端加密不同）。分类、收藏状态、时间、图标和附件名称等元数据为明文，以支持筛选和展示；对隐私要求极高的场景请勿存储可识别信息。

**部署安全清单**
- [ ] 公网访问必须 HTTPS（配置可信反代和证书，启用 `VAULT_TRUST_PROXY=true`，再在设置页开启「仅允许 HTTPS」）
- [ ] 主密码至少 8 位，建议 15 位以上的独特密码短语；不必刻意凑大小写和符号
- [ ] 建议不要存银行卡密码 / CVV（合规风险）
- [ ] 定期导出加密备份到离线位置

## 🧪 测试

```bash
npm test                  # 自包含 API 全流程测试（含 Compose 重置令牌，使用临时服务与临时数据目录）
npm run test:static       # 前端静态检查与运行时初始化检查
```

覆盖：初始化、中文数据往返、自定义字段（类型/置顶/复制/分割线）、分类管理、锁定解锁、限流、TOTP、附件、待绑定附件、修改主密码、旧会话失效、批量导出、备份完整性、导入中断恢复、设置、导入导出（含旧版格式兼容、图标保留）。

其他测试脚本（`tests/`）：
- `restore.mjs`：全新部署恢复备份的端到端验证
- `migrate.mjs`：旧数据迁移验证（分 3 步，见文件注释）
- `ui-test.mjs`：浏览器 UI 自动化（需本机 Chrome）
- `runtime-check.mjs` / `html-check.mjs`：前端静态体检（已支持跨平台路径）

## 💾 数据备份

- **推荐：界面「导出」** → 下载单个加密备份文件（**含条目、附件、图标、两步验证配置**，不含主密码），存到安全位置；这是包含附件的完整备份
- **恢复**：已初始化时顶栏「导入」（有覆盖确认）；**全新部署**时创建界面点「已有备份？从备份恢复」
- 恢复后请用**备份对应的主密码**解锁
- 服务端启动时和每天自动备份一份完整密文 JSON（包含加密附件）到 `data/backups/`，保留最近 7 份（可配 `VAULT_BACKUP_KEEP`）。默认备份仍在同一个 Docker 数据卷内，不能防范磁盘或数据卷丢失；请定期使用界面导出并存到其他设备，或将 `VAULT_BACKUP_DIR` 挂载到独立存储。

## 📁 项目结构

```
├── docker-compose.yml   # Docker 编排
├── Dockerfile           # node:24-alpine 极简镜像（非 root 运行）
├── server/
│   ├── index.js         # Express 服务 + 全部 API
│   ├── crypto.js        # scrypt + AES-256-GCM
│   ├── totp.js          # TOTP 两步验证 + 恢复码
│   └── store.js         # JSON 文件存储（原子写入 + .bak 回退）
├── public/              # 前端（原生 JS，无构建）
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   └── vendor/qrcode.js # 二维码生成库（本地生成，密钥不出浏览器）
├── scripts/
│   └── install.sh        # Linux 在线部署与更新脚本
└── tests/               # 自动化测试
```

## ❓ 常见问题

**忘记主密码怎么办？**
无法找回，只能删除数据重新初始化。这是设计如此 —— 服务器端不存储任何可恢复主密码的信息。

**可以多用户使用吗？**
不能。这是个人单用户工具。多人场景请用 Vaultwarden / Bitwarden。

**为什么不用数据库？**
单用户个人场景 JSON 文件 + 原子写入完全够用，换来零原生依赖、镜像极小、备份就是复制文件。

**忘记验证器 App 怎么办？**
用启用两步验证时保存的**恢复码**解锁（每个只能用一次）；恢复码也丢了只能删除数据重来。
