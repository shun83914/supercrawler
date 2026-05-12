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
  ghcr.io/<用户名>/supercrawler:latest && \
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
docker pull ghcr.io/<用户名>/supercrawler:latest
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

详细文档：https://github.com/<用户名>/supercrawler
