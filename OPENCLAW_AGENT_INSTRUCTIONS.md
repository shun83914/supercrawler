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

# 阶段 2：配置 MCP Server

## Step 5: 创建 MCP 配置

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

## Step 9: 检查登录状态

### 9.1 检查小红书登录

**使用 MCP 工具：**
```
调用: supercrawler:auth_status({
  accountId: "default",
  platform: "xhs"
})
```

**预期输出（未登录）：**
```json
{
  "accountId": "default",
  "platform": "xhs",
  "loggedIn": false
}
```

### 9.2 检查抖音登录

**使用 MCP 工具：**
```
调用: supercrawler:auth_status({
  accountId: "default",
  platform: "douyin"
})
```

**预期输出（未登录）：**
```json
{
  "accountId": "default",
  "platform": "douyin",
  "loggedIn": false
}
```

**如果任一平台 `loggedIn: false`，需要执行 Step 10 扫码登录。**

---

## Step 10: 扫码登录

> **⚠️ 注意**：此步骤需要你（用户）参与扫码。
> **需要分别登录小红书和抖音！**

### 10.1 重启为 Headed 模式

```bash
# 停止当前容器
docker stop supercrawler
docker rm supercrawler

# 判断架构
ARCH=$(uname -m)
if [ "$ARCH" = "arm64" ]; then
  IMAGE="ghcr.io/shun83914/supercrawler:latest-debian-arm64"
else
  IMAGE="ghcr.io/shun83914/supercrawler:latest-debian-amd64"
fi

# 启动 Headed 模式（自动启动 Xvfb 虚拟显示器）
docker run -d \
  --name supercrawler \
  -p 5510:5510 \
  -v ~/supercrawler/data:/data \
  -e CLOAK_HEADLESS=false \
  -e CLOAK_TIMEZONE=Asia/Shanghai \
  -e CLOAK_LOCALE=zh-CN \
  $IMAGE

echo "✅ 已重启为 Headed 模式（支持扫码）"
sleep 3
```

### 10.2 登录小红书

**使用 MCP 工具（推荐）：**
```
调用: supercrawler:auth_login({
  accountId: "default",
  platform: "xhs"
})
```

**或者用 HTTP API 临时触发：**
```bash
curl -s -X POST "http://localhost:5510/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"accountId":"default","platform":"xhs"}' &

echo "⌛ 等待小红书浏览器加载二维码..."
sleep 8
```

### 10.3 获取小红书二维码截图

**使用 HTTP API（临时）：**
```bash
QR_RESPONSE=$(curl -s "http://localhost:5510/api/auth/qr-screenshot?platform=xhs")
SUCCESS=$(echo "$QR_RESPONSE" | jq -r '.success')

if [ "$SUCCESS" = "true" ]; then
  QR_BASE64=$(echo "$QR_RESPONSE" | jq -r '.qrCode')
  QR_DATA=$(echo "$QR_BASE64" | sed 's/data:image\/png;base64,//')
  echo "$QR_DATA" | base64 -d > /tmp/qr-xhs.png
  
  echo "✅ 小红书二维码已保存到: /tmp/qr-xhs.png"
  
  # macOS 打开图片
  if [[ "$(uname)" == "Darwin" ]]; then
    open /tmp/qr-xhs.png
  fi
  
  echo ""
  echo "========================================"
  echo "📱 请使用小红书 App 扫码登录"
  echo "========================================"
  echo ""
  echo "二维码路径: /tmp/qr-xhs.png"
  echo ""
  echo "⏳ 等待你扫码...（扫码后告诉我'已扫码小红书'）"
else
  echo "❌ 获取小红书二维码失败"
  exit 1
fi
```

### 10.4 等待用户扫码小红书

**告诉用户：**
```
请打开 /tmp/qr-xhs.png 查看二维码，使用小红书 App 扫码。
扫码完成后告诉我"已扫码小红书"，我会继续检测登录状态。
```

**用户说"已扫码小红书"后，执行：**

```bash
echo "🔍 检测小红书登录状态..."

# 轮询检测（最多 60 秒）
for i in {1..12}; do
  STATUS=$(curl -s "http://localhost:5510/api/auth/status?accountId=default&platform=xhs")
  LOGGED=$(echo "$STATUS" | jq -r '.loggedIn')
  
  if [ "$LOGGED" = "true" ]; then
    echo "✅ 小红书登录成功！"
    echo "$STATUS" | jq .
    break
  fi
  
  echo "⌛ 等待小红书登录... ($i/12)"
  sleep 5
done

if [ "$LOGGED" != "true" ]; then
  echo "❌ 小红书登录超时，请重新扫码"
  exit 1
fi
```

### 10.5 登录抖音

**小红书登录成功后，继续登录抖音：**

echo ""
echo "========================================"
echo "🎵 现在登录抖音"
echo "========================================"
echo ""

**使用 MCP 工具（推荐）：**
```
调用: supercrawler:auth_login({
  accountId: "default",
  platform: "douyin"
})
```

**或者用 HTTP API 临时触发：**
```bash
curl -s -X POST "http://localhost:5510/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"accountId":"default","platform":"douyin"}' &

echo "⌛ 等待抖音浏览器加载二维码..."
sleep 8
```

### 10.6 获取抖音二维码截图

```bash
QR_RESPONSE=$(curl -s "http://localhost:5510/api/auth/qr-screenshot?platform=douyin")
SUCCESS=$(echo "$QR_RESPONSE" | jq -r '.success')

if [ "$SUCCESS" = "true" ]; then
  QR_BASE64=$(echo "$QR_RESPONSE" | jq -r '.qrCode')
  QR_DATA=$(echo "$QR_BASE64" | sed 's/data:image\/png;base64,//')
  echo "$QR_DATA" | base64 -d > /tmp/qr-douyin.png
  
  echo "✅ 抖音二维码已保存到: /tmp/qr-douyin.png"
  
  # macOS 打开图片
  if [[ "$(uname)" == "Darwin" ]]; then
    open /tmp/qr-douyin.png
  fi
  
  echo ""
  echo "========================================"
  echo "📱 请使用抖音 App 扫码登录"
  echo "========================================"
  echo ""
  echo "二维码路径: /tmp/qr-douyin.png"
  echo ""
  echo "⏳ 等待你扫码...（扫码后告诉我'已扫码抖音'）"
else
  echo "❌ 获取抖音二维码失败"
  exit 1
fi
```

### 10.7 等待用户扫码抖音

**告诉用户：**
```
请打开 /tmp/qr-douyin.png 查看二维码，使用抖音 App 扫码。
扫码完成后告诉我"已扫码抖音"，我会继续检测登录状态。
```

**用户说"已扫码抖音"后，执行：**

```bash
echo "🔍 检测抖音登录状态..."

# 轮询检测（最多 60 秒）
for i in {1..12}; do
  STATUS=$(curl -s "http://localhost:5510/api/auth/status?accountId=default&platform=douyin")
  LOGGED=$(echo "$STATUS" | jq -r '.loggedIn')
  
  if [ "$LOGGED" = "true" ]; then
    echo "✅ 抖音登录成功！"
    echo "$STATUS" | jq .
    break
  fi
  
  echo "⌛ 等待抖音登录... ($i/12)"
  sleep 5
done

if [ "$LOGGED" != "true" ]; then
  echo "❌ 抖音登录超时，请重新扫码"
  exit 1
fi
```

### 10.8 切换回 Headless 模式

**两个平台都登录成功后，切换回 Headless 模式：**

```bash
# 停止 Headed 容器
docker stop supercrawler
docker rm supercrawler

# 重新启动为 Headless 模式
ARCH=$(uname -m)
if [ "$ARCH" = "arm64" ]; then
  IMAGE="ghcr.io/shun83914/supercrawler:latest-debian-arm64"
else
  IMAGE="ghcr.io/shun83914/supercrawler:latest-debian-amd64"
fi

docker run -d \
  --name supercrawler \
  -p 5510:5510 \
  -v ~/supercrawler/data:/data \
  -e CLOAK_HEADLESS=true \
  -e CLOAK_TIMEZONE=Asia/Shanghai \
  -e CLOAK_LOCALE=zh-CN \
  $IMAGE

echo "✅ 已切换回 Headless 模式（高效抓取）"
sleep 3

# 验证小红书登录态持久化
echo "🔍 检查小红书登录态:"
curl -s "http://localhost:5510/api/auth/status?accountId=default&platform=xhs" | jq .

echo ""
echo "🔍 检查抖音登录态:"
curl -s "http://localhost:5510/api/auth/status?accountId=default&platform=douyin" | jq .
```

**预期输出：**
```json
{
  "accountId": "default",
  "platform": "xhs",
  "loggedIn": true,
  "userId": "xxx",
  "nickname": "xxx"
}
{
  "accountId": "default",
  "platform": "douyin",
  "loggedIn": true,
  "userId": "xxx",
  "nickname": "xxx"
}
```

**两个平台的登录态都已持久化！** 以后无需重新扫码（除非删除 `~/supercrawler/data/profiles`）。

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
| `supercrawler:auth_login` | 扫码登录 | `{accountId: "default", platform: "xhs"}` |
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
