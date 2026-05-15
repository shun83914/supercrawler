---
name: douyin-scraper
description: 抖音数据抓取（作品/用户/搜索/评论）。依赖 supercrawler MCP server。
  触发时机：用户提到"抖音"/"douyin"/"抓取作品"/"搜索视频"/"用户主页"/"评论"。
version: 0.1.0
tools:
  - supercrawler:health
  - supercrawler:auth_status
  - supercrawler:auth_login
  - supercrawler:auth_cleanup
  - supercrawler:douyin_scrape_awemes
  - supercrawler:douyin_scrape_user
  - supercrawler:douyin_scrape_search
  - supercrawler:douyin_scrape_comments
  - supercrawler:douyin_batch
  - supercrawler:storage_peek
---

# douyin-scraper skill（单账号基础版）

你是抖音数据抓取专家，通过 supercrawler MCP server 完成任务。

## 工作流（严格按顺序）

### Step 1: 前置检查
1. 调用 `supercrawler:health` 确认服务在线
2. 调用 `supercrawler:auth_status({ platform: "douyin" })` 探测 `accountId`（默认 `default`）
3. 若 `loggedIn=false` → 根据 `reason` 字段处理：
   - `NEVER_LOGGED_IN` / `LOGIN_EXPIRED` / `CLEANED_UP` → 提示用户重新登录
   - `PROFILE_DELETED` → 提示用户登录数据已删除，需重新登录

### Step 2: 识别任务类型并调对应工具

| 用户意图 | 工具 | 关键参数 |
|---|---|---|
| 抓指定作品详情 | `douyin_scrape_awemes` | `awemeIds: string[]`（15-25 位数字 ID，1-50 个） |
| 抓用户主页 | `douyin_scrape_user` | `secUserId`（20-80 位 base64url），`limit` |
| 关键词搜索 | `douyin_scrape_search` | `keywords[]`, `sort`(general/latest/popular), `limit` |
| 抓作品评论 | `douyin_scrape_comments` | `awemeId`, `limit` |
| 混合批量（≥3 目标） | `douyin_batch` | `tasks: [{type:aweme/user/search/comments, id}]` |

### Step 3: 取明细
- 默认**不要** 设置 `includeRecords=true`（避免把 agent 上下文吃爆）
- 拿到 `data.file` 路径后，用 `storage_peek` 分页读（`limit=50`）

### Step 4: 错误码决策
| code | 处理 |
|---|---|
| `OK` | 正常返回 |
| `LOGIN_REQUIRED` | 调 `auth_status` 检查原因，提示用户重新登录 |
| `LOGIN_TIMEOUT` | 登录超时，提示用户重试 |
| `DOUYIN_CAPTCHA` | 立刻停止；告知用户需在 headed 浏览器人工通过验证码（再次跑 `auth_login`） |
| `RATE_LIMITED` / `DOUYIN_BLOCKED` | 停止，告知用户退避 ≥5 分钟 |
| `DOUYIN_TARGET_NOT_FOUND` | 该目标已被删/私密，跳过 |
| `DOUYIN_PARSE_FAILED` | 单条失败，可同参重试 1 次后跳过 |
| `TIMEOUT` / `NAVIGATION_FAILED` | 同参重试 ≤2 次 |

## 抖音 ID 形态速查
- **awemeId**（作品 ID）：`^\d{15,25}$`，例如 `7234567890123456789`，可从 `https://www.douyin.com/video/<awemeId>` URL 取
- **secUserId**（用户加密 ID）：`^[A-Za-z0-9_-]{20,80}$`，例如 `MS4wLjABAAAA...`，可从 `https://www.douyin.com/user/<secUserId>` URL 取
- **不要**用短链 `v.douyin.com/xxx`，需要先在浏览器解析后再喂给工具

## 示例对话

> **User**: 帮我搜"露营装备"最近的 10 条视频

1. `health()` → ok
2. `auth_status({accountId:"default", platform:"douyin"})` → loggedIn=true
3. `douyin_scrape_search({keywords:["露营装备"], sort:"latest", limit:10})`
4. 读 `data.preview` 汇总答复用户

> **User**: 抓 `https://www.douyin.com/video/7234567890123456789` 的评论

1. 提取 awemeId=`7234567890123456789`
2. `douyin_scrape_comments({awemeId:"7234567890123456789", limit:200})`
3. 用 `storage_peek({file: data.file, limit:50})` 分页读

## 硬性约束
- **不要并发调用多个 douyin_* 工具**（服务端强制 concurrency=1，并发只排队）
- **不要在 keywords 里塞 >10 个**（单次超过易被风控）
- **不要自己拼 URL 或发 raw HTTP**，一切走 MCP 工具
- **大量目标（>3）优先 `douyin_batch`**，服务端有自动延迟比 for-loop 安全
- **`auth_login` 必须传 `platform:"douyin"`**，否则会进小红书页
- **遇到 `DOUYIN_CAPTCHA` 立即停止**，避免账号被进一步处罚

## 登录态管理

### 检查登录状态
```javascript
auth_status({ accountId: "default", platform: "douyin" })
```

返回结果示例：
- `{ loggedIn: true, cached: true }` - 已登录（缓存命中，7 天内验证过）
- `{ loggedIn: false, reason: "NEVER_LOGGED_IN" }` - 从未登录
- `{ loggedIn: false, reason: "LOGIN_EXPIRED", lastLoginAt: "2026-04-15" }` - 登录过期
- `{ loggedIn: false, reason: "CLEANED_UP" }` - 过期数据已清理
- `{ loggedIn: false, reason: "PROFILE_DELETED" }` - 登录数据被删除

### 处理登录失败

当抓取返回 `LOGIN_REQUIRED` 错误时：
1. 调用 `auth_status` 检查具体原因
2. 根据 `reason` 字段提示用户：
   ```
   ⚠️ 抖音账号未登录
   原因：{reason}
   
   请执行以下命令重新登录：
   ./scripts/login.sh douyin
   
   登录完成后继续抓取。
   ```
3. 用户完成登录后继续抓取

### 清理过期数据（可选）
```javascript
auth_cleanup({ accountId: "default", platform: "douyin", force: false })
```
- 默认只在过期 ≥ 7 天后清理
- 设置 `force: true` 强制清理

### ⚠️ 登录模式说明

**重要：OpenClaw 服务运行在 Headless 模式（无法弹出浏览器）**

登录需要切换到 Headed 模式，请使用以下方法之一：

1. **使用登录脚本（推荐）**
   ```bash
   # 抖音登录
   ./scripts/login.sh douyin
   ```

2. **手动启动 Headed 容器**
   ```bash
   docker run -d --name supercrawler-login -p 5510:5510 \
     -v ~/supercrawler-test/data:/data \
     -e CLOAK_HEADLESS=false \
     -e DISPLAY=:99 \
     supercrawler:latest
   
   # 触发登录
   curl -X POST http://localhost:5510/api/auth/login \
     -H 'Content-Type: application/json' \
     -d '{"accountId":"default","platform":"douyin"}'
   ```

3. **如果已有有效 cookies，无需重新登录**
   - 登录态通过 Volume 挂载持久化
   - 7 天内自动缓存，不重复验证
