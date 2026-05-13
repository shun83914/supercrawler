# SuperCrawler — OpenClaw 用户快速上手

> 你不需要懂 Node.js / npm / 源码，只需要 Docker。

---

## 3 分钟启动

### 1️⃣ 安装 Docker

- Mac: https://docs.docker.com/desktop/install/mac-install/
- Windows: https://docs.docker.com/desktop/install/windows-install/
- Linux: `curl -fsSL https://get.docker.com | sh`

### 2️⃣ 一行命令启动

```bash
mkdir -p ~/supercrawler/data && \
docker run -d --name supercrawler -p 5510:5510 \
  -v ~/supercrawler/data:/data \
  -e CLOAK_HEADLESS=false \
  ghcr.io/shun83914/supercrawler:latest && \
echo "✅ 服务已启动，访问 http://localhost:5510"
```

### 3️⃣ 扫码登录（首次）

**小红书：**
```bash
curl -X POST http://localhost:5510/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"accountId":"default"}'
# 弹出的浏览器中用小红书 App 扫码
```

**抖音：**
```bash
curl -X POST http://localhost:5510/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"accountId":"default","platform":"douyin"}'
# 弹出的浏览器中用抖音 App 扫码
```

### 4️⃣ OpenClaw 配置

把以下内容添加到 OpenClaw 配置：

```json
{
  "mcpServers": {
    "supercrawler": {
      "command": "docker",
      "args": ["exec", "-i", "supercrawler", "node", "dist/mcp/mcp.stdio.js"]
    }
  }
}
```

---

## 常用命令

```bash
# 查看服务状态
docker ps | grep supercrawler

# 查看日志
docker logs -f supercrawler

# 重启
docker restart supercrawler

# 停止
docker stop supercrawler

# 更新到最新版
docker pull ghcr.io/shun83914/supercrawler:latest
docker stop supercrawler && docker rm supercrawler
# 重新执行第 2 步的 docker run 命令
```

---

## 验证是否成功

```bash
# 健康检查
curl http://localhost:5510/api/health

# 查看登录态
curl "http://localhost:5510/api/auth/status?accountId=default"

# 测试搜索
curl -X POST http://localhost:5510/api/xhs/search \
  -H "Content-Type: application/json" \
  -d '{"keywords":["穿搭"],"sort":"hot","limit":3}'
```

---

## 遇到问题？

| 现象 | 解决 |
| -- | -- |
| `curl` 连接被拒绝 | `docker logs supercrawler` 查看是否启动成功 |
| 浏览器不弹出 | 确认启动时有 `-e CLOAK_HEADLESS=false` |
| 提示未登录 | 先执行第 3 步扫码 |
| 数据没了 | 检查 `~/supercrawler/data` 目录是否存在 |
| Headed 模式无法显示窗口 | Docker 已内置 Xvfb 虚拟显示器，自动处理 |

## 📚 重要概念

### Headless vs Headed 模式

**Headless（无头模式）** = 浏览器在后台运行，不显示界面
- ✅ 优点：速度快、资源少、适合服务器
- ❌ 缺点：某些网站会检测并阻止

**Headed（有头模式）** = 浏览器正常显示界面
- ✅ 优点：可以看到浏览器、可以扫码登录
- ❌ 缺点：需要显示器（GUI 环境）

### Docker 中的 Xvfb 虚拟显示器

Docker 容器默认没有显示器，SuperCrawler 已集成 **Xvfb**（X Virtual Framebuffer）：
- 在内存中创建虚拟显示器
- 让 Headed 模式在 Docker 中正常工作
- 自动启动，无需手动配置

```bash
# Headless 模式（默认，适合搜索抓取）
docker run -d --name supercrawler -p 5510:5510 \
  -v ~/supercrawler/data:/data \
  -e CLOAK_HEADLESS=true \
  ghcr.io/shun83914/supercrawler:v1.0.3-debian-amd64

# Headed 模式（需要扫码登录，自动使用 Xvfb）
docker run -d --name supercrawler -p 5510:5510 \
  -v ~/supercrawler/data:/data \
  -e CLOAK_HEADLESS=false \
  ghcr.io/shun83914/supercrawler:v1.0.3-debian-amd64
```

详细文档：https://github.com/shun83914/supercrawler
