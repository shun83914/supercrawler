# --- builder ---
FROM node:20-bookworm-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# --- runtime ---
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production \
    LOG_LEVEL=info \
    PROFILE_DIR=/data/profiles \
    OUTPUT_DIR=/data/output \
    CLOAK_HEADLESS=true

# CloakBrowser/Playwright 运行时所需的系统依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates fonts-liberation libnss3 libatk1.0-0 libatk-bridge2.0-0 \
      libcups2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
      libgbm1 libdrm2 libpango-1.0-0 libcairo2 libasound2 libxshmfence1 \
      tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --from=builder /app/dist ./dist

# 数据目录（profile 与抓取产物）通过 volume 挂载持久化
VOLUME ["/data"]
EXPOSE 5510

ENTRYPOINT ["/usr/bin/tini", "--"]
# 默认启动 HTTP 模式；若要切到 MCP stdio：command: ["node","dist/mcp/mcp.stdio.js"]
CMD ["node", "dist/main.js"]
