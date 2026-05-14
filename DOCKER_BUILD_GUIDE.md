# 📚 Docker 构建与工具使用详解

## 1️⃣ Chromium 下载与存储机制

### ❓ 每次构建都要下载 Chromium 吗？

**是的，每次 `docker build` 都会下载！**

### 🔍 原因分析

#### Docker 构建流程

```
┌─────────────────────────────────────────────────┐
│ 每次 docker build 的执行过程：                    │
│                                                 │
│ 1. 创建新的临时构建容器                           │
│    ↓                                            │
│ 2. 执行 RUN apt-get install chromium            │
│    ↓                                            │
│ 3. 从 Debian 镜像源下载 (75MB+)                  │
│    ↓                                            │
│ 4. 安装到 /usr/lib/chromium/ (324MB)             │
│    ↓                                            │
│ 5. 打包成 Docker 镜像层                           │
│    ↓                                            │
│ 6. 销毁临时构建容器                               │
│    ↓                                            │
│ 7. Chromium 永久保存在镜像中                      │
└─────────────────────────────────────────────────┘
```

#### 为什么不能复用？

| 机制 | 说明 |
|------|------|
| **隔离性** | 每次构建都是全新的干净环境 |
| **临时容器** | `RUN` 指令在临时容器中执行 |
| **无持久化** | 构建完成后容器被销毁 |
| **镜像层** | 只有最终产物（镜像层）被保留 |

### 📍 Chromium 保存在哪里？

**打包到 Docker 镜像中了！**

```bash
# 查看 Chromium 在镜像中的位置
$ docker run --rm ghcr.io/shun83914/supercrawler:v1.0.5-debian-amd64 \
  bash -c "which chromium && du -sh /usr/lib/chromium/"

/usr/bin/chromium           # 可执行文件
324M    /usr/lib/chromium/  # 实际安装目录（324MB）
```

#### 镜像大小分析

```
v1.0.5 镜像组成：
┌────────────────────────────────┐
│ node:22-bookworm-slim  (165MB) │ ← 基础镜像
│ + Node.js 运行时               │
│                                │
│ + Chromium 浏览器 (324MB)      │ ← 打包在镜像中
│ + Xvfb 虚拟显示器              │
│ + scrot 截图工具               │
│ + 字体文件                     │
│                                │
│ + 应用代码 (10MB)              │ ← 你的代码
│ + node_modules (78MB)          │ ← 依赖包
│                                │
│ = 总计 477MB                   │
└────────────────────────────────┘
```

### 💡 Docker Layer Cache 机制

虽然每次都下载，但 Docker 有缓存优化：

```dockerfile
# 第 1 次构建
RUN apt-get update && apt-get install -y chromium
# ↓ 下载 75MB，耗时 5 分钟
# ↓ 创建镜像层 sha256:abc123

# 第 2 次构建（Dockerfile 未修改这行）
RUN apt-get update && apt-get install -y chromium
# ↓ 使用缓存层 sha256:abc123 ✅
# ↓ 跳过下载，耗时 0 秒
```

**缓存失效条件：**
- Dockerfile 中这行之前的任何指令发生变化
- 手动使用 `--no-cache` 参数
- 清理了 Docker 缓存 (`docker system prune`)

### 🚀 优化建议

如果想避免重复下载，可以：

#### 方案 1：使用自定义基础镜像

```dockerfile
# 创建包含 Chromium 的基础镜像（只做一次）
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y chromium xvfb scrot
# 推送为 ghcr.io/xxx/supercrawler-base:latest

# 实际项目使用
FROM ghcr.io/xxx/supercrawler-base:latest
# 后续构建不再下载 Chromium
```

#### 方案 2：使用 BuildKit 缓存

```bash
# 启用 BuildKit
export DOCKER_BUILDKIT=1

# 使用远程缓存
docker build --cache-to type=gha --cache-from type=gha .
```

---

## 2️⃣ scrot 截图工具使用详解

### 📸 scrot 是什么？

**scrot (SCReenshOT)** = Linux 命令行截图工具

```
位置: /usr/bin/scrot
大小: ~50KB
功能: 截取 X11 显示器屏幕
```

### 🔧 当前使用方式

#### 在 Docker 中的工作流程

```
┌──────────────────────────────────────────┐
│ 1. 用户触发登录 API                       │
│    POST /api/auth/login                  │
│    ↓                                    │
│ 2. 服务端在 Xvfb 虚拟显示器打开浏览器     │
│    DISPLAY=:99                           │
│    ↓                                    │
│ 3. 浏览器显示二维码（在虚拟显示器中）      │
│    ↓                                    │
│ 4. 用户执行截图命令                      │
│    docker exec supercrawler scrot ...    │
│    ↓                                    │
│ 5. 截图保存到容器内 /tmp/qr.png          │
│    ↓                                    │
│ 6. 用户复制到宿主机                       │
│    docker cp supercrawler:/tmp/qr.png .  │
│    ↓                                    │
│ 7. 用户打开手机扫码                       │
└──────────────────────────────────────────┘
```

#### 实际使用命令

```bash
# 步骤 1：触发登录
curl -X POST http://localhost:5510/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"accountId":"default"}'

# 等待 3 秒让页面加载
sleep 3

# 步骤 2：截图（在容器内执行）
docker exec supercrawler sh -c 'DISPLAY=:99 scrot /tmp/qr.png -q 90'
#   ↑              ↑     ↑      ↑          ↑
#   在容器执行      工具  显示器  输出路径    质量(90%)

# 步骤 3：复制到宿主机
docker cp supercrawler:/tmp/qr.png ./qr-code.png

# 步骤 4：查看截图
open ./qr-code.png  # macOS
```

### 🤖 OpenClaw 能使用 scrot 吗？

**目前不能直接使用，但可以集成！**

#### 当前限制

```
OpenClaw MCP 协议：
├── 通过 stdio 通信
├── 只能调用预定义的 MCP 工具
└── 无法执行任意 shell 命令

scrot 截图：
├── 需要在容器内执行 shell 命令
├── 需要访问宿主机的文件系统
└── 不在 MCP 工具列表中
```

#### 集成方案（需要开发）

**方案 1：添加 MCP 截图工具**

```typescript
// 在 auth.controller.ts 中添加
@Get('qr-screenshot')
@ApiOperation({ summary: '获取登录二维码截图' })
async getQrScreenshot(): Promise<{ qrCode: string }> {
  // 1. 在容器内执行 scrot
  const { exec } = require('child_process');
  exec('DISPLAY=:99 scrot /tmp/qr.png -q 90');
  
  // 2. 读取图片并转 base64
  const imageBuffer = await fs.readFile('/tmp/qr.png');
  const base64 = imageBuffer.toString('base64');
  
  return { qrCode: `data:image/png;base64,${base64}` };
}
```

**使用方式：**
```bash
# OpenClaw 调用
curl http://localhost:5510/api/auth/qr-screenshot
# 返回 base64 编码的图片
```

**方案 2：添加 Skill**

创建 `.openclaw/skills/capture-qr.sh`：

```bash
#!/bin/bash
# skill: 获取登录二维码截图

docker exec supercrawler sh -c 'DISPLAY=:99 scrot /tmp/qr.png -q 90'
docker cp supercrawler:/tmp/qr.png /tmp/qr-latest.png
echo "✅ 二维码截图已保存到 /tmp/qr-latest.png"
```

**方案 3：VNC 实时查看**

```bash
# 安装 x11vnc
docker exec supercrawler apt-get install -y x11vnc
docker exec supercrawler x11vnc -display :99 -forever -nopw -listen 0.0.0.0 -rfbport 5900

# OpenClaw 可以通过 VNC 协议查看
# 但这需要 OpenClaw 支持 VNC 客户端
```

### 📊 截图工具使用流程图

```
当前流程（手动）：
┌─────────────┐
│ 用户触发登录 │
└──────┬──────┘
       ↓
┌─────────────┐
│ 浏览器打开   │ (在 Xvfb 虚拟显示器)
│ 显示二维码   │
└──────┬──────┘
       ↓
┌─────────────────────┐
│ 用户执行截图命令     │ ← 需要手动操作
│ docker exec scrot   │
└──────┬──────────────┘
       ↓
┌─────────────────────┐
│ 用户复制截图到宿主机 │ ← 需要手动操作
│ docker cp           │
└──────┬──────────────┘
       ↓
┌─────────────┐
│ 用户扫码     │
└─────────────┘

理想流程（自动化）：
┌─────────────┐
│ 用户触发登录 │
└──────┬──────┘
       ↓
┌──────────────────┐
│ 自动截图         │ ← 服务端自动完成
│ 返回 base64 图片 │
└──────┬───────────┘
       ↓
┌─────────────┐
│ 用户扫码     │
└─────────────┘
```

---

## 3️⃣ scrot 在哪个阶段使用？

### 📍 使用阶段

```
Docker 容器生命周期：
┌────────────────────────────────────┐
│ 1. 构建阶段 (docker build)         │
│    ├─ 安装 scrot 包                │
│    └─ 打包到镜像                   │
└────────────────────────────────────┘
           ↓
┌────────────────────────────────────┐
│ 2. 启动阶段 (docker run)           │
│    ├─ entrypoint.sh 启动 Xvfb      │
│    └─ 设置 DISPLAY=:99             │
└────────────────────────────────────┘
           ↓
┌────────────────────────────────────┐
│ 3. 运行阶段 (服务运行中)            │
│    ├─ 用户触发登录 API             │
│    ├─ 浏览器打开二维码             │
│    └─ 用户执行 scrot 截图 ← 这里！ │
└────────────────────────────────────┘
```

### ⏰ 使用时机

**scrot 只在需要截图时才执行：**

```bash
# 不是自动的！需要用户手动触发
docker exec supercrawler sh -c 'DISPLAY=:99 scrot /tmp/qr.png -q 90'
```

**触发时机：**
1. 调用 `/api/auth/login` 后
2. 浏览器显示二维码时
3. 用户需要查看二维码时

**使用频率：**
- 首次登录：1-2 次
- 二维码过期后：重新截图
- 后续抓取：不需要截图（已登录）

---

## 4️⃣ 完整使用示例

### 🎯 标准扫码登录流程

```bash
#!/bin/bash
# login-with-screenshot.sh

echo "🔐 开始扫码登录流程..."

# 1. 触发登录
echo "1️⃣ 触发登录请求..."
curl -s -X POST http://localhost:5510/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"accountId":"default"}' > /dev/null

echo "✅ 登录请求已发送"

# 2. 等待页面加载
echo "⏳ 等待浏览器加载二维码..."
sleep 5

# 3. 截图
echo "📸 截取二维码..."
QR_FILE="./qr-$(date +%s).png"

docker exec supercrawler sh -c 'DISPLAY=:99 scrot /tmp/qr.png -q 90'
docker cp supercrawler:/tmp/qr.png "$QR_FILE"

echo "✅ 截图已保存: $QR_FILE"

# 4. 打开截图
if [[ "$(uname)" == "Darwin" ]]; then
  open "$QR_FILE"
  echo "📱 请使用小红书 App 扫码"
else
  xdg-open "$QR_FILE" 2>/dev/null || echo "请打开截图: $QR_FILE"
fi

# 5. 等待登录完成
echo "⏳ 等待扫码..."
for i in $(seq 1 60); do
  sleep 5
  STATUS=$(curl -s http://localhost:5510/api/auth/status?accountId=default)
  LOGGED=$(echo "$STATUS" | grep -o '"loggedIn":[^,}]*' | cut -d: -f2)
  
  if [ "$LOGGED" = "true" ]; then
    echo "✅ 登录成功！"
    exit 0
  fi
  
  if [ $((i % 6)) -eq 0 ]; then
    echo "   已等待 $((i * 5))s..."
  fi
done

echo "❌ 登录超时"
exit 1
```

---

## 5️⃣ 总结对比

| 项目 | Chromium | scrot |
|------|----------|-------|
| **安装时机** | docker build 时 | docker build 时 |
| **存储位置** | 打包在镜像中 `/usr/lib/chromium/` | 打包在镜像中 `/usr/bin/scrot` |
| **大小** | 324MB | 50KB |
| **使用时机** | 服务启动后自动使用 | 用户手动执行截图时 |
| **使用频率** | 持续运行 | 偶尔使用（登录时） |
| **OpenClaw 集成** | 已通过 CloakBrowser 集成 | 未集成（需要开发） |
| **自动化程度** | 全自动 | 半自动（需手动截图） |

---

## 💡 最佳实践建议

### 当前（手动截图）
```bash
# 优点：简单、可靠
# 缺点：需要用户手动操作
docker exec supercrawler sh -c 'DISPLAY=:99 scrot /tmp/qr.png -q 90'
docker cp supercrawler:/tmp/qr.png ./qr.png
```

### 未来（API 自动截图）
```bash
# 优点：全自动、适合 OpenClaw
# 缺点：需要开发新功能
curl http://localhost:5510/api/auth/qr-code
# 返回: {"qrCode": "data:image/png;base64,..."}
```

---

**现在你完全理解了 Chromium 和 scrot 的工作机制！** 🎉
