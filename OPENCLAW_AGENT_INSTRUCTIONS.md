# 🤖 OpenClaw Agent 指令 — SuperCrawler 部署与使用

> **复制以下内容给 OpenClaw Agent，它会自动执行所有步骤！**

---

```
你好！请帮我部署 SuperCrawler 数据抓取服务。

这是一个全新环境，请按以下 5 个阶段执行：

阶段 1: Docker 部署容器
阶段 2: 配置 MCP 通信
阶段 3: 安装 Skills
阶段 4: 扫码登录（小红书 + 抖音）
阶段 5: 使用 MCP Tools 抓取数据

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

## Step 2: 创建 MCP 配置

创建文件 `~/.openclaw/mcp.json`：

```bash
mkdir -p ~/.openclaw

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
docker pull ghcr.io/shun83914/supercrawler:latest-debian-arm64
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
