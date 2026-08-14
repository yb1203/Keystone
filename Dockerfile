# Keystone - 生产镜像（node:24-alpine，极简无编译依赖）
FROM node:24-alpine

ENV NODE_ENV=production
WORKDIR /app

# 先装依赖（利用 Docker 层缓存）
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

# 拷贝应用代码
COPY server ./server
COPY public ./public

# 以非 root 用户运行（纵深防御：即使容器被攻破，也不直接获得 root 权限）
RUN mkdir -p /app/data && chown -R node:node /app && chmod -R g-w /app/data
USER node

# 数据卷：所有数据（vault.json 及备份）都保存在这里
VOLUME ["/app/data"]

ENV PORT=3000
ENV HOST=0.0.0.0
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server/index.js"]
