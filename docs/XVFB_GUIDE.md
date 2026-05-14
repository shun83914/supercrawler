# 📚 SuperCrawler Docker 浏览器模式说明

## 🎯 核心概念

### 1. Headless 模式（无头模式）

**定义：** 浏览器在后台运行，**不显示图形界面**

```
┌─────────────────────────────┐
│  终端/命令行                  │
│  $ node dist/main.js        │
│                             │
│  [浏览器在后台运行]           │ ← 你看不到窗口
│  [但可以正常抓取数据]         │
└─────────────────────────────┘
```

**优点：**
- ✅ 启动速度快
- ✅ 资源占用少（CPU/内存）
- ✅ 适合服务器环境
- ✅ 适合批量抓取任务

**缺点：**
- ❌ 无法看到浏览器界面
- ❌ 无法扫码登录
- ❌ 某些网站会检测并阻止 headless 浏览器

**适用场景：**
- 已登录状态下的数据抓取
- 自动化测试
- 服务器部署

---

### 2. Headed 模式（有头模式）

**定义：** 浏览器正常显示图形界面

```
┌─────────────────────────────┐
│  显示器 (GUI)                │
│  ┌─────────────────────┐    │
│  │  Chrome 浏览器窗口   │    │ ← 你可以看到并操作
│  │  [显示二维码]        │    │ ← 可以扫码登录
│  └─────────────────────┘    │
└─────────────────────────────┘
```

**优点：**
- ✅ 可以看到浏览器界面
- ✅ 可以扫码登录
- ✅ 可以手动操作（点击、输入）
- ✅ 反检测能力更强

**缺点：**
- ❌ 需要显示器（GUI 环境）
- ❌ 资源占用较多
- ❌ 启动速度慢

**适用场景：**
- 首次登录（扫码）
- 需要人工干预的操作
- 本地开发调试

---

### 3. 为什么 Docker 中 Headed 模式有问题？

**问题：Docker 容器默认没有显示器！**

```
你的 Mac/Linux 电脑：
┌─────────────────────────────┐
│  操作系统 (macOS/Ubuntu)     │
│  ┌─────────────────────┐    │
│  │  图形界面 (GUI)      │    │
│  │  ┌───────────────┐  │    │
│  │  │ Chrome 窗口    │  │    │ ← Headed 可以工作
│  │  └───────────────┘  │    │
│  └─────────────────────┘    │
└─────────────────────────────┘

Docker 容器：
┌─────────────────────────────┐
│  容器 (Container)            │
│  ┌─────────────────────┐    │
│  │  纯命令行环境         │    │
│  │  $ _                │    │ ← 没有显示器！
│  │                     │    │ ← Headed 无法显示窗口
│  │  [ERROR: no display]│    │ ← 浏览器启动失败
│  └─────────────────────┘    │
└─────────────────────────────┘
```

**错误信息：**
```
ERROR: No display specified
Cannot open display: 
```

---

### 4. Xvfb - 虚拟显示器解决方案

**Xvfb (X Virtual Framebuffer)** = 在内存中创建虚拟显示器

```
Docker 容器 + Xvfb：
┌─────────────────────────────┐
│  容器 (Container)            │
│  ┌─────────────────────┐    │
│  │  Xvfb 虚拟显示器     │    │
│  │  ┌───────────────┐  │    │
│  │  │ 内存中的屏幕   │  │    │ ← 在内存中模拟显示器
│  │  │ (1920x1080)   │  │    │
│  │  │ [Chrome 窗口] │  │    │ ← 浏览器以为有显示器
│  │  └───────────────┘  │    │
│  └─────────────────────┘    │
│                             │
│  DISPLAY=:99                │ ← 环境变量指向虚拟显示器
└─────────────────────────────┘
```

**工作原理：**
1. 启动 Xvfb 进程（创建虚拟显示器 :99）
2. 设置 `DISPLAY=:99` 环境变量
3. 浏览器连接到虚拟显示器
4. 浏览器正常渲染，但不需要物理显示器

**优点：**
- ✅ 让 Headed 模式在 Docker 中工作
- ✅ 支持扫码登录
- ✅ 完全自动化，无需手动配置
- ✅ 资源占用少（只在内存中）

---

## 🚀 SuperCrawler 实现

### 自动 Xvfb 管理

SuperCrawler 的 Docker 镜像已内置 Xvfb 支持，**自动管理**：

```bash
# Headless 模式（默认）- 不需要 Xvfb
docker run -d --name supercrawler -p 5510:5510 \
  -v ~/supercrawler/data:/data \
  -e CLOAK_HEADLESS=true \
  ghcr.io/shun83914/supercrawler:v1.0.3-debian-amd64

# 输出：
# 🔇 检测到 CLOAK_HEADLESS=true，使用 Headless 模式（无需 Xvfb）
# 🚀 启动 SuperCrawler 服务...


# Headed 模式（扫码登录）- 自动启动 Xvfb
docker run -d --name supercrawler -p 5510:5510 \
  -v ~/supercrawler/data:/data \
  -e CLOAK_HEADLESS=false \
  ghcr.io/shun83914/supercrawler:v1.0.3-debian-amd64

# 输出：
# 🖥️  检测到 CLOAK_HEADLESS=false，启动 Xvfb 虚拟显示器...
# ✅ Xvfb 虚拟显示器启动成功 (DISPLAY=:99)
#    分辨率: 1920x1080x24
# 🚀 启动 SuperCrawler 服务...
```

### 扫码登录流程

```bash
# 1. 启动 Headed 模式容器
docker run -d --name supercrawler -p 5510:5510 \
  -v ~/supercrawler/data:/data \
  -e CLOAK_HEADLESS=false \
  ghcr.io/shun83914/supercrawler:v1.0.3-debian-amd64

# 2. 触发登录（通过 API 或 MCP）
curl -X POST http://localhost:5510/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"platform":"xhs","accountId":"default"}'

# 3. 在虚拟显示器中会显示二维码
#    虽然你看不到，但浏览器已经正常渲染

# 4. 使用手机扫码登录
#    （登录状态会保存到 data/profiles 目录）

# 5. 后续可以切换到 Headless 模式
docker stop supercrawler
docker rm supercrawler

docker run -d --name supercrawler -p 5510:5510 \
  -v ~/supercrawler/data:/data \
  -e CLOAK_HEADLESS=true \  # 切换到 headless
  ghcr.io/shun83914/supercrawler:v1.0.3-debian-amd64
```

---

## 🔍 查看虚拟显示器中的内容（可选）

如果你想"看到"虚拟显示器中的内容（调试用）：

### 方法 1：VNC 远程桌面

```bash
# 1. 安装 x11vnc
docker exec supercrawler apt-get update && \
  docker exec supercrawler apt-get install -y x11vnc

# 2. 启动 VNC 服务器
docker exec supercrawler x11vnc -display :99 -forever -nopw -listen 0.0.0.0 -rfbport 5900 &

# 3. 使用 VNC 客户端连接
# macOS: 打开 Finder → 前往 → 连接服务器 → vnc://localhost:5900
```

### 方法 2：截图查看

```bash
# 截取虚拟显示器屏幕
docker exec supercrawler apt-get install -y scrot
docker exec supercrawler sh -c 'DISPLAY=:99 scrot /tmp/screen.png'

# 复制到宿主机
docker cp supercrawler:/tmp/screen.png ./screen.png

# 查看截图
open ./screen.png  # macOS
xdg-open ./screen.png  # Linux
```

---

## ⚙️ 环境变量说明

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `CLOAK_HEADLESS` | `true` | 浏览器模式：`true`=Headless, `false`=Headed |
| `DISPLAY` | 自动设置 | Xvfb 显示器编号（通常 `:99`） |

---

## 📊 对比总结

| 特性 | Headless | Headed + Xvfb |
|------|----------|---------------|
| 显示界面 | ❌ 无 | ✅ 有（虚拟） |
| 扫码登录 | ❌ 不支持 | ✅ 支持 |
| 资源占用 | 少 | 中等 |
| 启动速度 | 快 | 中等 |
| 反检测 | 弱 | 强 |
| 适用场景 | 已登录抓取 | 首次登录/调试 |

---

## 💡 最佳实践

### 推荐工作流程

```
1. 首次部署（需要登录）
   ↓
   使用 Headed 模式 + Xvfb
   扫码登录
   ↓
2. 登录成功后
   ↓
   切换到 Headless 模式
   高效抓取
```

### 示例

```bash
# 阶段 1：首次登录
docker run -d --name supercrawler -p 5510:5510 \
  -v ~/supercrawler/data:/data \
  -e CLOAK_HEADLESS=false \
  ghcr.io/shun83914/supercrawler:v1.0.3-debian-amd64

# 触发登录并扫码...
# 登录成功！

# 阶段 2：切换为 Headless（高效抓取）
docker stop supercrawler
docker rm supercrawler

docker run -d --name supercrawler -p 5510:5510 \
  -v ~/supercrawler/data:/data \
  -e CLOAK_HEADLESS=true \
  ghcr.io/shun83914/supercrawler:v1.0.3-debian-amd64

# 开始高效抓取！
```

---

## ❓ 常见问题

### Q1: 为什么源码安装可以用 Headed，Docker 不行？

**A:** 源码安装在你的电脑上运行，有物理显示器。Docker 容器是隔离环境，没有显示器。

### Q2: Xvfb 会影响性能吗？

**A:** 几乎不影响。Xvfb 只在内存中渲染，不涉及 GPU，资源占用很少（约 50-100MB 内存）。

### Q3: 我能看到虚拟显示器中的内容吗？

**A:** 可以，使用 VNC 或截图（见上文"查看虚拟显示器中的内容"）。但通常不需要，扫码登录会自动完成。

### Q4: Headless 模式抓取的数据准确吗？

**A:** 完全准确。Headless 只是不显示界面，浏览器功能完全相同。但某些网站会检测 headless 并阻止。

### Q5: 为什么默认使用 Headless？

**A:** 因为大多数场景（已登录抓取）不需要界面，Headless 更快更省资源。只在首次登录时需要 Headed。

---

## 🔧 技术实现细节

### entrypoint.sh 脚本

```bash
#!/bin/bash
# 自动检测模式并启动 Xvfb

if [ "$CLOAK_HEADLESS" = "false" ]; then
  # 启动虚拟显示器
  Xvfb :99 -screen 0 1920x1080x24 -ac &
  export DISPLAY=:99
fi

# 启动主程序
exec node dist/main.js
```

### Dockerfile 配置

```dockerfile
# 安装 Xvfb
RUN apt-get install -y xvfb x11-utils

# 使用 entrypoint 脚本
COPY entrypoint.sh /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
```

---

**现在你可以在 Docker 中完美使用 Headed 模式扫码登录了！** 🎉
