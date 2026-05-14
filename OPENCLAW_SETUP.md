# OpenClaw 配置 SuperCrawler — Agent 全自动安装与使用指南

> **🎯 目标**：让 OpenClaw Main Agent 自动完成以下所有步骤：
> 1. ✅ 检测并启动 Docker 容器（自动判断系统架构选择镜像）
> 2. ✅ 检测登录状态（自动判断是否需要登录）
> 3. ✅ 获取二维码截图（Xvfb + scrot 自动截图并返回图片）
> 4. ✅ 等待用户扫码并确认登录成功
> 5. ✅ 配置 MCP Server 和 Skills
> 6. ✅ 执行抓取任务
>
> **📌 核心特性**：
> - **零依赖讨论**：Agent 自动判断并执行，无需反复询问用户
> - **全自动登录**：自动检测登录态，自动截图提供二维码
> - **智能决策**：根据登录状态自动决定下一步操作
> - **跨平台支持**：自动检测 macOS/Linux + ARM64/AMD64

---

## 🤖 Agent 全自动执行流程

> **⚠️ 重要**：Agent 请严格按照以下步骤顺序执行，不要跳过任何步骤，不要询问用户（除非明确要求扫码）。

---

### Step 1: 验证 Docker 容器状态

**执行命令：**
```bash
# 检查容器是否运行
if docker ps --filter "name=supercrawler" --format "{{.Names}}" | grep -q supercrawler; then
  echo "✅ supercrawler 容器正在运行"
  docker ps --filter "name=supercrawler" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
else
  echo "⚠️  supercrawler 容器未运行，正在启动..."
  
  # 判断操作系统类型和架构
  OS_TYPE=$(uname -s)
  
  if [ "$OS_TYPE" = "Darwin" ]; then
    # macOS 系统（通常是 ARM64）
    ARCH=$(uname -m)
    if [ "$ARCH" = "arm64" ]; then
      IMAGE="ghcr.io/shun83914/supercrawler:v1.0.5-debian-arm64"
      echo "🍎 检测到 macOS ARM64 系统"
    else
      IMAGE="ghcr.io/shun83914/supercrawler:v1.0.5-debian-amd64"
      echo "🍎 检测到 macOS AMD64 系统"
    fi
  elif [ "$OS_TYPE" = "Linux" ]; then
    # Linux 系统
    ARCH=$(uname -m)
    if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
      IMAGE="ghcr.io/shun83914/supercrawler:v1.0.5-debian-arm64"
      echo "🐧 检测到 Linux ARM64 系统"
    else
      IMAGE="ghcr.io/shun83914/supercrawler:v1.0.5-debian-amd64"
      echo "🐧 检测到 Linux AMD64 系统"
    fi
  else
    # 其他系统默认 amd64
    IMAGE="ghcr.io/shun83914/supercrawler:v1.0.5-debian-amd64"
    echo "🖥️  检测到 $OS_TYPE 系统（使用 AMD64 镜像）"
  fi
  
  # 启动容器（Headless 模式，需要登录时会自动切换）
  echo "🚀 启动容器: $IMAGE"
  docker run -d --name supercrawler -p 5510:5510 \
    -v ~/supercrawler/data:/data \
    -e CLOAK_HEADLESS=true \
    "$IMAGE"
  
  # 等待容器启动
  echo "⌛ 等待容器启动..."
  sleep 5
  
  # 验证启动结果
  if docker ps --filter "name=supercrawler" --format "{{.Names}}" | grep -q supercrawler; then
    echo "✅ 容器启动成功"
    docker ps --filter "name=supercrawler" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
  else
    echo "❌ 容器启动失败，请检查 Docker 日志"
    docker logs supercrawler --tail 20
    exit 1
  fi
fi
```

**预期输出：**
```
✅ supercrawler 容器正在运行
NAMES         STATUS          PORTS
supercrawler  Up 5 minutes    0.0.0.0:5510->5510/tcp
```

**决策：**
- ✅ 容器已运行或启动成功 → 继续 Step 2
- ❌ 容器启动失败 → 检查错误日志并解决

---

### Step 2: 检测登录状态（自动判断是否需要登录）

**🎯 目标**：自动检测账号登录状态，决定是否需要扫码登录。

**执行命令：**
```bash
# 检查默认账号 (default) 的登录状态
echo "🔍 检查登录状态..."

LOGIN_STATUS=$(curl -s "http://localhost:5510/api/auth/status?accountId=default&platform=xhs")
LOGGED_IN=$(echo "$LOGIN_STATUS" | grep -o '"loggedIn":[^,}]*' | cut -d: -f2)

echo "📊 登录状态: $LOGGED_IN"

if [ "$LOGGED_IN" = "true" ]; then
  echo "✅ 账号已登录，跳过扫码步骤"
  echo "$LOGIN_STATUS" | jq . 2>/dev/null || echo "$LOGIN_STATUS"
  NEED_LOGIN=false
else
  echo "⚠️  账号未登录，需要扫码登录"
  NEED_LOGIN=true
fi
```

**预期输出（已登录）：**
```json
🔍 检查登录状态...
📊 登录状态: true
✅ 账号已登录，跳过扫码步骤
{
  "accountId": "default",
  "platform": "xhs",
  "loggedIn": true,
  "userId": "123456",
  "nickname": "用户昵称"
}
```

**预期输出（未登录）：**
```
🔍 检查登录状态...
📊 登录状态: false
⚠️  账号未登录，需要扫码登录
```

**决策：**
- ✅ `LOGGED_IN = true` → 跳过 Step 3，直接到 Step 4
- ⚠️ `LOGGED_IN = false` → 继续 Step 3（扫码登录）

---

### Step 3: 扫码登录流程（仅未登录时执行）

**🎯 目标**：使用 Xvfb + Headed 模式 + scrot 截图，自动获取二维码并提供给用户扫码。

**📌 技术原理：**
```
Docker 容器（无显示器）
    ↓
重启为 Headed 模式（CLOAK_HEADLESS=false）
    ↓
Xvfb 自动启动虚拟显示器（:99）
    ↓
浏览器在虚拟显示器中打开二维码页面
    ↓
scrot 截图工具截取二维码
    ↓
复制截图到宿主机
    ↓
展示给用户扫码
```

#### 3.1 重启容器为 Headed 模式

**执行命令：**
```bash
echo "🔄 重启容器为 Headed 模式（支持扫码）..."

# 停止当前容器
docker stop supercrawler
docker rm supercrawler

# 重新启动为 Headed 模式
docker run -d --name supercrawler -p 5510:5510 \
  -v ~/supercrawler/data:/data \
  -e CLOAK_HEADLESS=false \
  ghcr.io/shun83914/supercrawler:v1.0.5-debian-$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')

# 等待容器启动
echo "⌛ 等待容器启动..."
sleep 5

# 验证 Xvfb 是否自动启动
docker logs supercrawler 2>&1 | grep -q "Xvfb" && \
  echo "✅ Xvfb 虚拟显示器已自动启动" || \
  echo "⚠️  Xvfb 未启动（可能不需要）"
```

**预期输出：**
```
🔄 重启容器为 Headed 模式（支持扫码）...
supercrawler
supercrawler
⌛ 等待容器启动...
✅ Xvfb 虚拟显示器已自动启动
```

#### 3.2 触发登录并获取二维码截图

**执行命令：**
```bash
echo "🔐 触发登录请求..."

# 触发登录 API（后台执行）
curl -s -X POST "http://localhost:5510/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"accountId":"default","platform":"xhs"}' > /dev/null &
LOGIN_PID=$!

# 等待浏览器加载二维码
echo "⌛ 等待浏览器加载二维码..."
sleep 8

# 方式 1：使用新的截图 API（推荐，更简单）
echo "📸 通过 API 获取二维码..."
QR_RESPONSE=$(curl -s "http://localhost:5510/api/auth/qr-screenshot")
SUCCESS=$(echo "$QR_RESPONSE" | grep -o '"success":[^,}]*' | cut -d: -f2)

if [ "$SUCCESS" = "true" ]; then
  # 提取 base64 并保存为文件
  QR_BASE64=$(echo "$QR_RESPONSE" | grep -o '"qrCode":"[^"]*"' | cut -d'"' -f4)
  QR_FILE="/tmp/qr-$(date +%s).png"
  
  # 去掉 data:image/png;base64, 前缀
  echo "$QR_BASE64" | sed 's/data:image\/png;base64,//' | base64 -d > "$QR_FILE"
  
  echo "✅ 二维码截图已获取: $QR_FILE"
  FILE_SIZE=$(stat -f%z "$QR_FILE" 2>/dev/null || stat -c%s "$QR_FILE" 2>/dev/null || echo "unknown")
  echo "📊 文件大小: $FILE_SIZE bytes"
else
  ERROR=$(echo "$QR_RESPONSE" | grep -o '"error":"[^"]*"' | cut -d'"' -f4)
  echo "❌ 截图失败: $ERROR"
  echo "💡 请确认："
  echo "   1. 容器以 Headed 模式运行 (CLOAK_HEADLESS=false)"
  echo "   2. 已触发登录 API"
  echo "   3. 等待了足够时间（8 秒）"
  exit 1
fi

# 方式 2：手动使用 scrot（备选）
# docker exec -e DISPLAY=:99 supercrawler scrot /tmp/qr-code.png -q 90
# docker cp supercrawler:/tmp/qr-code.png "$QR_FILE"
```

**预期输出：**
```
🔐 触发登录请求...
⌛ 等待浏览器加载二维码...
📸 截取二维码...
✅ 二维码截图已保存: /tmp/qr-1234567890.png
📊 文件大小: 125432 bytes
```

#### 3.3 展示二维码并等待用户扫码

**执行命令：**
```bash
echo ""
echo "========================================"
echo "📱 请使用小红书 App 扫码登录"
echo "========================================"
echo ""
echo "二维码已保存到: $QR_FILE"
echo ""

# macOS 打开图片
if [[ "$(uname)" == "Darwin" ]]; then
  open "$QR_FILE"
  echo "✅ 已在默认图片查看器中打开"
elif command -v xdg-open &> /dev/null; then
  xdg-open "$QR_FILE"
  echo "✅ 已在默认图片查看器中打开"
else
  echo "⚠️  请手动打开截图: $QR_FILE"
fi

echo ""
echo "⌛ 等待扫码..."
echo "   （最长等待 5 分钟，扫码后自动检测）"
echo ""
```

**重要提示：**
> 📢 **Agent 提示用户**：
> ```
> 二维码截图已打开，请使用小红书 App 扫码。
> 扫码后我会自动检测登录状态，无需手动确认。
> ```

#### 3.4 轮询检测登录状态

**执行命令：**
```bash
# 轮询检测登录状态（最多 5 分钟）
TIMEOUT=300  # 5 分钟
INTERVAL=5   # 每 5 秒检测一次
ELAPSED=0
LOGIN_SUCCESS=false

while [ $ELAPSED -lt $TIMEOUT ]; do
  sleep $INTERVAL
  ELAPSED=$((ELAPSED + INTERVAL))
  
  # 检查登录状态
  STATUS=$(curl -s "http://localhost:5510/api/auth/status?accountId=default&platform=xhs")
  LOGGED=$(echo "$STATUS" | grep -o '"loggedIn":[^,}]*' | cut -d: -f2)
  
  if [ "$LOGGED" = "true" ]; then
    echo ""
    echo "========================================"
    echo "✅ 登录成功！"
    echo "========================================"
    echo "$STATUS" | jq . 2>/dev/null || echo "$STATUS"
    LOGIN_SUCCESS=true
    break
  fi
  
  # 每 30 秒提示一次
  if [ $((ELAPSED % 30)) -eq 0 ]; then
    echo "   ⌛ 已等待 ${ELAPSED}s，请扫码..."
  fi
done

if [ "$LOGIN_SUCCESS" = false ]; then
  echo ""
  echo "❌ 登录超时（${TIMEOUT}s）"
  echo "💡 请检查："
  echo "   1. 二维码是否过期（截图后请尽快扫码）"
  echo "   2. 网络连接是否正常"
  echo "   3. 小红书 App 是否正常"
  exit 1
fi
```

**预期输出（成功）：**
```========================================
✅ 登录成功！
========================================
{
  "accountId": "default",
  "platform": "xhs",
  "loggedIn": true,
  "userId": "123456",
  "nickname": "用户昵称",
  "checkedAt": "2026-05-11T15:30:00.000Z"
}
```

#### 3.5 切换回 Headless 模式（可选，高效抓取）

**执行命令：**
```bash
echo ""
echo "🔄 切换回 Headless 模式（高效抓取）..."

# 停止容器
docker stop supercrawler
docker rm supercrawler

# 重新启动为 Headless 模式
docker run -d --name supercrawler -p 5510:5510 \
  -v ~/supercrawler/data:/data \
  -e CLOAK_HEADLESS=true \
  ghcr.io/shun83914/supercrawler:v1.0.5-debian-$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')

# 等待启动
sleep 3

# 验证登录态仍然有效
STATUS=$(curl -s "http://localhost:5510/api/auth/status?accountId=default&platform=xhs")
LOGGED=$(echo "$STATUS" | grep -o '"loggedIn":[^,}]*' | cut -d: -f2)

if [ "$LOGGED" = "true" ]; then
  echo "✅ 切换成功，登录态保持有效"
else
  echo "⚠️  登录态丢失，需要重新登录"
fi
```

**预期输出：**
```
🔄 切换回 Headless 模式（高效抓取）...
supercrawler
supercrawler
✅ 切换成功，登录态保持有效
```

---

### Step 4: 创建 OpenClaw 配置目录

**执行命令：**
```bash
# 检查目录是否存在，不存在则创建
if [ ! -d ~/.openclaw ]; then
  mkdir -p ~/.openclaw
  echo "✅ 已创建 ~/.openclaw 目录"
else
  echo "✅ ~/.openclaw 目录已存在"
fi
```

**说明：** 确保 `~/.openclaw` 目录存在

---

### Step 5: 配置 MCP Server

**检查是否已有 mcp.json：**
```bash
if [ -f ~/.openclaw/mcp.json ]; then
  echo "文件已存在，显示当前内容："
  cat ~/.openclaw/mcp.json | jq .
  echo ""
  read -p "是否覆盖现有配置？(y/N) " confirm
  if [[ $confirm != "y" ]]; then
    echo "跳过 MCP 配置"
    exit 0
  fi
fi
```

**创建/更新 mcp.json：**
```bash
cat > ~/.openclaw/mcp.json << 'EOF'
{
  "$schema": "https://openclaw.dev/schema/mcp.json",
  "mcpServers": {
    "supercrawler": {
      "command": "docker",
      "args": [
        "exec", "-i", "supercrawler",
        "node", "dist/mcp/mcp.stdio.js"
      ],
      "env": {
        "PROFILE_DIR": "/data/profiles",
        "OUTPUT_DIR": "/data/output"
      }
    }
  }
}
EOF
```

**验证 JSON 格式：**
```bash
cat ~/.openclaw/mcp.json | jq . > /dev/null && echo "✅ JSON 格式正确" || echo "❌ JSON 格式错误"
```

**如果有 API_TOKEN，添加环境变量：**
```bash
# 如果用户提供了 SUPERCRAWLER_TOKEN
if [ -n "$SUPERCRAWLER_TOKEN" ]; then
  # 更新 mcp.json，添加 env.SUPERCRAWLER_TOKEN
  jq '.mcpServers.supercrawler.env.SUPERCRAWLER_TOKEN = env.SUPERCRAWLER_TOKEN' ~/.openclaw/mcp.json > /tmp/mcp_tmp.json && mv /tmp/mcp_tmp.json ~/.openclaw/mcp.json
  echo "✅ 已添加 API_TOKEN 配置"
fi
```

---

### Step 6: 安装 Skills（可选但推荐）

**下载 Skills 文件：**
```bash
cd /tmp
git clone --depth 1 https://github.com/shun83914/supercrawler.git 2>/dev/null || {
  echo "Git clone 失败，尝试下载 ZIP..."
  curl -sL https://github.com/shun83914/supercrawler/archive/refs/heads/main.zip -o supercrawler.zip
  unzip -q supercrawler.zip
  mv supercrawler-main supercrawler
}

# 复制 skills 目录
cp -r supercrawler/.openclaw/skills ~/.openclaw/
rm -rf supercrawler supercrawler.zip

echo "✅ Skills 已安装到 ~/.openclaw/skills/"
```

**验证 Skills 结构：**
```bash
echo "已安装的 Skills："
for skill in ~/.openclaw/skills/*/; do
  skill_name=$(basename "$skill")
  if [ -f "$skill/skill.json" ] && [ -f "$skill/SKILL.md" ]; then
    echo "  ✅ $skill_name"
  else
    echo "  ⚠️  $skill_name (文件不完整)"
  fi
done
```

---

### Step 7: 配置环境变量（如果需要）

**检查用户是否提供了 token：**
```bash
# 统一使用 SUPERCRAWLER_TOKEN 变量名
# 服务端（API_TOKEN）和 Skills 钩子都读取这个变量
if [ -n "$SUPERCRAWLER_TOKEN" ]; then
  # 添加到 shell 配置
  if ! grep -q "SUPERCRAWLER_TOKEN" ~/.zshrc 2>/dev/null; then
    echo 'export SUPERCRAWLER_TOKEN="'$SUPERCRAWLER_TOKEN'"' >> ~/.zshrc
    echo "✅ 已添加到 ~/.zshrc"
  fi
  
  if ! grep -q "SUPERCRAWLER_TOKEN" ~/.bashrc 2>/dev/null; then
    echo 'export SUPERCRAWLER_TOKEN="'$SUPERCRAWLER_TOKEN'"' >> ~/.bashrc
    echo "✅ 已添加到 ~/.bashrc"
  fi
  
  # 立即生效
  export SUPERCRAWLER_TOKEN
  echo "✅ 环境变量已设置（SUPERCRAWLER_TOKEN）"
else
  echo "⚠️  未提供 SUPERCRAWLER_TOKEN，如果服务需要鉴权，请手动配置"
  echo "   在 .env 中设置 SUPERCRAWLER_TOKEN=xxx"
fi
```

---

### Step 8: 验证配置

**测试 MCP 连接（如果 openclaw CLI 可用）：**
```bash
if command -v openclaw &> /dev/null; then
  echo "重启 OpenClaw..."
  openclaw restart 2>/dev/null || echo "请手动重启 OpenClaw"
  
  sleep 2
  
  echo "检查 MCP 服务器列表："
  openclaw mcp list 2>/dev/null || echo "请手动执行 /mcp list 验证"
else
  echo "⚠️  openclaw CLI 未安装，请手动重启 OpenClaw 并执行："
  echo "  /mcp list"
fi
```

**测试 Docker MCP 通道：**
```bash
echo "测试 Docker MCP 通道..."
docker exec supercrawler node -e "console.log('MCP stdio ready')" 2>/dev/null && \
  echo "✅ Docker MCP 通道正常" || \
  echo "❌ Docker MCP 通道异常，请检查容器状态"
```

---

### Step 9: 生成配置报告

**输出给用户：**
```bash
echo ""
echo "=========================================="
echo "✅ SuperCrawler OpenClaw 配置完成"
echo "=========================================="
echo ""
echo "📋 配置摘要："
echo "  • MCP 配置：~/.openclaw/mcp.json"
echo "  • Skills 目录：~/.openclaw/skills/"
echo "  • 容器名：supercrawler"
echo ""
echo "📦 已安装的 Skills："
ls ~/.openclaw/skills/ 2>/dev/null | sed 's/^/  • /'
echo ""
echo "🚀 下一步："
echo "  1. 重启 OpenClaw"
echo "  2. 执行 /mcp list 确认 supercrawler 已连接"
echo "  3. 执行 /skills list 查看可用 skills"
echo "  4. 开始使用抓取功能"
echo ""
echo "📖 详细文档：https://github.com/shun83914/supercrawler"
echo "=========================================="
```

---

### Step 10: 执行抓取任务（验证整个流程）

**🎯 目标**：验证从登录到抓取的完整流程。

**执行命令：**
```bash
echo "========================================"
echo "🚀 开始执行抓取任务"
echo "========================================"
echo ""

# 1. 最终确认登录状态
echo "1️⃣ 确认登录状态..."
STATUS=$(curl -s "http://localhost:5510/api/auth/status?accountId=default&platform=xhs")
LOGGED=$(echo "$STATUS" | grep -o '"loggedIn":[^,}]*' | cut -d: -f2)

if [ "$LOGGED" != "true" ]; then
  echo "❌ 登录态无效，请重新执行 Step 3"
  exit 1
fi
echo "✅ 登录态有效"
echo ""

# 2. 检查服务健康状态
echo "2️⃣ 检查服务健康状态..."
HEALTH=$(curl -s "http://localhost:5510/api/health")
HEALTH_STATUS=$(echo "$HEALTH" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)

if [ "$HEALTH_STATUS" = "ok" ]; then
  echo "✅ 服务健康"
else
  echo "⚠️  服务状态异常: $HEALTH_STATUS"
fi
echo ""

# 3. 执行小红书搜索抓取
echo "3️⃣ 执行小红书搜索抓取..."
echo "🔍 搜索关键词: 穿搭"
echo "📊 排序方式: hot"
echo "🔢 数量限制: 3"
echo ""

SEARCH_RESULT=$(curl -s -X POST "http://localhost:5510/api/xhs/search" \
  -H "Content-Type: application/json" \
  -d '{
    "keywords": ["穿搭"],
    "sort": "hot",
    "limit": 3
  }')

# 检查是否成功
SUCCESS=$(echo "$SEARCH_RESULT" | grep -o '"success":[^,}]*' | cut -d: -f2)

if [ "$SUCCESS" = "true" ]; then
  COUNT=$(echo "$SEARCH_RESULT" | grep -o '"count":[^,}]*' | cut -d: -f2)
  echo "✅ 抓取成功！"
  echo "📊 获取到 $COUNT 条结果"
  echo ""
  echo "📄 部分结果："
  echo "$SEARCH_RESULT" | jq '.data.items[] | {title: .title, author: .author, likes: .likes}' 2>/dev/null | head -30
else
  echo "❌ 抓取失败"
  echo "$SEARCH_RESULT" | jq . 2>/dev/null || echo "$SEARCH_RESULT"
fi

echo ""
echo "========================================"
echo "✅ 完整流程验证完成"
echo "========================================"
```

**预期输出：**
```
========================================
🚀 开始执行抓取任务
========================================

1️⃣ 确认登录状态...
✅ 登录态有效

2️⃣ 检查服务健康状态...
✅ 服务健康

3️⃣ 执行小红书搜索抓取...
🔍 搜索关键词: 穿搭
📊 排序方式: hot
🔢 数量限制: 3

✅ 抓取成功！
📊 获取到 3 条结果

📄 部分结果：
{
  "title": "春季穿搭指南",
  "author": "时尚达人",
  "likes": 1234
}
...

========================================
✅ 完整流程验证完成
========================================
```

---

## 📚 核心技术说明

### Xvfb + Headed + scrot 工作原理

#### 1. 为什么需要 Xvfb？

```
Docker 容器默认环境：
┌────────────────────────┐
│  纯命令行 (No GUI)      │
│  $ _                   │
│                        │
│  ❌ 没有显示器          │
│  ❌ 无法显示浏览器窗口   │
└────────────────────────┘

添加 Xvfb 后：
┌────────────────────────┐
│  Xvfb 虚拟显示器 (:99)  │
│  ┌──────────────────┐  │
│  │  内存中的屏幕     │  │
│  │  [浏览器窗口]    │  │ ← 浏览器以为有显示器
│  └──────────────────┘  │
│                        │
│  ✅ 支持 Headed 模式    │
│  ✅ 支持扫码登录        │
└────────────────────────┘
```

#### 2. scrot 截图工具

**安装位置：** `/usr/bin/scrot`（打包在 Docker 镜像中）

**使用方式：**

**方式 1：通过 API（推荐）**
```bash
# 直接调用截图 API，返回 base64 图片
curl http://localhost:5510/api/auth/qr-screenshot

# 返回：
# {
#   "success": true,
#   "qrCode": "data:image/png;base64,iVBOR..."
# }
```

**方式 2：手动使用 scrot**
```bash
# scrot 通过 DISPLAY 环境变量指定显示器（不是 -d 参数！）
# -d 参数是 delay（延迟），不是 display
docker exec -e DISPLAY=:99 supercrawler scrot /tmp/qr.png -q 90
#             ↑                  ↑      ↑
#          设置环境变量        工具    输出路径

# 复制到宿主机
docker cp supercrawler:/tmp/qr.png ./qr.png
```

**参数说明：**
- `DISPLAY=:99`：环境变量，指定虚拟显示器编号
- `-q 90`：图片质量 90%
- `/tmp/qr.png`：输出路径
- ⚠️ **注意**：`-d` 参数是 delay（延迟秒数），不是 display！

#### 3. 完整流程图

```
┌─────────────────────────────────────────────┐
│ Step 1: 启动容器 (Headless)                 │
│ docker run -e CLOAK_HEADLESS=true           │
└──────────────┬──────────────────────────────┘
               ↓
┌─────────────────────────────────────────────┐
│ Step 2: 检测登录状态                         │
│ curl /api/auth/status                       │
│ if loggedIn == true → 跳到 Step 5           │
│ if loggedIn == false → 继续 Step 3          │
└──────────────┬──────────────────────────────┘
               ↓
┌─────────────────────────────────────────────┐
│ Step 3: 扫码登录                             │
│ 3.1 重启容器 (Headed)                        │
│     docker run -e CLOAK_HEADLESS=false      │
│     → Xvfb 自动启动                          │
│                                             │
│ 3.2 触发登录                                 │
│     curl POST /api/auth/login               │
│     → 浏览器在虚拟显示器中打开二维码          │
│                                             │
│ 3.3 截图获取二维码                           │
│     docker exec -e DISPLAY=:99 scrot /tmp/qr.png    │
│     docker cp /tmp/qr.png ./qr.png          │
│     → 用户扫码                               │
│                                             │
│ 3.4 轮询检测登录成功                         │
│     curl /api/auth/status (每 5 秒)         │
│     → loggedIn == true → 继续               │
│                                             │
│ 3.5 切换回 Headless (可选)                   │
│     docker run -e CLOAK_HEADLESS=true       │
└──────────────┬──────────────────────────────┘
               ↓
┌─────────────────────────────────────────────┐
│ Step 4-9: 配置 MCP 和 Skills                │
│ (标准流程，见上文)                           │
└──────────────┬──────────────────────────────┘
               ↓
┌─────────────────────────────────────────────┐
│ Step 10: 执行抓取任务                        │
│ curl POST /api/xhs/search                   │
│ → 返回抓取结果                               │
└─────────────────────────────────────────────┘
```

### Agent 决策逻辑

```yaml
启动流程:
  1. 检测容器状态:
    - 已运行 → 继续
    - 未运行 → 自动启动 (根据系统架构选择镜像)
  
  2. 检测登录状态:
    - loggedIn: true → 跳过登录，配置 MCP
    - loggedIn: false → 执行扫码登录流程
  
  3. 扫码登录:
    a. 重启为 Headed 模式
    b. 触发登录 API
    c. scrot 截图二维码
    d. 展示给用户扫码
    e. 轮询检测登录成功
    f. 切换回 Headless 模式
  
  4. 配置 MCP 和 Skills:
    - 创建 ~/.openclaw/mcp.json
    - 下载 Skills (可选)
    - 配置环境变量
  
  5. 验证和测试:
    - 健康检查
    - 登录态验证
    - 执行测试抓取

错误处理:
  - 容器启动失败 → 输出日志，终止
  - 截图失败 → 输出日志，终止
  - 登录超时 → 提示用户，终止
  - 抓取失败 → 输出错误信息
```

---

---

## 📝 Agent 执行说明

> **🤖 给 Main Agent 的指令：**
>
> 请严格按照 Step 1-10 顺序执行，**无需询问用户**（除 Step 3.3 要求扫码外）。
>
> **⚠️ 关键规则：**
> 1. **零依赖讨论**：不要询问用户“是否需要安装 XX 工具”，直接执行
> 2. **自动判断**：
>    - 容器是否运行 → 自动检测
>    - 是否需要登录 → 自动检测
>    - 系统架构 → 自动检测
>    - 登录是否成功 → 自动轮询检测
> 3. **智能决策**：
>    - 已登录 → 跳过 Step 3，直接配置 MCP
>    - 未登录 → 自动执行完整登录流程
> 4. **错误处理**：
>    - 任何步骤失败 → 输出错误信息并终止
>    - 不要尝试自行修复（除非明确指示）
>
> **📌 唯一需要用户参与的步骤：**
> - Step 3.3：展示二维码后，提示用户“请使用小红书 App 扫码”
> - 其他所有步骤都自动完成
>
> **🔑 用户可能提供的信息：**
> - SUPERCRAWLER_TOKEN（鉴权 token）
> - 容器名（如果不是默认的 supercrawler）
> - 是否需要安装 skills（默认安装）

---

### 1. 找到 OpenClaw 配置文件

OpenClaw 配置文件位置：
- **Mac/Linux**: `~/.openclaw/mcp.json`
- **Windows**: `%USERPROFILE%\.openclaw\mcp.json`

如果文件不存在，创建它：

```bash
mkdir -p ~/.openclaw
nano ~/.openclaw/mcp.json
```

### 2. 添加 SuperCrawler MCP 配置

编辑 `~/.openclaw/mcp.json`，添加以下内容：

```json
{
  "$schema": "https://openclaw.dev/schema/mcp.json",
  "mcpServers": {
    "supercrawler": {
      "command": "docker",
      "args": [
        "exec", "-i", "supercrawler",
        "node", "dist/mcp/mcp.stdio.js"
      ],
      "env": {
        "PROFILE_DIR": "/data/profiles",
        "OUTPUT_DIR": "/data/output"
      }
    }
  }
}
```

**说明：**
- `command: "docker"` — 使用 Docker 命令
- `args` — 执行容器内的 MCP stdio 服务
- `supercrawler` — 你的容器名（如果改了名，替换成实际的）
- `env` — 环境变量（profile 和 output 路径）

### 3. 重启 OpenClaw

配置完成后，重启 OpenClaw 让配置生效：

```bash
# 如果使用 OpenClaw CLI
openclaw restart

# 或者退出 OpenClaw 重新打开
```

### 4. 验证 MCP 连接

在 OpenClaw 中执行：

```
/mcp list
```

应该能看到 `supercrawler` 在列表中，显示已连接。

---

## 方式二：安装 Skills（功能更强大）

Skills 提供了：
- ✅ 自动服务拉起（onBeforeInvoke）
- ✅ 风控预警（onAfterInvoke）
- ✅ 工作流指导（SKILL.md）

### 1. 下载 Skill 文件

从 GitHub 仓库下载 skills 目录：

```bash
# 方式 A：Git clone（推荐）
cd /tmp
git clone https://github.com/shun83914/supercrawler.git
cp -r supercrawler/.openclaw/skills ~/.openclaw/

# 方式 B：直接下载 ZIP
curl -L https://github.com/shun83914/supercrawler/archive/refs/heads/main.zip -o supercrawler.zip
unzip supercrawler.zip
cp -r supercrawler-main/.openclaw/skills ~/.openclaw/
```

### 2. 验证 Skill 文件结构

```bash
ls -R ~/.openclaw/skills/
```

应该看到：

```
/Users/you/.openclaw/skills/
├── douyin-scraper/
│   ├── SKILL.md
│   ├── skill.json
│   └── index.mjs
├── xhs-multi-account/
│   ├── SKILL.md
│   ├── skill.json
│   └── index.mjs
└── xhs-scraper/
    ├── SKILL.md
    ├── skill.json
    └── index.mjs
```

### 3. 配置环境变量（可选）

如果你的服务设置了 `API_TOKEN`，需要配置到环境变量：

```bash
# 编辑 .zshrc 或 .bashrc
echo 'export SUPERCRAWLER_TOKEN="你的token"' >> ~/.zshrc
source ~/.zshrc
```

### 4. 重启 OpenClaw

```bash
openclaw restart
```

### 5. 验证 Skills

在 OpenClaw 中执行：

```
/skills list
```

应该能看到：
- `xhs-scraper` — 小红书单账号抓取
- `xhs-multi-account` — 小红书多账号轮询
- `douyin-scraper` — 抖音单账号抓取

---

## 方式三：手动配置（不依赖源码仓库）

如果你不想下载任何文件，可以手动创建最小配置。

### 1. 创建 MCP 配置

编辑 `~/.openclaw/mcp.json`：

```json
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
```

### 2. 创建最小 Skill（可选）

如果你想让 OpenClaw agent 知道有哪些工具可用，创建 `~/.openclaw/skills/supercrawler/SKILL.md`：

```bash
mkdir -p ~/.openclaw/skills/supercrawler
cat > ~/.openclaw/skills/supercrawler/SKILL.md << 'EOF'
# SuperCrawler Skill

## 可用工具

- `xhs_scrape_search` — 小红书关键词搜索
- `xhs_scrape_notes` — 小红书笔记详情
- `xhs_scrape_user` — 小红书用户主页
- `xhs_scrape_comments` — 小红书评论
- `douyin_scrape_search` — 抖音关键词搜索
- `douyin_scrape_awemes` — 抖音作品详情
- `douyin_scrape_user` — 抖音用户主页
- `douyin_scrape_comments` — 抖音评论
- `auth_login` — 扫码登录（platform: xhs|douyin）
- `auth_status` — 查询登录态

## 工作流

1. 先调用 `health` 检查服务状态
2. 如果未登录，调用 `auth_login` 扫码
3. 执行抓取任务
4. 失败时根据错误码决策：
   - `LOGIN_REQUIRED` → 重新登录
   - `RATE_LIMITED` → 退避 5 分钟
   - `TARGET_NOT_FOUND` → 放弃该目标
EOF
```

### 3. 重启 OpenClaw

```bash
openclaw restart
```

---

## 常见问题

### Q1: OpenClaw 提示 "MCP server not found"

**解决：**
1. 检查容器是否在运行：`docker ps | grep supercrawler`
2. 检查 `~/.openclaw/mcp.json` 语法是否正确：`cat ~/.openclaw/mcp.json | jq .`
3. 重启 OpenClaw

### Q2: Skill 没有显示在列表中

**解决：**
1. 确认文件结构正确：`ls -R ~/.openclaw/skills/`
2. 每个 skill 目录下必须有 `skill.json` 和 `SKILL.md`
3. 重启 OpenClaw

### Q3: 调用工具时提示 "permission denied"

**解决：**
1. 如果服务设置了 `API_TOKEN`，需要配置环境变量：
   ```bash
   export SUPERCRAWLER_TOKEN="你的token"
   ```
2. 或者在 `~/.openclaw/mcp.json` 的 `env` 中添加：
   ```json
   "env": {
     "SUPERCRAWLER_TOKEN": "你的token"
   }
   ```

### Q4: 容器名不是 supercrawler 怎么办

**解决：**
修改 `~/.openclaw/mcp.json` 中的容器名：

```json
"args": ["exec", "-i", "你的容器名", "node", "dist/mcp/mcp.stdio.js"]
```

查看你的容器名：
```bash
docker ps --format "{{.Names}}" | grep supercrawler
```

---

## 验证配置是否成功

### 测试 1：健康检查

在 OpenClaw 中调用 MCP 工具 `health`，应该返回：

```json
{
  "success": true,
  "data": {
    "status": "ok",
    "accounts": {
      "profilesOnDisk": ["default"]
    }
  }
}
```

### 测试 2：查询登录态

调用 `auth_status` (accountId: "default")，应该返回：

```json
{
  "success": true,
  "data": {
    "accountId": "default",
    "loggedIn": true
  }
}
```

### 测试 3：执行一次搜索

调用 `xhs_scrape_search`：

```json
{
  "keywords": ["穿搭"],
  "sort": "hot",
  "limit": 3
}
```

应该返回抓取结果。

---

## 后续步骤

配置完成后，你就可以在 OpenClaw 中直接使用 SuperCrawler 的所有功能：

1. **小红书抓取**：使用 `xhs-scraper` skill
2. **抖音抓取**：使用 `douyin-scraper` skill
3. **多账号轮询**：使用 `xhs-multi-account` skill

详细使用指南请查看各 skill 的 `SKILL.md` 文件。
