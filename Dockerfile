# --- builder ---
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# --- runtime ---
FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    LOG_LEVEL=info \
    PROFILE_DIR=/data/profiles \
    OUTPUT_DIR=/data/output \
    CLOAK_HEADLESS=true

# Alpine 系统依赖（Playwright 运行所需）
RUN apk add --no-cache \
      chromium \
      nss \
      freetype \
      harfbuzz \
      ca-certificates \
      ttf-freefont

WORKDIR /app
COPY --from=builder /app/package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --from=builder /app/dist ./dist

# 数据目录（profile 与抓取产物）通过 volume 挂载持久化
VOLUME ["/data"]
EXPOSE 5510

# 默认启动 HTTP 模式；若要切到 MCP stdio：command: ["node","dist/mcp/mcp.stdio.js"]
CMD ["node", "dist/main.js"]
