# 🤖 OpenClaw Agent 指令 — SuperCrawler 部署与使用

> **复制以下内容给 OpenClaw Agent，它会自动执行所有步骤！**

---

```
你好！请帮我部署 SuperCrawler 数据抓取服务。

这是一个全新环境，请按以下 5 个阶段执行：

阶段 1: Docker 部署容器
阶段 2: 配置 MCP 通信（跨容器调用）
阶段 3: 安装 Skills
阶段 4: 扫码登录（小红书 + 抖音）
阶段 5: 使用 MCP Tools 抓取数据

---

# ⚠️ 前置要求：OpenClaw 容器配置

**OpenClaw 容器启动时必须挂载 Docker Socket，否则无法跨容器调用 MCP！**

```bash
# OpenClaw 容器启动示例（以 macOS 为例）
docker run -d --name openclaw \
  -v ~/.openclaw:/root/.openclaw \
  -v ~/.docker/run/docker.sock:/var/run/docker.sock \  # ← 必须挂载！
  ghcr.io/openclaw/openclaw:latest
```

**不同操作系统的 Docker Socket 挂载方式：**

**macOS (Docker Desktop):**
```bash
-v ~/.docker/run/docker.sock:/var/run/docker.sock
```

**Linux:**
```bash
-v /var/run/docker.sock:/var/run/docker.sock
```

**Windows (Docker Desktop):**
```bash
# Windows 使用命名管道（Named Pipe）
-v //var/run/docker.sock:/var/run/docker.sock
# 或者
-v /var/run/docker.sock:/var/run/docker.sock
```
```

**为什么需要 Docker Socket？**
- MCP 工具运行在 SuperCrawler 容器内
- OpenClaw 需要通过 `docker exec` 跨容器调用
- 挂载 Docker Socket 后，OpenClaw 可以控制其他容器

**Docker Socket 路径说明：**
- **macOS (Docker Desktop)**: `~/.docker/run/docker.sock`
- **Linux**: `/var/run/docker.sock`
- **Windows (Docker Desktop)**: `//var/run/docker.sock` (命名管道)
- **容器内统一使用**: `/var/run/docker.sock`

---

# 阶段 1：Docker 部署

## Step 1: 检查环境并启动

```bash
# 检查架构
ARCH=$(uname -m)

# 选择镜像
if [ "$ARCH" = "arm64" ]; then
  IMAGE="ghcr.io/shun83914/supercrawler:latest-debian-arm64"
else
  IMAGE="ghcr.io/shun83914/supercrawler:latest-debian-amd64"
fi

# 生成 Token
API_TOKEN=$(openssl rand -hex 32)
echo "API Token: $API_TOKEN"

# 创建数据目录
mkdir -p ~/supercrawler/data

# 清理旧容器
docker rm -f supercrawler 2>/dev/null || true

# 启动容器（Headed 模式，登录和抓取都用这个）
docker run -d --name supercrawler \
  -p 5510:5510 \
  -v ~/supercrawler/data:/data \
  -e API_TOKEN=$API_TOKEN \
  -e CLOAK_HEADLESS=false \
  $IMAGE

# 等待启动
sleep 10

# 验证服务
curl http://localhost:5510/api/health | jq .
curl http://localhost:5510/api/browser/status | jq .
```

**保存 Token 到文件：**
```bash
echo "$API_TOKEN" > ~/supercrawler/api-token.txt
echo "✅ Token 已保存到 ~/supercrawler/api-token.txt"
```

---

# 阶段 2：配置 MCP

## ⚠️ 重要说明：跨容器调用

**MCP 工具运行在 SuperCrawler 容器内，OpenClaw 需要通过 Docker 跨容器调用！**

**工作原理：**
```
OpenClaw 容器
    ↓ (通过 Docker Socket)
Docker Daemon
    ↓ (docker exec)
SuperCrawler 容器 (运行 MCP stdio server)
```

**关键配置：**
- OpenClaw 容器必须挂载 Docker Socket：
  - **macOS**: `-v ~/.docker/run/docker.sock:/var/run/docker.sock`
  - **Linux**: `-v /var/run/docker.sock:/var/run/docker.sock`
  - **Windows**: `-v //var/run/docker.sock:/var/run/docker.sock`
- MCP 配置使用 `docker exec` 命令跨容器调用
- 无需网络直连，通过 Docker Daemon 中转

---

## Step 2: 创建 MCP 配置

创建文件 `~/.openclaw/mcp.json`：

```bash
# 检查 OpenClaw 配置目录是否存在，不存在再创建
if [ ! -d ~/.openclaw ]; then
  mkdir -p ~/.openclaw
  echo "✅ 已创建 ~/.openclaw 目录"
else
  echo "✅ ~/.openclaw 目录已存在"
fi

# 检查 Docker Socket 是否可用（跨容器调用必须）
# macOS、Linux 和 Windows 路径不同，需要检查多个位置
DOCKER_SOCKET=""
if [ -S /var/run/docker.sock ]; then
  DOCKER_SOCKET="/var/run/docker.sock"
elif [ -S ~/.docker/run/docker.sock ]; then
  DOCKER_SOCKET="$HOME/.docker/run/docker.sock"
elif [ -S /run/docker.sock ]; then
  DOCKER_SOCKET="/run/docker.sock"
fi

if [ -n "$DOCKER_SOCKET" ]; then
  echo "✅ Docker Socket 可用: $DOCKER_SOCKET"
  echo "✅ 支持跨容器调用"
else
  echo "⚠️  Docker Socket 未检测到，但可能在 Windows 上正常运行"
  echo "请确保 OpenClaw 容器启动时挂载了 Docker Socket："
  echo "  macOS:   docker run -v ~/.docker/run/docker.sock:/var/run/docker.sock ..."
  echo "  Linux:   docker run -v /var/run/docker.sock:/var/run/docker.sock ..."
  echo "  Windows: docker run -v //var/run/docker.sock:/var/run/docker.sock ..."
fi

cat > ~/.openclaw/mcp.json << 'EOF'
{
  "mcpServers": {
    "supercrawler": {
      "command": "docker",
      "args": [
        "exec",
        "-i",
        "supercrawler",
        "node",
        "dist/mcp/mcp.stdio.js"
      ],
      "env": {}
    }
  }
}
EOF

echo "✅ MCP 配置已创建"
```

**重启 OpenClaw 让配置生效。**

---

# 阶段 3：安装 Skills

## Step 3: 下载 Skills

```bash
# 创建 Skills 目录
mkdir -p ~/.openclaw/skills

# 下载 Skills 配置
cat > ~/.openclaw/skills/supercrawler.md << 'EOF'
# SuperCrawler Skills

## 能力
- 小红书笔记抓取
- 小红书用户主页
- 小红书搜索
- 小红书评论
- 抖音视频抓取
- 抖音用户主页
- 抖音搜索
- 抖音评论

## 使用方法
直接告诉我你想抓取什么，例如：
- "帮我搜索小红书上关于 AI 的笔记"
- "抓取这个抖音用户的主页"
- "下载这个小红书笔记的评论"

## 注意事项
- 首次使用需要先扫码登录
- 登录态会持久化，不需要每次登录
EOF

echo "✅ Skills 已安装"
```

---

# 阶段 4：扫码登录

## Step 4.1: 登录小红书

```bash
# 读取 Token
API_TOKEN=$(cat ~/supercrawler/api-token.txt)

# 触发登录
curl -X POST http://localhost:5510/api/auth/login \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_TOKEN" \
  -d '{"accountId":"default","platform":"xhs"}'

# 等待浏览器打开
sleep 10

# 获取二维码
curl -s "http://localhost:5510/api/auth/qr-screenshot?platform=xhs" \
  -H "X-API-Key: $API_TOKEN" | jq -r '.qrCode' | base64 -d > /tmp/qr-xhs.png

echo "📱 小红书二维码已保存到 /tmp/qr-xhs.png"
echo "请打开图片并扫码！"
```

**等待用户扫码后，验证登录：**
```bash
curl http://localhost:5510/api/auth/status?platform=xhs \
  -H "X-API-Key: $API_TOKEN" | jq .
```

## Step 4.2: 登录抖音

```bash
# 触发登录
curl -X POST http://localhost:5510/api/auth/login \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_TOKEN" \
  -d '{"accountId":"default","platform":"douyin"}'

sleep 10

# 获取二维码
curl -s "http://localhost:5510/api/auth/qr-screenshot?platform=douyin" \
  -H "X-API-Key: $API_TOKEN" | jq -r '.qrCode' | base64 -d > /tmp/qr-douyin.png

echo "📱 抖音二维码已保存到 /tmp/qr-douyin.png"
echo "请打开图片并扫码！"
```

**验证登录：**
```bash
curl http://localhost:5510/api/auth/status?platform=douyin \
  -H "X-API-Key: $API_TOKEN" | jq .
```

**✅ 登录完成！容器无需切换，直接开始抓取！**

---

# 阶段 5：使用 MCP Tools

## Step 5: 测试抓取

登录完成后，用户可以直接告诉你想抓取什么。

**示例请求：**
- "搜索小红书上关于 AI 的笔记"
- "抓取小红书笔记 65a1b2c3d4e5f60001234567"
- "搜索抖音上关于编程的视频"
- "抓取抖音用户 MS4wLjABAAAA123 的主页"

**你会自动调用 MCP Tools 完成抓取。**

---

# 常用命令

## 查看容器状态
```bash
docker ps | grep supercrawler
```

## 查看日志
```bash
docker logs -f supercrawler
```

## 重启容器
```bash
docker restart supercrawler
```

## 更新镜像
```bash
# 根据当前架构选择对应镜像
ARCH=$(uname -m)
if [ "$ARCH" = "arm64" ]; then
  IMAGE="ghcr.io/shun83914/supercrawler:latest-debian-arm64"
else
  IMAGE="ghcr.io/shun83914/supercrawler:latest-debian-amd64"
fi

docker pull $IMAGE
docker stop supercrawler && docker rm supercrawler
# 然后重新执行 Step 1 的 docker run 命令
```

---

# 故障排查

## 容器启动失败
```bash
docker logs supercrawler --tail 50
```

## 登录态丢失
重新执行阶段 4 的扫码登录即可（Token 不变）

## API 调用返回 401
检查 Token 是否正确：
```bash
cat ~/supercrawler/api-token.txt
```

---

**现在开始执行阶段 1！**
```
