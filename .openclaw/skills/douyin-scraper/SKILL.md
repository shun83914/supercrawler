---
name: douyin-scraper
description: 抖音数据抓取（作品/用户/搜索/评论）。依赖 supercrawler MCP server。
  触发时机：用户提到"抖音"/"douyin"/"抓取作品"/"搜索视频"/"用户主页"/"评论"。
version: 0.1.0
tools:
  - supercrawler:health
  - supercrawler:auth_status
  - supercrawler:auth_login
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
3. 若 `loggedIn=false` → 调 `supercrawler:auth_login({ platform: "douyin" })`（宿主机会自动弹出浏览器扫码）

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
| `LOGIN_REQUIRED` / `LOGIN_TIMEOUT` | 调 `auth_login({ platform: "douyin" })` |
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
