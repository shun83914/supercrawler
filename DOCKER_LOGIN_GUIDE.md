# 📱 Docker 扫码登录完整指南

## 🎯 问题说明

在 Docker 中使用 Headed + Xvfb 模式时：
- ✅ 浏览器在虚拟显示器中打开了二维码页面
- ❌ **但你看不到二维码**（在内存中）
- ❌ 无法扫码登录

## ✅ 解决方案：截图获取二维码

### 方案对比

| 方案 | 优点 | 缺点 | 推荐度 |
|------|------|------|--------|
| **截图（推荐）** | 简单、快速 | 需要手动获取截图 | ⭐⭐⭐⭐⭐ |
| VNC 远程桌面 | 实时查看 | 配置复杂 | ⭐⭐⭐ |
| 端口映射 + noVNC | 浏览器查看 | 最复杂 | ⭐⭐ |

---

## 📸 方案 1：截图（推荐）

### 步骤 1：触发登录

```bash
# 启动 Headed 模式容器
docker run -d --name supercrawler -p 5510:5510 \
  -v ~/supercrawler/data:/data \
  -e CLOAK_HEADLESS=false \
  ghcr.io/shun83914/supercrawler:v1.0.4-debian-amd64

# 触发登录
curl -X POST http://localhost:5510/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"accountId":"default","platform":"xhs"}'

# 后台会弹出浏览器（在虚拟显示器中）
```

### 步骤 2：获取二维码截图

#### 方法 A：使用脚本（最简单）

```bash
# 进入容器执行截图
docker exec supercrawler scrot -d :99 /tmp/qr-code.png -q 90

# 复制到宿主机
docker cp supercrawler:/tmp/qr-code.png ./qr-code.png

# 查看截图
open ./qr-code.png  # macOS
xdg-open ./qr-code.png  # Linux
```

#### 方法 B：一条命令

```bash
docker exec supercrawler scrot -d :99 /tmp/qr-code.png -q 90 && \
docker cp supercrawler:/tmp/qr-code.png ./qr-code.png && \
open ./qr-code.png
```

### 步骤 3：扫码登录

1. 打开截图 `qr-code.png`
2. 使用小红书 App 扫描二维码
3. 等待登录完成（API 会自动返回结果）

### 自动化脚本

创建 `get-qr.sh`：

```bash
#!/bin/bash
# get-qr.sh - 自动获取二维码截图

CONTAINER_NAME="${1:-supercrawler}"
OUTPUT_FILE="./qr-code-$(date +%s).png"

echo "📸 正在获取二维码截图..."

# 截图
docker exec "$CONTAINER_NAME" scrot -d :99 /tmp/qr-code.png -q 90

# 复制
docker cp "$CONTAINER_NAME":/tmp/qr-code.png "$OUTPUT_FILE"

# 打开
if [[ "$(uname)" == "Darwin" ]]; then
  open "$OUTPUT_FILE"
else
  xdg-open "$OUTPUT_FILE" 2>/dev/null || echo "截图已保存: $OUTPUT_FILE"
fi

echo "✅ 二维码截图: $OUTPUT_FILE"
echo "💡 请使用小红书 App 扫码"
```

使用：

```bash
chmod +x get-qr.sh
./get-qr.sh supercrawler
```

---

## 🖥️ 方案 2：VNC 实时查看

### 步骤 1：安装 VNC 服务器

```bash
# 进入容器
docker exec -it supercrawler bash

# 安装 x11vnc
apt-get update && apt-get install -y x11vnc

# 启动 VNC 服务器
x11vnc -display :99 -forever -nopw -listen 0.0.0.0 -rfbport 5900 &
```

### 步骤 2：映射 VNC 端口

```bash
# 停止并删除旧容器
docker stop supercrawler && docker rm supercrawler

# 重新启动，添加 VNC 端口映射
docker run -d --name supercrawler \
  -p 5510:5510 \
  -p 5900:5900 \  # VNC 端口
  -v ~/supercrawler/data:/data \
  -e CLOAK_HEADLESS=false \
  ghcr.io/shun83914/supercrawler:v1.0.4-debian-amd64

# 安装并启动 x11vnc
docker exec supercrawler bash -c "apt-get update && apt-get install -y x11vnc"
docker exec supercrawler x11vnc -display :99 -forever -nopw -listen 0.0.0.0 -rfbport 5900 &
```

### 步骤 3：连接 VNC

**macOS:**
1. 打开 Finder
2. 菜单：前往 → 连接服务器
3. 输入：`vnc://localhost:5900`
4. 连接

**Linux:**
```bash
xtightvncviewer localhost:5900
# 或使用 remmina、vinagre 等
```

**Windows:**
使用 VNC Viewer（RealVNC、TightVNC 等）连接 `localhost:5900`

---

## 🌐 方案 3：noVNC（浏览器查看）

### 步骤 1：安装 noVNC

```bash
docker exec -it supercrawler bash

# 安装 noVNC
apt-get update && apt-get install -y novnc websockify

# 启动 noVNC
noVNC --vnc localhost:5900 --listen 6080 &
```

### 步骤 2：映射端口并访问

```bash
# 启动容器时添加端口
docker run -d --name supercrawler \
  -p 5510:5510 \
  -p 6080:6080 \  # noVNC Web 界面
  -v ~/supercrawler/data:/data \
  -e CLOAK_HEADLESS=false \
  ghcr.io/shun83914/supercrawler:v1.0.4-debian-amd64
```

访问：`http://localhost:6080/vnc.html`

---

## 🤖 自动化扫码流程（推荐）

### 完整自动化脚本

创建 `docker-login.sh`：

```bash
#!/bin/bash
# docker-login.sh - Docker 扫码登录完整流程

set -e

CONTAINER_NAME="${1:-supercrawler}"
PLATFORM="${2:-xhs}"
ACCOUNT="${3:-default}"
IMAGE="ghcr.io/shun83914/supercrawler:v1.0.4-debian-amd64"

echo "=========================================="
echo "🚀 SuperCrawler Docker 扫码登录"
echo "=========================================="
echo ""

# 步骤 1：检查容器
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo "📦 启动容器..."
  docker run -d --name "$CONTAINER_NAME" \
    -p 5510:5510 \
    -v ~/supercrawler/data:/data \
    -e CLOAK_HEADLESS=false \
    "$IMAGE"
  
  # 等待启动
  echo "⏳ 等待服务启动..."
  sleep 3
fi

# 步骤 2：触发登录
echo ""
echo "🔐 触发登录请求..."
RESP=$(curl -sS -w '\n%{http_code}' \
  -X POST "http://localhost:5510/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"accountId\":\"${ACCOUNT}\",\"platform\":\"${PLATFORM}\"}")

HTTP_CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')

if [ "$HTTP_CODE" != "200" ] && [ "$HTTP_CODE" != "201" ]; then
  echo "❌ 登录请求失败: HTTP $HTTP_CODE"
  echo "$BODY"
  exit 1
fi

echo "✅ 登录请求已发送"
echo "📱 浏览器已在虚拟显示器中打开"
echo ""

# 步骤 3：获取二维码
echo "📸 获取二维码截图..."
sleep 3  # 等待页面加载

QR_FILE="./qr-${ACCOUNT}-$(date +%s).png"
docker exec "$CONTAINER_NAME" scrot -d :99 /tmp/qr-code.png -q 90
docker cp "$CONTAINER_NAME":/tmp/qr-code.png "$QR_FILE"

echo "✅ 二维码截图: $QR_FILE"
echo ""

# 步骤 4：打开截图
if [[ "$(uname)" == "Darwin" ]]; then
  open "$QR_FILE"
  echo "📱 请使用小红书 App 扫码"
elif command -v xdg-open &> /dev/null; then
  xdg-open "$QR_FILE"
  echo "📱 请使用小红书 App 扫码"
else
  echo "📱 请手动打开截图并使用小红书 App 扫码: $QR_FILE"
fi

echo ""
echo "⏳ 等待扫码登录完成..."
echo "   （最长等待 5 分钟）"

# 步骤 5：等待登录完成
TIMEOUT=300  # 5 分钟
INTERVAL=5
ELAPSED=0

while [ $ELAPSED -lt $TIMEOUT ]; do
  sleep $INTERVAL
  ELAPSED=$((ELAPSED + INTERVAL))
  
  # 检查登录状态
  STATUS=$(curl -sS "http://localhost:5510/api/auth/status?accountId=${ACCOUNT}&platform=${PLATFORM}")
  LOGGED=$(echo "$STATUS" | grep -o '"loggedIn":[^,}]*' | cut -d: -f2)
  
  if [ "$LOGGED" = "true" ]; then
    echo ""
    echo "=========================================="
    echo "✅ 登录成功！"
    echo "=========================================="
    echo "账号: $ACCOUNT"
    echo "平台: $PLATFORM"
    echo "$STATUS" | python3 -m json.tool 2>/dev/null || echo "$STATUS"
    exit 0
  fi
  
  # 每 30 秒提示一次
  if [ $((ELAPSED % 30)) -eq 0 ]; then
    echo "   ⏳ 已等待 ${ELAPSED}s，请扫码..."
  fi
done

echo ""
echo "❌ 登录超时（${TIMEOUT}s）"
echo "💡 请检查："
echo "   1. 二维码是否过期（截图后尽快扫码）"
echo "   2. 网络连接是否正常"
echo "   3. 小红书 App 是否正常"

exit 1
```

使用：

```bash
chmod +x docker-login.sh

# 登录小红书（默认账号）
./docker-login.sh

# 登录抖音
./docker-login.sh supercrawler douyin

# 指定账号
./docker-login.sh supercrawler xhs work01
```

---

## 📋 快速命令参考

### 截图获取二维码

```bash
# 基本截图
docker exec supercrawler scrot -d :99 /tmp/qr.png -q 90
docker cp supercrawler:/tmp/qr.png ./qr.png
open ./qr.png

# 一条命令
docker exec supercrawler scrot -d :99 /tmp/qr.png -q 90 && \
  docker cp supercrawler:/tmp/qr.png ./qr.png && open ./qr.png
```

### 检查登录状态

```bash
curl http://localhost:5510/api/auth/status?accountId=default | python3 -m json.tool
```

### 查看容器日志

```bash
docker logs -f supercrawler
```

---

## ❓ 常见问题

### Q1: 截图是空白的？

**A:** 页面可能还没加载完成，等待几秒后再截图：

```bash
sleep 5
docker exec supercrawler scrot -d :99 /tmp/qr.png -q 90
docker cp supercrawler:/tmp/qr.png ./qr.png
```

### Q2: 二维码过期了怎么办？

**A:** 重新触发登录，再次截图：

```bash
# 重新登录
curl -X POST http://localhost:5510/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"accountId":"default"}'

# 等待 3 秒后截图
sleep 3
docker exec supercrawler scrot -d :99 /tmp/qr.png -q 90
docker cp supercrawler:/tmp/qr.png ./qr.png
open ./qr.png
```

### Q3: 截图太大/太小？

**A:** 可以调整 Xvfb 分辨率（在 entrypoint.sh 中）：

```bash
# 修改 entrypoint.sh 中的分辨率
Xvfb :99 -screen 0 1280x720x24 -ac &  # 改为 1280x720
```

### Q4: 能自动检测扫码完成吗？

**A:** 可以！使用自动化脚本 `docker-login.sh`，会自动轮询登录状态。

---

## 💡 最佳实践

### 推荐工作流程

```bash
# 1. 首次登录（使用自动化脚本）
./docker-login.sh

# 2. 登录成功后，切换到 Headless 模式（高效抓取）
docker stop supercrawler
docker rm supercrawler

docker run -d --name supercrawler -p 5510:5510 \
  -v ~/supercrawler/data:/data \
  -e CLOAK_HEADLESS=true \  # 切换到 headless
  ghcr.io/shun83914/supercrawler:v1.0.4-debian-amd64

# 3. 开始抓取
curl -X POST http://localhost:5510/api/xhs/search \
  -H "Content-Type: application/json" \
  -d '{"keywords":["穿搭"],"sort":"hot","limit":10}'
```

---

**现在你可以在 Docker 中完美扫码登录了！** 🎉
