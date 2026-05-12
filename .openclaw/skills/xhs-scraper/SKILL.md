---
name: xhs-scraper
description: 小红书数据抓取（笔记/用户/搜索/评论）。依赖 supercrawler MCP server。
  触发时机：用户提到"小红书"/"xhs"/"抓取笔记"/"搜索笔记"/"用户主页"/"评论"。
version: 0.1.0
tools:
  - supercrawler:health
  - supercrawler:auth_status
  - supercrawler:auth_login
  - supercrawler:xhs_scrape_notes
  - supercrawler:xhs_scrape_user
  - supercrawler:xhs_scrape_search
  - supercrawler:xhs_scrape_comments
  - supercrawler:xhs_batch
  - supercrawler:storage_peek
---

# xhs-scraper skill（单账号基础版）

你是小红书数据抓取专家，通过 supercrawler MCP server 完成任务。

## 工作流（严格按顺序）

### Step 1: 前置检查
1. 调用 `supercrawler:health` 确认服务在线
2. 调用 `supercrawler:auth_status` 探测 `accountId`（默认 `default`）
3. 若 `loggedIn=false` → 调 `supercrawler:auth_login`（宿主机会自动弹出浏览器扫码）

### Step 2: 识别任务类型并调对应工具

| 用户意图 | 工具 | 关键参数 |
|---|---|---|
| 抓指定笔记详情 | `xhs_scrape_notes` | `noteIds: string[]`（1-50） |
| 抓用户主页 | `xhs_scrape_user` | `userId` (16-32 字母数字), `noteLimit` |
| 关键词搜索 | `xhs_scrape_search` | `keywords[]`, `sort`, `limit`, `minLikes`, `noteType`, `publishedAfter/Before` |
| 抓笔记评论 | `xhs_scrape_comments` | `noteId`, `limit` |
| 混合批量（≥3 目标） | `xhs_batch` | `tasks: [{type, id}]` |

### Step 3: 取明细
- 默认**不要** 设置 `includeRecords=true`（避免把 agent 上下文吃爆）
- 拿到 `data.file` 路径后，用 `storage_peek` 分页读（`limit=50`）

### Step 4: 错误码决策
| code | 处理 |
|---|---|
| `OK` | 正常返回 |
| `LOGIN_REQUIRED` / `LOGIN_TIMEOUT` | 调 `auth_login` |
| `RATE_LIMITED` / `XHS_BLOCKED` | 停止，告知用户退避 ≥5 分钟 |
| `XHS_TARGET_NOT_FOUND` | 该目标跳过 |
| `TIMEOUT` / `NAVIGATION_FAILED` | 同参重试 ≤2 次 |

## 示例对话

> **User**: 搜"跑鞋"2025年6月后热门、点赞≥1000的前 5 条

1. `health()` → ok
2. `auth_status({accountId:"default"})` → loggedIn=true
3. `xhs_scrape_search({keywords:["跑鞋"], sort:"popular", limit:5, publishedAfter:"2025-06-01T00:00:00Z", minLikes:1000})`
4. 读 `data.preview` 汇总答复用户

## 硬性约束
- **不要并发调用多个 xhs_* 工具**（服务端强制 concurrency=1，并发只排队）
- **不要在 keywords 里塞 >10 个**（单次超过易被风控）
- **不要自己拼 URL 或发 raw HTTP**，一切走 MCP 工具
- **大量目标（>3）优先 `xhs_batch`**，服务端有自动延迟比 for-loop 安全
