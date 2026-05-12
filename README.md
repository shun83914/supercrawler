# SuperCrawler

> 给 **OpenClaw agent** 当 **skill 工具** 使用的 **小红书 + 抖音** 数据抓取服务。
> 同时提供 **REST + MCP（stdio）** 两种调用入口，agent 可二选一接入。

技术栈：**NestJS 11 + TypeScript + CloakBrowser + Playwright-core**

---

## ⚡ 不想看源码？Docker 一键部署

```bash
docker run -d --name supercrawler -p 5510:5510 \
  -v ~/supercrawler/data:/data \
  -e API_TOKEN=$(openssl rand -hex 32) \
  ghcr.io/<你的用户名>/supercrawler:latest
```

详细说明请查看 [README.DOCKER.md](./README.DOCKER.md)（面向最终用户的部署指南，无需 Node.js/npm）

---

## 1. 设计目标（为什么这样实现）

| 关键决策 | 原因（面向 agent skill 场景） |
| -- | -- |
| 统一响应壳 `{success, code, data | message, traceId, ts}` | agent 通过稳定 code 做决策（重试 / 重新登录 / 报错） |
| 业务错误码枚举（`LOGIN_REQUIRED` / `XHS_BLOCKED` / `RATE_LIMITED` …） | agent 不需要解析自由文本就能识别失败原因 |
| 默认精简响应（不返回 `records`，只返 `file/count/preview`） | 避免大 payload 把 agent 上下文窗口吃爆 |
| `includeRecords` / `includeRaw` / `maxRecords` 开关 | 需要明细时显式开启，按需付费 |
| `useCache` + TTL 内幂等命中 | 防 agent 因循环/重试反复打同一目标被风控加速 |
| `X-API-Key` / Bearer 鉴权（环境变量） | 服务对外暴露的最低安全线 |
| `GET /api/skills/manifest` skill 清单 | agent 自动发现/挂载所有工具 |
| `GET /api/storage/peek` 读 JSONL | 大结果延迟加载，按需分页拉取 |
| 增强 `/api/health`（账号/并发/缓存） | agent 决策前先看状态 |
| 结构化日志（pino + traceId） | 排查 agent 调用链 |
| MCP stdio 入口 | OpenClaw / Claude Desktop 类 agent 直接挂载 |

---

## 2. 目录结构

```
src/
├── app.module.ts / app.controller.ts / app.service.ts   # 健康检查 + 全局装配
├── main.ts                                              # HTTP 入口
├── mcp/
│   ├── mcp.bridge.ts        # 注册 skills 为 MCP tools
│   └── mcp.stdio.ts         # stdio MCP server 入口（npm run mcp）
├── skills/
│   ├── skill.manifest.ts    # 全部 skill 的 JSON Schema 清单
│   └── skills.controller.ts # GET /api/skills/manifest
├── common/
│   ├── api/                 # 响应壳 + 拦截器（统一 success/失败）
│   ├── errors/              # ErrorCode + BusinessException
│   ├── guards/api-key.guard # X-API-Key 鉴权
│   ├── filters/             # 全局异常过滤器
│   ├── cache/               # ScrapeCacheService（幂等）
│   └── utils/               # Semaphore / humanize / datetime
├── config/                  # 环境变量统一配置
├── browser/                 # CloakBrowser PersistentContext 池
├── storage/                 # JSONL 写 + 分页读（/storage/peek）
├── auth/                    # 扫码登录 + 状态探测
├── xhs/
│   ├── strategies/          # note/user/search/comments 4 个策略
│   ├── parsers/             # __INITIAL_STATE__ + DOM 降级
│   ├── entities/dto/        # 实体 + 入参校验
│   └── xhs.service.ts       # 编排 + 信号量 + 缓存
└── douyin/
    ├── strategies/          # aweme/user/search/comments 4 个策略
    ├── parsers/             # XHR raw + _SSR_DATA 降级
    ├── entities/dto/        # 实体 + 入参校验
    └── douyin.service.ts    # 编排 + 信号量 + 缓存
```

---

## 3. 快速开始

### 方式 A：一键初始化（推荐，首次使用）

```bash
git clone <repo-url> && cd supercrawler
npm run init
```

`npm run init` 会自动完成：
1. `npm install` 安装依赖
2. `npm run build` 构建（如 dist 缺失）
3. 生成 `SUPERCRAWLER_TOKEN` 并写入 `.env`
4. 后台启动服务，等待就绪
5. 引导扫码登录（弹出浏览器，用小红书 App 扫码）
6. 打印下一步命令（服务保留在后台运行）

支持参数：
```bash
./scripts/init-first-run.sh --account=work01      # 指定 accountId
./scripts/init-first-run.sh --port=3001           # 指定端口
./scripts/init-first-run.sh --timeout=180         # 扫码等待秒数
./scripts/init-first-run.sh --skip-build          # 复用已有 dist
```

### 方式 B：手动分步

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env，建议设置 API_TOKEN=xxxxx 防裸跑；默认 PORT=5510

# 3. 生成鉴权 token（可选，npm run init 已自动执行）
npm run gen-token

# 4. 构建
npm run build

# 5. 启动服务
npm run start:dev          # HTTP 模式，端口由 .env 的 PORT 控制（默认 5510）

# 浏览器访问（以 5510 为例）：
#   http://localhost:5510/api/health
#   http://localhost:5510/api/skills/manifest
#   http://localhost:5510/docs   (Swagger)
```

### 首次扫码登录

抓取前必须先登录至少 1 个账号：

**小红书登录：**
```bash
curl -X POST http://localhost:${PORT:-5510}/api/auth/login \
     -H "X-API-Key: $API_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"accountId":"default"}'
# 用小红书 App 扫码后，cookie 自动持久化在 ./data/profiles/default
```

**抖音登录：**
```bash
curl -X POST http://localhost:${PORT:-5510}/api/auth/login \
     -H "X-API-Key: $API_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"accountId":"default","platform":"douyin"}'
# 弹出的浏览器会打开抖音页面，用抖音 App 扫码
```

> 多账号场景：重复上述命令，把 `accountId` 换成 `biz1`/`biz2`/... 即可，每个账号独立持久化。

### Docker

```bash
docker compose up -d
docker compose logs -f
```

> 容器内默认 `CLOAK_HEADLESS=true`，扫码登录请在宿主机用 `npm run start` 完成首次登录后，再把 `./data/profiles` 挂进容器。

### MCP stdio（给 agent 用）

```bash
npm run build
npm run mcp                   # 前台 stdio
```

OpenClaw / Claude Desktop 配置示例：

```json
{
  "mcpServers": {
    "supercrawler": {
      "command": "node",
      "args": ["dist/mcp/mcp.stdio.js"],
      "cwd": "/abs/path/to/supercrawler",
      "env": { "PROFILE_DIR": "./data/profiles" }
    }
  }
}
```

工具名（agent 端可见）：
`xhs_scrape_notes / xhs_scrape_user / xhs_scrape_search / xhs_scrape_comments / xhs_batch`
`douyin_scrape_awemes / douyin_scrape_user / douyin_scrape_search / douyin_scrape_comments / douyin_batch`
`auth_login(platform=xhs|douyin) / auth_status(platform=xhs|douyin) / storage_peek / health`

---

## 4. REST API 速查

| Method | Path | 用途 |
| -- | -- | -- |
| GET  | `/api/health` | 健康 + 账号/并发/缓存状态（**Public**） |
| GET  | `/api/skills/manifest` | Skill 清单 JSON（**Public**） |
| POST | `/api/auth/login` | 扫码登录（headful） |
| GET  | `/api/auth/status` | 无头探测登录态（`?accountId=xxx&platform=xhs|douyin`） |
| POST | `/api/xhs/notes` | 笔记详情 |
| POST | `/api/xhs/users` | 用户主页 + 最近笔记 |
| POST | `/api/xhs/search` | 关键词搜索（综合/最新/热门） |
| POST | `/api/xhs/comments` | 笔记评论（XHR 监听） |
| POST | `/api/xhs/batch` | 小红书混合批量 |
| POST | `/api/douyin/awemes` | 抖音作品详情 |
| POST | `/api/douyin/users` | 抖音用户主页（secUserId） + 最近作品 |
| POST | `/api/douyin/search` | 抖音关键词搜索 |
| POST | `/api/douyin/comments` | 抖音作品评论 |
| POST | `/api/douyin/batch` | 抖音混合批量 |
| GET  | `/api/storage/peek` | 分页读 JSONL（限制在 OUTPUT_DIR） |

### 调用示例（agent 视角）

```bash
# 1. 触发抓取，默认只返摘要（端口来自 .env PORT，示例为 5510）
curl -X POST http://localhost:${PORT:-5510}/api/xhs/notes \
  -H "X-API-Key: $API_TOKEN" -H "Content-Type: application/json" \
  -d '{"noteIds":["6612abcd...","6612efgh..."]}'

# 响应：
# { "success":true, "code":"OK", "traceId":"...", "data":{
#     "target":"note", "file":"data/output/2026-05-11/note-...jsonl",
#     "count":2, "cached":false, "preview":[{"id":"...","title":"..."}] } }

# 2. 需要明细：
curl -X POST http://localhost:${PORT:-5510}/api/xhs/notes \
  -H "X-API-Key: $API_TOKEN" -H "Content-Type: application/json" \
  -d '{"noteIds":["..."],"includeRecords":true,"maxRecords":20}'

# 3. 直接读文件
curl "http://localhost:${PORT:-5510}/api/storage/peek?file=data/output/2026-05-11/note-xxx.jsonl&limit=10" \
     -H "X-API-Key: $API_TOKEN"
```

### 失败响应（agent 决策）

```json
{
  "success": false,
  "code": "LOGIN_REQUIRED",
  "message": "no session cookie for accountId=default",
  "traceId": "ab12...",
  "ts": "2026-05-11T..."
}
```

agent 拿到 `LOGIN_REQUIRED` → 调 `auth_login`；拿到 `RATE_LIMITED` → 退避；拿到 `XHS_TARGET_NOT_FOUND` → 直接放弃该目标。

---

## 5. 环境变量

| 变量 | 默认 | 说明 |
| -- | -- | -- |
| `PORT` | 5510 | HTTP 端口 |
| `API_TOKEN` | *(空)* | 鉴权 token，空表示**不鉴权**（⚠️ 生产环境必须设置） |
| `LOG_LEVEL` | info | pino 日志级别 |
| `CLOAK_HEADLESS` | false | 抓取/登录是否无头 |
| `CLOAK_HUMANIZE` | true | CloakBrowser 人类行为模拟 |
| `CLOAK_TIMEZONE` | Asia/Shanghai | |
| `CLOAK_LOCALE` | zh-CN | |
| `CLOAK_PROXY` | – | 可选代理 |
| `PROFILE_DIR` | ./data/profiles | 持久化登录 profile |
| `OUTPUT_DIR` | ./data/output | JSONL 落盘 |
| `XHS_SCRAPE_CONCURRENCY` | 1 | 小红书并发上限 |
| `XHS_MIN_DELAY_MS` / `XHS_MAX_DELAY_MS` | 800 / 2400 | 小红书请求间随机休眠 |
| `XHS_NAV_TIMEOUT_MS` | 45000 | 小红书页面打开超时 |
| `XHS_LOGIN_WAIT_MS` | 300000 | 小红书扫码登录最长等待 |
| `DOUYIN_SCRAPE_CONCURRENCY` | 1 | 抖音并发上限 |
| `DOUYIN_MIN_DELAY_MS` / `DOUYIN_MAX_DELAY_MS` | 1200 / 3000 | 抖音请求间随机休眠 |
| `DOUYIN_NAV_TIMEOUT_MS` | 45000 | 抖音页面打开超时 |
| `DOUYIN_LOGIN_WAIT_MS` | 300000 | 抖音扫码登录最长等待 |
| `CACHE_TTL_MS` | 300000 | 幂等缓存 TTL |
| `CACHE_MAX_ENTRIES` | 256 | 缓存上限 |

---

## 6. OpenClaw 接入

### 6.1 MCP server 注册

OpenClaw 已自动加载 `.openclaw/mcp.json`。如果是全局 OpenClaw，使用 symlink：

```bash
mkdir -p ~/.openclaw
ln -sf "$(pwd)/.openclaw/mcp.json"   ~/.openclaw/mcp.json
ln -sf "$(pwd)/.openclaw/skills"     ~/.openclaw/skills
```

> 如果 OpenClaw 不支持 `${workspaceFolder}`，用绝对路径版：
> ```bash
> bash .openclaw/mcp.absolute.generate.sh --to-home
> ```

### 6.2 Skill 清单

| Skill | 用途 | 适用场景 |
| -- | -- | -- |
| `xhs-scraper` | 小红书单账号抓取 | 单次/小批量 |
| `xhs-multi-account` | 小红书多账号轮询 | 批量 ≥20 目标 / 频繁撞风控 |
| `douyin-scraper` | 抖音单账号抓取 | 单次/小批量，含验证码预警 |

> 抖音场景调用 `auth_login` / `auth_status` 时，必须传 `platform: "douyin"`。

### 6.3 运维工具

```bash
npm run gen-token                          # 生成 token 并写入 .env
npm run gen-token -- --print-only          # 仅打印不落盘
npm run accounts:status                    # 表格输出所有账号登录态
npm run accounts:status -- --json          # JSON 输出（CI 巡检）
npm run accounts:relogin                   # 一键重登所有账号
```

---

## 7. 给 agent 接入的最佳实践

1. **先调 `health`** 看 `accounts.profilesOnDisk` 与 `onlineContexts`，没登录就先 `auth_login`。
2. **默认不要 `includeRecords`**——拿到 `file` 路径后再视情况 `storage_peek` 拉所需条数。
3. **批量优先用 `xhs_batch` / `douyin_batch`**——服务内部串行执行 + 自动延迟，比 agent 自己循环更安全。
4. **失败码语义**：
   - `LOGIN_REQUIRED` / `LOGIN_TIMEOUT` → 调 `auth_login`（记得传 `platform`）
   - `RATE_LIMITED` / `XHS_BLOCKED` / `DOUYIN_BLOCKED` → 指数退避，建议 ≥ 5 分钟
   - `DOUYIN_CAPTCHA` → 立刻停止，在 headed 浏览器人工通过验证码
   - `XHS_TARGET_NOT_FOUND` / `DOUYIN_TARGET_NOT_FOUND` → 放弃该目标
   - `TIMEOUT` / `NAVIGATION_FAILED` → 重试 ≤ 2 次
5. **traceId** 透传：agent 调用时设 `X-Trace-Id`，便于回溯。

### 首次使用 Checklist

| 步骤 | 命令/操作 | 预期结果 |
| -- | -- | -- |
| 1 | `npm install` | `node_modules/` 生成 |
| 2 | `cp .env.example .env` | `.env` 就绪 |
| 3 | `npm run gen-token` | `API_TOKEN` 写入 `.env` |
| 4 | `npm run build` | `dist/` 生成 |
| 5 | `npm run start:dev` | `/api/health` 返回 200 |
| 6 | `curl /api/auth/login`（小红书） | 扫码成功返回 `loggedIn:true` |
| 7 | `curl /api/auth/login` + `platform:"douyin"`（抖音） | 扫码成功返回 `loggedIn:true` |
| 8 | `curl /api/xhs/search` 或 `/api/douyin/search` | 返回 `count > 0` |

---

## 8. 后续扩展建议

- StreamableHTTP transport（替代已废弃的 SSE）让 MCP 走 HTTP 长连
- Redis 替换内存缓存，多实例共享
- Prometheus 导出指标（抓取成功率、风控触发率）
- 多账号轮询（已支持 accountId 维度，再加调度策略即可）
