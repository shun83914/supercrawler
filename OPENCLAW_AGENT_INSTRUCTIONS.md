# 🤖 OpenClaw Main Agent 完整指令 — SuperCrawler 部署与使用

> **🎯 核心优势**：通过 **MCP + Skills** 使用，Agent 自动发现和调用工具，无需手动拼 HTTP 请求！
>
> **适用场景**：全新 OpenClaw 安装，需要 Agent 完成从部署到使用的全流程。

---

## 📋 使用说明

**直接复制以下所有内容给 OpenClaw Main Agent**，让它自动执行。

---

## 完整指令开始

```
你好！我需要你帮我部署和配置 SuperCrawler 数据抓取服务，然后通过 MCP 工具使用它。

这是一个全新的环境，请你严格按照以下阶段执行。

---

# 🎯 总体流程

```
阶段 1: 运维部署 — Docker 拉取镜像、启动容器
    ↓
阶段 2: 配置 MCP — 让 OpenClaw 能调用 MCP tools
    ↓
阶段 3: 安装 Skills — 让 Agent 知道如何使用工具
    ↓
阶段 4: 扫码登录 — 首次必须，**分别登录小红书和抖音**
    ↓
阶段 5: 使用 MCP Tools — 日常抓取任务
```

---

# 阶段 1：运维部署（Docker）

## Step 1: 检查系统环境

执行以下命令：

```bash
# 1. 检查 Docker
docker --version

# 2. 检查系统架构
uname -m
# arm64 = Apple Silicon Mac
# x86_64 = Intel Mac 或 Linux

# 3. 检查 OpenClaw 配置目录
ls -la ~/.openclaw/ 2>/dev/null || echo "OpenClaw 配置目录不存在"

# 4. 检查是否有旧容器
docker ps -a | grep supercrawler
```

**如果有旧容器，先清理：**
```bash
docker rm -f supercrawler 2>/dev/null || true
```

---

## Step 2: 拉取 Docker 镜像

**智能版本管理：使用 `latest` 标签**

```bash
ARCH=$(uname -m)

# 使用 latest 标签（自动获取最新版本）
if [ "$ARCH" = "arm64" ]; then
  IMAGE="ghcr.io/shun83914/supercrawler:latest-debian-arm64"
  echo "🍎 ARM64 架构"
elif [ "$ARCH" = "x86_64" ]; then
  IMAGE="ghcr.io/shun83914/supercrawler:latest-debian-amd64"
  echo "💻 AMD64 架构"
else
  echo "❌ 不支持的架构: $ARCH"
  exit 1
fi

echo "📦 拉取镜像: $IMAGE"
docker pull $IMAGE

# 查看镜像版本
echo "📊 镜像信息:"
docker inspect "$IMAGE" --format='{{index .Config.Labels "org.opencontainers.image.version"}}' 2>/dev/null || echo "版本信息未标注"
```

**版本标签说明：**

| 标签 | 说明 | 推荐场景 |
|------|------|----------|
| `latest-debian-arm64` | 最新稳定版（ARM64） | ✅ 日常使用 |
| `latest-debian-amd64` | 最新稳定版（AMD64） | ✅ 日常使用 |
| `v1.0.5-debian-arm64` | 指定版本（ARM64） | 生产环境锁定版本 |
| `v1.0.5-debian-amd64` | 指定版本（AMD64） | 生产环境锁定版本 |

**为什么用 `latest`？**
- ✅ 自动获取最新版本
- ✅ 无需手动更新版本号
- ✅ 文档永久有效
- ✅ 用户无需关心版本

---

## Step 3: 启动容器

```bash
# 创建数据目录
mkdir -p ~/supercrawler/data

# 启动容器（Headless 模式）
docker run -d \
  --name supercrawler \
  -p 5510:5510 \
  -v ~/supercrawler/data:/data \
  -e CLOAK_HEADLESS=true \
  -e CLOAK_TIMEZONE=Asia/Shanghai \
  -e CLOAK_LOCALE=zh-CN \
  -e LOG_LEVEL=info \
  $IMAGE

echo "⏳ 等待容器启动..."
sleep 3

# 验证
docker ps | grep supercrawler

# 查看运行中的版本
echo "📊 运行版本:"
docker exec supercrawler node -e "console.log('SuperCrawler', require('./package.json').version)" 2>/dev/null || echo "版本检查跳过"
```

**等待拉取完成（约 477MB）**

**预期输出：**
```
CONTAINER ID   IMAGE          STATUS          PORTS
xxx            supercrawler   Up 5 seconds    0.0.0.0:5510->5510/tcp
```

---

## Step 4: 验证服务健康

```bash
curl -s http://localhost:5510/api/health | jq .
```

**预期输出：**
```json
{
  "status": "ok",
  "uptime": 5,
  "accounts": [],
  "semaphore": { "max": 1, "current": 0 }
}
```

如果 `status: "ok"`，说明服务启动成功！

---

## Step 3.5: 跨容器部署方案（可选）

**如果 OpenClaw 也在 Docker 容器中运行，需要使用此方案！**

### 场景说明

```
宿主机
├── OpenClaw（容器）
│   └── ❌ 无法使用 docker exec（没有 Docker socket）
│   └── ✅ 需要通过网络访问 SuperCrawler
└── SuperCrawler（容器）
    └── 端口 5510
```

### 方案：使用 Docker Compose（推荐）

**Step 1: 创建 docker-compose.yml**

```bash
cat > ~/supercrawler/docker-compose.yml << 'EOF'
version: '3.8'

services:
  # SuperCrawler 服务
  supercrawler:
    image: ghcr.io/shun83914/supercrawler:latest-debian-arm64
    container_name: supercrawler
    ports:
      - "5510:5510"
    volumes:
      - ~/supercrawler/data:/data
    environment:
      - CLOAK_HEADLESS=true
      - CLOAK_TIMEZONE=Asia/Shanghai
      - CLOAK_LOCALE=zh-CN
      - LOG_LEVEL=info
    networks:
      - supercrawler-net
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:5510/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 10s

  # OpenClaw 服务
  openclaw:
    image: openclaw-image:latest  # 替换为实际的 OpenClaw 镜像
    container_name: openclaw
    volumes:
      - ~/.openclaw:/root/.openclaw
    environment:
      - SUPERCLAWER_URL=http://supercrawler:5510
    networks:
      - supercrawler-net
    depends_on:
      supercrawler:
        condition: service_healthy
    restart: unless-stopped

networks:
  supercrawler-net:
    driver: bridge
EOF
```

**Step 2: 启动服务**

```bash
cd ~/supercrawler
docker compose up -d
```

**Step 3: 验证**

```bash
# 查看容器状态
docker compose ps

# 测试容器间通信
docker exec openclaw curl -s http://supercrawler:5510/api/health
```

**预期输出：**
```json
{"status":"ok","uptime":10}
```

### 关键点

1. **共享网络**
   - 两个容器加入同一网络 `supercrawler-net`
   - 通过容器名互相访问（`http://supercrawler:5510`）

2. **不要使用 localhost**
   - ❌ `http://localhost:5510`（在 OpenClaw 容器内指的是自己）
   - ✅ `http://supercrawler:5510`（通过容器名访问）

3. **健康检查**
   - OpenClaw 等待 SuperCrawler 健康后再启动
   - 避免连接失败

---

# 阶段 2：配置 MCP Server

## Step 5: 创建 MCP 配置

**根据部署方式选择配置：**

### 场景 A：OpenClaw 在宿主机运行（本地开发）

**关键**：配置 OpenClaw 通过 `docker exec` 连接到容器。

```bash
# 判断 OpenClaw 配置目录是否存在，不存在才创建
if [ ! -d ~/.openclaw ]; then
  mkdir -p ~/.openclaw
  echo "✅ 已创建 OpenClaw 配置目录: ~/.openclaw"
else
  echo "ℹ️  OpenClaw 配置目录已存在: ~/.openclaw"
fi
```
```bash
cat > ~/.openclaw/mcp.json << 'EOF'
{
  "$schema": "https://openclaw.dev/schema/mcp.json",
  "mcpServers": {
    "supercrawler": {
      "command": "docker",
      "args": ["exec", "-i", "supercrawler", "node", "dist/mcp/mcp.stdio.js"],
      "env": {
        "PROFILE_DIR": "/data/profiles",
        "OUTPUT_DIR": "/data/output"
      }
    }
  }
}
EOF

echo "✅ MCP 配置已创建: ~/.openclaw/mcp.json"
cat ~/.openclaw/mcp.json
```

### 场景 B：OpenClaw 在 Docker 容器中运行（生产环境）

**关键**：MCP 使用 stdio 协议，需要通过 `docker exec` 连接容器。

⚠️ **重要说明**：
- SuperCrawler 的 MCP Server 使用 **stdio 模式**（不是 HTTP）
- OpenClaw 容器需要能够执行 `docker exec` 命令
- 需要挂载 Docker socket 或使用其他方式访问 Docker

**MCP 配置（docker exec 模式）：**

```bash
# 启动 OpenClaw 容器时需要挂载 Docker socket
docker run -d \
  --name openclaw \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v ~/.openclaw:/root/.openclaw \
  openclaw-image:latest

# MCP 配置
cat > ~/.openclaw/mcp.json << 'EOF'
{
  "$schema": "https://openclaw.dev/schema/mcp.json",
  "mcpServers": {
    "supercrawler": {
      "command": "docker",
      "args": ["exec", "-i", "supercrawler", "node", "dist/mcp/mcp.stdio.js"],
      "env": {
        "PROFILE_DIR": "/data/profiles",
        "OUTPUT_DIR": "/data/output"
      }
    }
  }
}
EOF
```

**这个配置的作用：**
```
OpenClaw 调用 MCP tools
    ↓
执行: docker exec -i supercrawler node dist/mcp/mcp.stdio.js
    ↓
连接到运行中的容器
    ↓
调用工具: supercrawler:xhs_scrape_search 等
```

---

# 阶段 3：安装 Skills

## Step 6: 安装小红书抓取 Skills

### 6.1 单账号基础版（xhs-scraper）

Skills 告诉 Agent 什么时候用什么工具、如何组合使用。

```bash
mkdir -p ~/.openclaw/skills/xhs-scraper

cat > ~/.openclaw/skills/xhs-scraper/SKILL.md << 'EOF'
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
3. 若 `loggedIn=false` → 告诉用户需要扫码登录

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
| `LOGIN_REQUIRED` / `LOGIN_TIMEOUT` | 告诉用户需要重新扫码 |
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
EOF

echo "✅ Skill 已安装: xhs-scraper（单账号版）"
```

### 6.2 多账号轮询版（xhs-multi-account）

**适用场景：**
- 需要批量抓取大量数据（>50 条）
- 单账号频繁撞风控
- 有多个已登录的小红书账号

```bash
mkdir -p ~/.openclaw/skills/xhs-multi-account

cat > ~/.openclaw/skills/xhs-multi-account/SKILL.md << 'EOF'
---
name: xhs-multi-account
description: 多账号轮询版小红书抓取 skill。自动在 profile 池中挑选可用账号注入 accountId，
  遇到 RATE_LIMITED/XHS_BLOCKED 自动冷却该账号切换下一个，显著降低单账号被风控概率。
  触发时机：用户明确要求"多账号"/"轮询"/"批量长任务"，或 xhs-scraper 频繁撞风控时。
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

# xhs-multi-account skill（多账号轮询版）

本 skill 在 `xhs-scraper` 基础上增加**账号池管理**，由 skill 钩子自动为每次
`xhs_scrape_*` 调用注入最优 `accountId`，你（agent）**不需要**自己选账号。

## 使用规则（agent 端）

1. **不要主动传 `accountId`**：留空让 skill 钩子自动注入；你传了会覆盖轮询逻辑
2. **工具调用形式与 xhs-scraper 完全一致**（同一套 MCP tools）
3. **冷却响应识别**：若钩子返回 `code=ALL_ACCOUNTS_COOLING` → 告知用户"全部账号冷却中"并停止

## 工作流

### Step 1: 预热账号池
首次会话时调一次 `supercrawler:health` 看 `accounts.profilesOnDisk`：
- 若 ≥2 → skill 自动启用轮询
- 若 =1 → 退化为单账号模式（等价 xhs-scraper）
- 若 =0 → 提示用户至少登录一个账号

### Step 2: 常规抓取
调用 `xhs_scrape_search` / `xhs_scrape_notes` 等工具时**省略 accountId**，
skill 钩子会：
1. 从池中选一个非冷却、登录态有效、最久未使用的 accountId
2. 注入到 `args.accountId`
3. 调用完成后记录 lastUsedAt；失败码是风控类时打入 10min 冷却

### Step 3: 失败码决策（与单账号版差异）

| code | 单账号版 | 多账号版差异 |
|---|---|---|
| `RATE_LIMITED` / `XHS_BLOCKED` | 停止退避 | **skill 自动冷却该账号**，你继续调用下一次即切到其它账号 |
| `LOGIN_REQUIRED` | 调 auth_login | skill 跳过该账号，选下一个；全部失效时才提示 |
| `ALL_ACCOUNTS_COOLING`（本 skill 自定义） | — | 全部账号冷却中，建议 5-10 分钟后再试 |

## 示例

> **User**: 批量抓 30 个 noteId 的详情

```
# 不必传 accountId，skill 自动分配
xhs_batch({
  tasks: [{type:"note", id:"..."}, ... 30 条]
})
```

skill 钩子会在 agent 不感知的情况下轮询 `default`/`biz1`/`biz2` 三个账号执行，
任一账号触发风控自动冷却 10min，其它账号继续服务。

## 硬性约束

- **PROFILE_DIR 里每个子目录 = 一个 accountId**（命名仅允许 `[\w.-]{1,64}`）
- **冷却期默认 10 分钟**（可由 `XHS_COOL_DOWN_MS` 环境变量覆盖）
- **不兼容显式 auth_login**：扫码登录仍需手工指定 `accountId`
- **服务端 concurrency=1 的限制不变**——轮询只降单账号打扰频率，不提升总吞吐
EOF

echo "✅ Skill 已安装: xhs-multi-account（多账号版）"
```

**两个 Skill 的区别：**

| 特性 | xhs-scraper | xhs-multi-account |
|------|-------------|-------------------|
| 适用场景 | 单次/小批量抓取 | 批量≥20 目标 / 长周期 |
| 账号管理 | 手动指定 accountId | 自动轮询账号池 |
| 风控处理 | 停止退避 | 自动冷却该账号，切换下一个 |
| 触发条件 | 提到"小红书"/"xhs" | 提到"多账号"/"轮询"/"批量长任务" |
| 使用建议 | 频繁撞风控时切换到多账号版 | 显著降低单账号被风控概率 |

---

## Step 7: 安装抖音抓取 Skill

```bash
mkdir -p ~/.openclaw/skills/douyin-scraper

cat > ~/.openclaw/skills/douyin-scraper/SKILL.md << 'EOF'
---
name: douyin-scraper
description: 抖音数据抓取（作品/用户/搜索/评论）。依赖 supercrawler MCP server。
  触发时机：用户提到"抖音"/"douyin"/"抓取作品"/"搜索抖音"。
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

# douyin-scraper skill

你是抖音数据抓取专家，通过 supercrawler MCP server 完成任务。

## 工作流

### Step 1: 前置检查
1. `supercrawler:health()` → 确认服务在线
2. `supercrawler:auth_status({accountId:"default", platform:"douyin"})` → 检查登录
3. 若 `loggedIn=false` → 告诉用户需要扫码登录（注意 platform="douyin"）

### Step 2: 识别任务类型

| 用户意图 | 工具 | 关键参数 |
|---|---|---|
| 抓指定作品 | `douyin_scrape_awemes` | `awemeIds: string[]`（1-50） |
| 抓用户主页 | `douyin_scrape_user` | `secUserId` |
| 关键词搜索 | `douyin_scrape_search` | `keywords[]`, `sort`, `limit` |
| 抓作品评论 | `douyin_scrape_comments` | `awemeId`, `limit` |
| 混合批量 | `douyin_batch` | `tasks: [{type, id}]` |

### Step 3: 取明细
- 用 `storage_peek` 读取结果文件

## 硬性约束
- **调用 auth_login/status 时传 platform:"douyin"**
- **不要并发调用多个 douyin_* 工具**
- **不要自己拼 URL 或发 raw HTTP**
EOF

echo "✅ Skill 已安装: douyin-scraper"
```

---

## Step 8: 验证 MCP 配置

**重启 OpenClaw 以加载新配置**

然后检查：
1. OpenClaw 是否识别到了 `supercrawler` MCP server
2. 能否看到可用的工具列表

**预期工具列表（19 个）：**

**小红书工具（9 个）：**
```
supercrawler:health
supercrawler:auth_status
supercrawler:auth_login
supercrawler:xhs_scrape_notes
supercrawler:xhs_scrape_user
supercrawler:xhs_scrape_search
supercrawler:xhs_scrape_comments
supercrawler:xhs_batch
supercrawler:storage_peek
```

**抖音工具（5 个）：**
```
supercrawler:douyin_scrape_awemes
supercrawler:douyin_scrape_user
supercrawler:douyin_scrape_search
supercrawler:douyin_scrape_comments
supercrawler:douyin_batch
```

**美团工具（5 个）：**
```
supercrawler:meituan_scrape_orders
supercrawler:meituan_scrape_products
supercrawler:meituan_scrape_reviews
supercrawler:meituan_scrape_promotion_campaigns
supercrawler:meituan_scrape_promotion_stats
```

告诉我是否看到了这些工具！

---

# 阶段 4：扫码登录（首次必须）

> **🎯 重要**：需要分别登录小红书和抖音两个平台！
> **🤖 Agent 主动执行**：Agent 会启动 Headed 容器、获取二维码并展示给用户，用户只需在飞书中扫码即可。
> **💬 交互方式**：Agent 先询问用户是否准备好登录小红书，用户确认后，Agent 展示二维码，等待扫码完成后再继续抖音登录。

## Step 9: 检查登录状态

### 9.1 检查小红书登录

**使用 MCP 工具：**
```
调用: supercrawler:auth_status({
  accountId: "default",
  platform: "xhs"
})
```

**返回结果：**
- `{ loggedIn: true, cached: true }` - ✅ 已登录（7天内验证过）
- `{ loggedIn: false, reason: "NEVER_LOGGED_IN" }` - ❌ 从未登录
- `{ loggedIn: false, reason: "LOGIN_EXPIRED" }` - ❌ 登录过期
- `{ loggedIn: false, reason: "CLEANED_UP" }` - ❌ 数据已清理

### 9.2 检查抖音登录

**使用 MCP 工具：**
```
调用: supercrawler:auth_status({
  accountId: "default",
  platform: "douyin"
})
```

**如果任一平台 `loggedIn: false`，需要执行 Step 10 扫码登录。**

---

### 9.3 诊断 Profile 状态（**新增！**）

**⚠️ 当登录或搜索失败时，使用此工具诊断问题：**

**使用 MCP 工具：**
```
调用: supercrawler:auth_profile_status({
  accountId: "default"
})
```

**或直接调用 API：**
```bash
curl -s "http://localhost:5510/api/auth/profile-status?accountId=default" | jq
```

**返回示例（正常）：**
```json
{
  "accountId": "default",
  "profileExists": true,
  "lockFiles": {
    "singletonLock": false,
    "singletonSocket": false
  },
  "metadata": {
    "xhs": {
      "platform": "xhs",
      "loginAt": "2026-05-11T09:00:00.000Z",
      "status": "valid"
    },
    "douyin": {
      "platform": "douyin",
      "loginAt": "2026-05-11T10:00:00.000Z",
      "status": "valid"
    }
  },
  "message": "Profile 状态正常"
}
```

**返回示例（有问题）：**
```json
{
  "accountId": "default",
  "profileExists": true,
  "lockFiles": {
    "singletonLock": true,  // ← 问题：残留锁文件
    "singletonSocket": false
  },
  "metadata": {
    "xhs": null,  // ← 问题：无元数据
    "douyin": null
  },
  "message": "发现 1 个问题: 存在残留锁文件（可能有浏览器实例在运行）"
}
```

**诊断指南：**

| 问题 | 诊断结果 | 解决方案 |
|------|---------|----------|
| 锁文件残留 | `singletonLock: true` | 重启容器（自动清理） |
| 无登录元数据 | `metadata.xhs: null` | 执行 Step 10 扫码登录 |
| Profile 不存在 | `profileExists: false` | 从未登录，执行 Step 10 |
| 登录过期 | `metadata.xhs.status: "expired"` | 重新登录 |

**使用场景：**
1. 搜索返回空结果时
2. 登录失败时
3. 容器重启后状态异常时
4. 用户反馈“之前能用现在不能用”时

---

## Step 10: Agent 引导扫码登录

> **⚠️ 重要说明**：
> - 用户只在飞书中与 Agent 对话，**无法在终端执行命令**
> - Agent 需要**主动执行所有操作**，用户只需扫码
> - Agent 会按顺序引导：小红书 → 抖音

### 10.1 登录小红书

**如果小红书未登录，Agent 执行以下步骤：**

#### Step 10.1.1: 询问用户

**Agent 在飞书中发送：**

```
📱 小红书登录

检测到小红书账号未登录，需要扫码登录。

请准备好手机上的小红书 App，回复"开始"后我会展示二维码。
```

**等待用户回复"开始"或"准备好了"。**

---

#### Step 10.1.2: 启动 Headed 容器

**Agent 执行：**

```bash
docker run -d --name supercrawler-xhs-login -p 5520:5510 \
  -v ~/supercrawler/data:/data \
  -e CLOAK_HEADLESS=false \
  -e DISPLAY=:99 \
  ghcr.io/shun83914/supercrawler:latest-debian-arm64
```

**等待 5 秒让容器启动：**
```bash
sleep 5
```

---

#### Step 10.1.2.5: 检查浏览器就绪（**重要！**）

**⚠️ 首次运行时，Chromium 浏览器需要下载（约 2-5 分钟），必须等待下载完成！**

**Agent 执行：**

```bash
# 检查浏览器状态
BROWSER_STATUS=$(curl -s "http://localhost:5520/api/browser/status" | jq -r '.ready')

if [ "$BROWSER_STATUS" != "true" ]; then
  echo "⚠️ Chromium 浏览器正在下载，请稍候..."
  
  # 循环检查，最多等待 5 分钟
  for i in $(seq 1 30); do
    sleep 10
    BROWSER_STATUS=$(curl -s "http://localhost:5520/api/browser/status" | jq -r '.ready')
    if [ "$BROWSER_STATUS" = "true" ]; then
      echo "✅ Chromium 浏览器下载完成！"
      break
    fi
    echo "   等待中... ($((i * 10))秒)"
  done
  
  if [ "$BROWSER_STATUS" != "true" ]; then
    echo "❌ 浏览器下载超时，请检查容器日志"
    docker logs supercrawler-xhs-login --tail 50
    exit 1
  fi
else
  echo "✅ Chromium 浏览器已就绪"
fi
```

**如果浏览器未就绪，Agent 在飞书中发送：**

```
⏳ 首次启动，正在下载 Chromium 浏览器...

预计需要 2-5 分钟，请耐心等待。
下载完成后我会自动继续。
```

**下载完成后发送：**

```
✅ 浏览器准备就绪！现在触发登录流程...
```

---

#### Step 10.1.3: 触发登录

**Agent 执行：**

```bash
curl -s -X POST http://localhost:5520/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"accountId":"default","platform":"xhs"}'
```

**等待 3 秒让页面加载：**
```bash
sleep 3
```

---

#### Step 10.1.4: 获取二维码并展示

**Agent 执行：**

```bash
# 获取二维码（Base64）
QR_DATA=$(curl -s "http://localhost:5520/api/auth/qr-screenshot?platform=xhs" \
  | jq -r '.qrCode')

# 提取 Base64 部分
QR_BASE64=$(echo "$QR_DATA" | sed 's/data:image\/png;base64,//')

# 保存到临时文件
echo "$QR_BASE64" | base64 -d > /tmp/qr-xhs.png
```

**Agent 在飞书中发送二维码图片：**

```
📱 请扫描小红书二维码

[发送 /tmp/qr-xhs.png 图片]

请使用小红书 App 扫描上方二维码。
扫码完成后回复"已完成"。
```

---

#### Step 10.1.5: 等待扫码并检测

**Agent 循环检测（每 2 秒一次）：**

```bash
for i in {1..60}; do  # 最多等待 120 秒
  STATUS=$(curl -s "http://localhost:5520/api/auth/status?accountId=default&platform=xhs")
  LOGGED_IN=$(echo "$STATUS" | jq -r '.data.loggedIn')
  
  if [ "$LOGGED_IN" = "true" ]; then
    echo "✅ 登录成功！"
    break
  fi
  
  sleep 2
done
```

**如果 120 秒超时：**
```
⏰ 登录超时

二维码已过期，是否需要重新生成？
回复"是"我会重新展示二维码。
```

**如果登录成功：**
```
✅ 小红书登录成功！

接下来需要登录抖音，请准备好抖音 App。
回复"开始"后我会展示抖音登录二维码。
```

---

#### Step 10.1.6: 清理容器

```bash
docker stop supercrawler-xhs-login && docker rm supercrawler-xhs-login
```

---

### 10.2 登录抖音

**用户确认开始抖音登录后，Agent 执行以下步骤：**

#### Step 10.2.1: 启动 Headed 容器

**Agent 执行：**

```bash
docker run -d --name supercrawler-douyin-login -p 5530:5510 \
  -v ~/supercrawler/data:/data \
  -e CLOAK_HEADLESS=false \
  -e DISPLAY=:99 \
  ghcr.io/shun83914/supercrawler:latest-debian-arm64
```

**等待 5 秒：**
```bash
sleep 5
```

---

#### Step 10.2.1.5: 检查浏览器就绪（**重要！**）

**⚠️ 如果是首次运行或浏览器缓存被清理，Chromium 需要重新下载！**

**Agent 执行：**

```bash
# 检查浏览器状态
BROWSER_STATUS=$(curl -s "http://localhost:5530/api/browser/status" | jq -r '.ready')

if [ "$BROWSER_STATUS" != "true" ]; then
  echo "⚠️ Chromium 浏览器正在下载，请稍候..."
  
  # 循环检查，最多等待 5 分钟
  for i in $(seq 1 30); do
    sleep 10
    BROWSER_STATUS=$(curl -s "http://localhost:5530/api/browser/status" | jq -r '.ready')
    if [ "$BROWSER_STATUS" = "true" ]; then
      echo "✅ Chromium 浏览器下载完成！"
      break
    fi
    echo "   等待中... ($((i * 10))秒)"
  done
  
  if [ "$BROWSER_STATUS" != "true" ]; then
    echo "❌ 浏览器下载超时，请检查容器日志"
    docker logs supercrawler-douyin-login --tail 50
    exit 1
  fi
else
  echo "✅ Chromium 浏览器已就绪"
fi
```

---

#### Step 10.2.2: 触发登录

**Agent 执行：**

```bash
curl -s -X POST http://localhost:5530/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"accountId":"default","platform":"douyin"}'
```

**等待 3 秒：**
```bash
sleep 3
```

---

#### Step 10.2.3: 获取二维码并展示

**Agent 执行：**

```bash
QR_DATA=$(curl -s "http://localhost:5530/api/auth/qr-screenshot?platform=douyin" \
  | jq -r '.qrCode')
QR_BASE64=$(echo "$QR_DATA" | sed 's/data:image\/png;base64,//')
echo "$QR_BASE64" | base64 -d > /tmp/qr-douyin.png
```

**Agent 在飞书中发送：**

```
📱 请扫描抖音二维码

[发送 /tmp/qr-douyin.png 图片]

请使用抖音 App 扫描上方二维码。
扫码完成后回复"已完成"。
```

---

#### Step 10.2.4: 等待扫码并检测

**Agent 循环检测（每 2 秒一次）：**

```bash
for i in {1..60}; do
  STATUS=$(curl -s "http://localhost:5530/api/auth/status?accountId=default&platform=douyin")
  LOGGED_IN=$(echo "$STATUS" | jq -r '.data.loggedIn')
  
  if [ "$LOGGED_IN" = "true" ]; then
    echo "✅ 登录成功！"
    break
  fi
  
  sleep 2
done
```

---

#### Step 10.2.5: 清理容器

```bash
docker stop supercrawler-douyin-login && docker rm supercrawler-douyin-login
```

---

#### Step 10.2.6: 登录完成

**Agent 发送：**

```
✅ 抖音登录成功！

🎉 双平台登录完成！
- ✅ 小红书：已登录
- ✅ 抖音：已登录

现在可以开始使用抓取功能了！
请告诉我你需要抓取什么内容。
```

---

## Step 11: 验证登录态持久化

**两个平台都登录成功后，Agent 执行验证：**

### 11.1 验证小红书

**Agent 执行：**
```
调用: supercrawler:auth_status({
  accountId: "default",
  platform: "xhs"
})
```

**预期输出：**
```json
{
  "data": {
    "accountId": "default",
    "platform": "xhs",
    "loggedIn": true,
    "userId": "123456789",
    "nickname": "用户昵称",
    "checkedAt": "2026-05-15T10:30:00.000Z"
  }
}
```

### 11.2 验证抖音

**Agent 执行：**
```
调用: supercrawler:auth_status({
  accountId: "default",
  platform: "douyin"
})
```

**预期输出：**
```json
{
  "data": {
    "accountId": "default",
    "platform": "douyin",
    "loggedIn": true,
    "userId": "987654321",
    "nickname": "抖音用户",
    "checkedAt": "2026-05-15T10:31:00.000Z"
  }
}
```

### 11.3 告知用户

**Agent 发送：**

```
✅ 登录态验证成功！

登录信息已持久化保存，下次启动服务时会自动恢复。

📊 登录状态：
- 小红书：✅ 已登录（用户：xxx）
- 抖音：✅ 已登录（用户：xxx）

🎉 所有配置已完成！现在可以开始使用抓取功能了。
```

---

### 💡 登录态管理说明

**Agent 需要了解：**

1. **登录态持久化**
   - 登录信息保存在 `/data/profiles/` 目录
   - 通过 Docker Volume 挂载，容器重启后仍然有效
   - 7 天内不需要重新验证（缓存机制）

2. **自动清理**
   - 登录过期 ≥ 7 天会自动清理
   - 用户下次登录时会重新扫码

3. **检查登录态**
   - 每次抓取前自动调用 `auth_status`
   - 如果未登录，引导用户重新扫码

**✅ 登录态已持久化！**
- 通过 Volume 挂载保存（`~/supercrawler/data/profiles`）
- 7 天内自动缓存，不重复验证
- 切换 Headless/Headed 模式不丢失
- 除非手动删除 profiles 目录，否则无需重新登录

---

# 阶段 5：使用 MCP Tools 抓取数据

## 🎉 配置完成！现在可以使用 MCP 工具了

**不再需要手动调用 HTTP API！Agent 会自动使用 MCP tools。**

---

## 可用工具清单

| 工具 | 用途 | 示例 |
|------|------|------|
| `supercrawler:health` | 健康检查 | 检查服务是否在线 |
| `supercrawler:auth_status` | 检查登录 | `{accountId: "default", platform: "xhs"}` |
| `supercrawler:auth_profile_status` | **诊断 Profile 状态** | `{accountId: "default"}` |
| `supercrawler:auth_login` | 扫码登录 | `{accountId: "default", platform: "xhs"}` |
| `supercrawler:auth_cleanup` | 清理过期数据 | `{accountId: "default", platform: "xhs", force: false}` |
| `supercrawler:xhs_scrape_search` | 小红书搜索 | `{keywords: ["跑鞋"], sort: "popular", limit: 10}` |
| `supercrawler:xhs_scrape_notes` | 抓取笔记 | `{noteIds: ["65f1a2b3c4d5e6f"]}` |
| `supercrawler:xhs_scrape_user` | 抓取用户 | `{userId: "5a3b8c9d2e1f", noteLimit: 20}` |
| `supercrawler:xhs_scrape_comments` | 抓取评论 | `{noteId: "65f1a2b3c4d5e6f", limit: 100}` |
| `supercrawler:xhs_batch` | 批量任务 | `{tasks: [...]}` |
| `supercrawler:storage_peek` | 读取结果 | `{file: "/data/output/xxx.jsonl", limit: 50}` |

**抖音工具（需要 platform="douyin"）：**
- `supercrawler:douyin_scrape_search`
- `supercrawler:douyin_scrape_awemes`
- `supercrawler:douyin_scrape_user`
- `supercrawler:douyin_scrape_comments`
- `supercrawler:douyin_batch`

**美团经营宝工具（需要 platform="meituan"）：**
- `supercrawler:meituan_scrape_orders` — 订单数据抓取
- `supercrawler:meituan_scrape_products` — 商品数据抓取
- `supercrawler:meituan_scrape_reviews` — 商品评价抓取
- `supercrawler:meituan_scrape_promotion_campaigns` — 推广通活动抓取
- `supercrawler:meituan_scrape_promotion_stats` — 推广数据统计

---

## 🔍 故障排查指南

### 问题 1：搜索返回空结果

**诊断步骤：**

1. **检查 Profile 状态**
   ```
   supercrawler:auth_profile_status({accountId: "default"})
   ```

2. **检查登录状态**
   ```
   supercrawler:auth_status({accountId: "default", platform: "xhs"})
   ```

3. **查看容器日志**
   ```bash
   docker logs supercrawler 2>&1 | grep "search:" | tail -20
   ```

**常见原因：**
| 原因 | 日志特征 | 解决方案 |
|------|----------|----------|
| 登录态过期 | `LOGIN_EXPIRED` | 重新扫码登录 |
| 锁文件冲突 | `EPERM: operation not permitted` | 重启容器 |
| 验证码拦截 | `redirected to verify` | 等待 30 分钟后重试 |
| 页面加载失败 | `DOM elements found: 0` | 检查网络和登录态 |

---

### 问题 2：登录失败

**诊断步骤：**

1. **检查浏览器状态**
   ```bash
   curl -s "http://localhost:5520/api/browser/status" | jq
   ```

2. **检查 Profile 状态**
   ```
   supercrawler:auth_profile_status({accountId: "default"})
   ```

3. **查看容器日志**
   ```bash
   docker logs supercrawler-xhs-login 2>&1 | tail -50
   ```

**常见原因：**
| 原因 | 诊断结果 | 解决方案 |
|------|---------|----------|
| Chromium 未下载 | `browser.ready: false` | 等待 2-5 分钟 |
| 锁文件残留 | `singletonLock: true` | 重启容器 |
| Xvfb 未启动 | 容器日志报错 | 确认 `CLOAK_HEADLESS=false` |

---

### 问题 3：容器重启后状态异常

**解决方案：**

1. **重启容器**（自动清理锁文件）
   ```bash
   docker restart supercrawler
   ```

2. **检查 Profile 状态**
   ```
   supercrawler:auth_profile_status({accountId: "default"})
   ```

3. **如果元数据丢失，重新登录**
   ```
   执行 Step 10 扫码登录
   ```

**注意：** 容器重启不会影响登录态（Cookie 保存在 Volume 中）

---

### 问题 4：多平台登录冲突

**症状：**
- 先登录抖音，再登录小红书
- 小红书登录后，抖音显示“未登录”

**原因：** 旧版本元数据只保存最后一个平台

**解决方案：**
- ✅ **新版本已修复**：支持多平台元数据
- ✅ **自动迁移**：首次读取时自动转换格式
- ✅ **无需手动操作**

---

## 示例 1：搜索小红书笔记

> **用户**: 搜"跑鞋"2025年6月后热门、点赞≥1000的前 5 条

**Agent 自动执行：**

1. **检查服务**
   ```
   supercrawler:health()
   → {status: "ok"}
   ```

2. **检查登录**
   ```
   supercrawler:auth_status({accountId: "default", platform: "xhs"})
   → {loggedIn: true}
   ```

3. **执行搜索**
   ```
   supercrawler:xhs_scrape_search({
     keywords: ["跑鞋"],
     sort: "popular",
     limit: 5,
     publishedAfter: "2025-06-01T00:00:00Z",
     minLikes: 1000
   })
   → {
       data: {
         file: "/data/output/xhs_search_2025-01-01.jsonl",
         count: 5,
         preview: [...]
       }
     }
   ```

4. **读取结果（可选）**
   ```
   supercrawler:storage_peek({
     file: "/data/output/xhs_search_2025-01-01.jsonl",
     limit: 50
   })
   → {items: [...]}
   ```

5. **汇总答复用户**

---

## 示例 2：抓取指定笔记

> **用户**: 帮我抓取这篇笔记的详情：65f1a2b3c4d5e6f

**Agent 自动执行：**

1. **执行抓取**
   ```
   supercrawler:xhs_scrape_notes({
     noteIds: ["65f1a2b3c4d5e6f"]
   })
   → {data: {file: "...", count: 1, preview: [...]}}
   ```

2. **读取详情**
   ```
   supercrawler:storage_peek({file: data.file, limit: 50})
   ```

3. **返回笔记详情**

---

## 示例 3：抓取用户主页

> **用户**: 抓取这个用户的主页：5a3b8c9d2e1f，获取最近 20 条笔记

**Agent 自动执行：**

```
supercrawler:xhs_scrape_user({
  userId: "5a3b8c9d2e1f",
  noteLimit: 20
})
```

---

## 示例 4：批量任务

> **用户**: 搜索"跑步装备"，并抓取前 3 篇笔记的评论

**Agent 自动执行：**

```
supercrawler:xhs_batch({
  tasks: [
    {type: "search", keywords: ["跑步装备"], limit: 3},
    {type: "comments", id: "笔记ID1", limit: 50},
    {type: "comments", id: "笔记ID2", limit: 50},
    {type: "comments", id: "笔记ID3", limit: 50}
  ]
})
```

---

## 示例 5：抖音搜索

> **用户**: 搜抖音"健身教程"热门视频

**Agent 自动执行：**

1. **检查抖音登录**
   ```
   supercrawler:auth_status({accountId: "default", platform: "douyin"})
   ```

2. **执行搜索**
   ```
   supercrawler:douyin_scrape_search({
     keywords: ["健身教程"],
     sort: "popular",
     limit: 10
   })
   ```

---

# ⚠️ 重要注意事项

## 1. MCP vs HTTP API

| 方式 | 使用场景 | 推荐度 |
|------|---------|--------|
| **MCP Tools** | OpenClaw Agent 日常使用 | ⭐⭐⭐⭐⭐ |
| HTTP API | 调试、手动测试、登录临时用 | ⭐⭐ |

**为什么用 MCP？**
- ✅ Agent 自动发现工具
- ✅ Skills 提供完整工作流
- ✅ 自动错误处理
- ✅ 不需要手动拼 JSON
- ✅ 类型安全

## 2. 登录态管理

- 登录态持久化在 `~/supercrawler/data/profiles` 目录
- **不要删除此目录**，否则需要重新扫码
- 定期检查：`supercrawler:auth_status`

## 3. 并发限制

- 小红书并发 = 1（串行执行，避免风控）
- 美团并发 = 1（串行执行）
- 批量任务使用 `xhs_batch`，服务端自动延迟
- **不要并发调用多个 xhs_* 或 meituan_* 工具**

## 4. 错误码处理

| 错误 | 处理 |
|------|------|
| `LOGIN_REQUIRED` | 重新执行 Step 10 扫码登录 |
| `RATE_LIMITED` | 等待 5-10 分钟后重试 |
| `XHS_BLOCKED` | 等待 30 分钟以上 |
| `TIMEOUT` | 重试 ≤2 次 |

## 5. Skills 自动触发

配置好 Skills 后，Agent 会自动识别用户意图：

```
用户说："帮我搜小红书跑鞋"
    ↓
Agent 识别到"小红书"+"搜"
    ↓
自动触发 xhs-scraper skill
    ↓
调用 supercrawler:xhs_scrape_search
```

**无需手动指定工具！**

---

## 示例 5：美团经营宝 - 抓取订单数据

> **用户**: 帮我抓取美团经营宝最近 7 天的订单

**Agent 自动执行：**

1. **检查服务**
   ```
   supercrawler:health()
   → {status: "ok"}
   ```

2. **检查美团登录**
   ```
   supercrawler:auth_status({accountId: "meituan-default", platform: "meituan"})
   → {loggedIn: true}
   ```
   
   *如果未登录，Agent 会调用：*
   ```
   supercrawler:auth_login({accountId: "meituan-default", platform: "meituan"})
   → 弹出浏览器，等待用户登录
   ```

3. **抓取订单**
   ```
   supercrawler:meituan_scrape_orders({
     startDate: "2025-05-04T00:00:00Z",
     endDate: "2025-05-11T23:59:59Z",
     limit: 100
   })
   → {
       data: {
         file: "/data/output/meituan-orders-2025-05-11.jsonl",
         count: 85,
         preview: [
           {id: "123456", title: "商品A", brief: "￥50 | 已完成"},
           ...
         ]
       }
     }
   ```

4. **汇总答复**
   - 订单总数：85 单
   - 总金额：￥4,250
   - 完成状态分布

---

## 示例 6：美团经营宝 - 推广数据分析

> **用户**: 查看最近 30 天的推广效果，ROI 怎么样？

**Agent 自动执行：**

1. **抓取推广通活动**
   ```
   supercrawler:meituan_scrape_promotion_campaigns({
     status: "running",
     limit: 50
   })
   → 获取所有运行中的活动
   ```

2. **抓取推广统计数据**
   ```
   supercrawler:meituan_scrape_promotion_stats({
     period: "day",
     startDate: "2025-04-11T00:00:00Z",
     endDate: "2025-05-11T23:59:59Z"
   })
   → 获取每日推广数据
   ```

3. **抓取订单数据**
   ```
   supercrawler:meituan_scrape_orders({
     startDate: "2025-04-11T00:00:00Z",
     endDate: "2025-05-11T23:59:59Z",
     limit: 200
   })
   → 获取订单数据用于对比
   ```

4. **分析并生成报告**
   - 推广总消耗：￥5,000
   - 推广带来订单：120 单
   - 推广收入：￥15,000
   - **ROI = 15000 / 5000 = 3.0**
   - 平均 CTR：5.2%
   - 最佳表现活动：活动A（ROI 4.5）
   - 优化建议：增加活动A预算，暂停活动C

---

## 示例 7：美团经营宝 - 商品评价分析

> **用户**: 抓取商品 123456 的评价，看看用户反馈如何

**Agent 自动执行：**

```
supercrawler:meituan_scrape_reviews({
  productId: "123456",
  limit: 100
})
→ 获取 100 条评价
```

**分析结果：**
- 平均评分：4.5 星
- 好评率：90%
- 关键词分析：“口味好”、“配送快”、“包装精美”
- 负面反馈：“价格稍贵”（5%）

---

# 📞 运维命令

```bash
# 查看日志
docker logs -f supercrawler

# 重启服务
docker restart supercrawler

# 停止服务
docker stop supercrawler

# 更新镜像
docker pull ghcr.io/shun83914/supercrawler:v1.0.5-debian-arm64
docker stop supercrawler
docker rm supercrawler
# 重新执行阶段 1 Step 3 启动命令

# 查看数据
ls -lh ~/supercrawler/data/output/

# 查看登录态
ls -lh ~/supercrawler/data/profiles/
```

---

# 🚀 现在请开始执行

**你的任务：**

1. ✅ 执行 **阶段 1**（Step 1-4）：完成 Docker 部署
2. ✅ 执行 **阶段 2**（Step 5）：配置 MCP Server
3. ✅ 执行 **阶段 3**（Step 6-8）：安装 Skills
4. ✅ 重启 OpenClaw，验证工具列表
5. ✅ 执行 **阶段 4**（Step 9-10）：**完成小红书 + 抖音双平台登录**
   - 检查小红书登录状态
   - 扫码登录小红书
   - 检查抖音登录状态
   - 扫码登录抖音
   - 切换回 Headless 模式
6. ✅ 告诉我配置完成，我们就可以开始使用 MCP tools 抓取数据了！

**请从阶段 1 Step 1 开始，每步完成后告诉我结果！**

准备好了就开始吧！
```

---

# 📝 文档说明

## 为什么这样设计？

### 1. 五阶段分离

```
阶段 1（运维）  → 只需执行一次
阶段 2（配置）  → 只需执行一次
阶段 3（安装）  → 只需执行一次
阶段 4（登录）  → 首次必须，以后自动
阶段 5（使用）  → 日常重复使用
```

### 2. MCP 优先

- ✅ Agent 自动发现工具
- ✅ Skills 提供智能决策
- ✅ 类型安全、错误处理
- ❌ 不推荐手动 HTTP API（除非调试）

### 3. 登录态持久化

```
首次扫码 → 登录态保存到 profiles/
    ↓
切换 Headless → 登录态依然有效
    ↓
以后无需重新扫码（除非删除 profiles/）
```

### 4. Skills 自动触发

```
用户自然语言
    ↓
Agent 识别意图
    ↓
自动选择 Skill
    ↓
调用对应 MCP tools
```

---

## 与 OPENCLAW_SETUP.md 的区别

| 特性 | OPENCLAW_SETUP.md | OPENCLAW_AGENT_INSTRUCTIONS.md |
|------|-------------------|-------------------------------|
| **目标读者** | 运维人员（人工） | OpenClaw Main Agent |
| **使用方式** | 人工阅读执行 | 复制粘贴给 Agent |
| **内容重点** | Xvfb/scrot 技术细节 | 完整可执行命令 |
| **交互方式** | 人工判断 | Agent 自动执行 |
| **使用工具** | HTTP API | MCP + Skills |

---

## 常见问题

### Q1: 为什么不直接用 HTTP API？

**A:** 
- HTTP API 需要手动拼 JSON
- 没有类型检查
- 没有自动错误处理
- Agent 需要自己实现工作流

**MCP + Skills 的优势：**
- ✅ 工具自动发现
- ✅ 类型安全
- ✅ 自动错误处理
- ✅ Skills 提供完整工作流
- ✅ Agent 只需调用工具

### Q2: HTTP API 什么时候用？

**A:** 只在以下情况：
- 调试问题时
- 登录时获取二维码截图（临时）
- 手动测试 API

### Q3: Skills 必须安装吗？

**A:** 
- **推荐安装**：Agent 自动识别意图
- **不安装也可以**：手动调用 MCP tools
- 安装后体验更好

### Q4: 登录态会过期吗？

**A:** 
- 通常不会（持久化在 profiles/）
- 小红书可能定期要求重新扫码
- 定期检查 `auth_status`

### Q5: 如何更新 SuperCrawler？

**A: 使用 `latest` 标签，自动获取最新版本！**

#### 方式 1：简单更新（推荐）

```bash
# 1. 停止旧容器
docker stop supercrawler
docker rm supercrawler

# 2. 拉取最新版本（自动获取最新版）
ARCH=$(uname -m)
if [ "$ARCH" = "arm64" ]; then
  IMAGE="ghcr.io/shun83914/supercrawler:latest-debian-arm64"
else
  IMAGE="ghcr.io/shun83914/supercrawler:latest-debian-amd64"
fi

docker pull $IMAGE

# 3. 启动新容器（登录态保留）
docker run -d --name supercrawler -p 5510:5510 \
  -v ~/supercrawler/data:/data \
  -e CLOAK_HEADLESS=true \
  -e CLOAK_TIMEZONE=Asia/Shanghai \
  -e CLOAK_LOCALE=zh-CN \
  $IMAGE

# 4. 验证版本
docker exec supercrawler node -e "console.log('当前版本:', require('./package.json').version)"

# 5. 无需重新扫码！
```

#### 方式 2: Agent 自动检查更新

你可以让 Agent 定期检查更新：

```bash
# 检查最新版本
echo "🔍 检查最新版本..."

# 获取本地版本
LOCAL_VERSION=$(docker exec supercrawler node -e "console.log(require('./package.json').version)" 2>/dev/null || echo "unknown")
echo "📦 本地版本: $LOCAL_VERSION"

# 拉取最新版本（不启动）
ARCH=$(uname -m)
if [ "$ARCH" = "arm64" ]; then
  IMAGE="ghcr.io/shun83914/supercrawler:latest-debian-arm64"
else
  IMAGE="ghcr.io/shun83914/supercrawler:latest-debian-amd64"
fi

docker pull $IMAGE

# 获取远程版本
REMOTE_VERSION=$(docker inspect "$IMAGE" --format='{{index .Config.Labels "org.opencontainers.image.version"}}' 2>/dev/null || echo "unknown")
echo "🌐 远程版本: $REMOTE_VERSION"

# 比较版本
if [ "$LOCAL_VERSION" != "$REMOTE_VERSION" ] && [ "$REMOTE_VERSION" != "unknown" ]; then
  echo ""
  echo "✅ 发现新版本: $REMOTE_VERSION"
  echo "💡 执行更新命令:"
  echo "   docker stop supercrawler && docker rm supercrawler"
  echo "   docker run -d --name supercrawler -p 5510:5510 -v ~/supercrawler/data:/data -e CLOAK_HEADLESS=true $IMAGE"
else
  echo ""
  echo "✅ 已是最新版本"
fi
```

#### 版本策略

| 场景 | 推荐标签 | 说明 |
|------|---------|------|
| **日常使用** | `latest-debian-arm64` | 自动获取最新版 |
| **生产环境** | `v1.0.5-debian-arm64` | 锁定版本，手动更新 |
| **测试新版本** | `v1.0.6-debian-arm64` | 测试特定版本 |

### Q6: 截图工具应该用 API 还是命令行？

**A: 推荐使用 API 方式！**

#### 方式对比

| 特性 | API 方式 | 命令行方式 |
|------|---------|----------|
| **使用场景** | 登录时获取二维码 | 调试、手动测试 |
| **调用方式** | `curl /api/auth/qr-screenshot` | `docker exec ... scrot` |
| **返回格式** | base64 图片（JSON） | 文件保存到容器 |
| **自动化程度** | ✅ 高（一条命令） | ❌ 低（需要两步） |
| **错误处理** | ✅ 自动（返回 error 字段） | ❌ 手动检查文件 |
| **适合 Agent** | ✅ 是 | ❌ 否 |

#### API 方式（推荐）

```bash
# 一条命令获取二维码
QR_RESPONSE=$(curl -s "http://localhost:5510/api/auth/qr-screenshot")
SUCCESS=$(echo "$QR_RESPONSE" | jq -r '.success')

if [ "$SUCCESS" = "true" ]; then
  # 提取 base64 并保存
  echo "$QR_RESPONSE" | jq -r '.qrCode' | sed 's/data:image\/png;base64,//' | base64 -d > /tmp/qr.png
  open /tmp/qr.png  # macOS
else
  echo "截图失败: $(echo "$QR_RESPONSE" | jq -r '.error')"
fi
```

**优点：**
- ✅ 一条命令完成
- ✅ 自动错误处理
- ✅ 直接返回 base64
- ✅ Agent 可以解析 JSON

#### 命令行方式（备选）

```bash
# 需要两步操作
docker exec supercrawler sh -c 'DISPLAY=:99 scrot /tmp/qr.png -q 90'
docker cp supercrawler:/tmp/qr.png ./qr.png
```

**缺点：**
- ❌ 需要两步操作
- ❌ 无法自动判断是否成功
- ❌ 需要手动检查文件

#### 结论

**日常使用（登录二维码）：用 API**
- 在 Step 10.3 中已经使用 API 方式
- Agent 可以自动解析和展示

**调试/测试：用命令行**
- 查看虚拟显示器内容
- 测试 Xvfb 是否正常工作

---

**🎉 完成！现在你可以把完整指令复制给 OpenClaw Main Agent 了！**

---

## 💡 重要：飞书交互场景说明

**用户在飞书中与 Agent 对话，无法执行终端命令！**

### Agent 需要主动执行所有操作：

```
阶段 4 登录流程：

1. Agent 检查登录状态
   ↓
2. Agent 在飞书中询问："检测到小红书未登录，请准备好手机，回复'开始'后我会展示二维码"
   ↓
3. 用户回复："开始"
   ↓
4. Agent 执行：
   - 启动 Headed 容器
   - 触发登录
   - 获取二维码
   - 在飞书中发送二维码图片
   ↓
5. Agent 在飞书中说："请扫描上方二维码，完成后回复'已完成'"
   ↓
6. 用户扫码并回复："已完成"
   ↓
7. Agent 循环检测登录状态
   ↓
8. Agent 在飞书中说："✅ 小红书登录成功！接下来需要登录抖音..."
   ↓
9. 重复步骤 2-8 完成抖音登录
   ↓
10. Agent 在飞书中说："🎉 双平台登录完成！现在可以开始使用抓取功能了"
```

### 关键原则：

**✅ 正确做法：**
- Agent 主动执行所有技术操作
- 用户只需在飞书中回复简单的确认消息
- Agent 展示二维码图片，用户扫码

**❌ 错误做法：**
- 让用户执行 shell 命令（`./scripts/login.sh xhs`）
- 让用户自己启动容器
- 让用户手动调用 API

### 用户交互示例：

```
Agent: 📱 小红书登录

检测到小红书账号未登录，需要扫码登录。

请准备好手机上的小红书 App，回复"开始"后我会展示二维码。

---

用户: 开始

---

Agent: [发送二维码图片]

📱 请扫描小红书二维码

请使用小红书 App 扫描上方二维码。
扫码完成后回复"已完成"。

---

用户: 已完成

---

Agent: ✅ 小红书登录成功！

接下来需要登录抖音，请准备好抖音 App。
回复"开始"后我会展示抖音登录二维码。
```

---

**🚀 记住：用户只在飞书中对话，Agent 需要完成所有技术操作！**
