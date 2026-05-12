# SuperCrawler — Docker 部署指南

> 给 **OpenClaw agent** 当 **skill 工具** 使用的 **小红书 + 抖音** 数据抓取服务。
> 一行 Docker 命令即可运行，无需安装 Node.js/npm。

---

## 快速开始

### 1. 启动服务

```bash
# 创建数据目录
mkdir -p ~/supercrawler/data

# 启动（后台运行，端口 5510）
docker run -d \
  --name supercrawler \
  -p 5510:5510 \
  -v ~/supercrawler/data:/data \
  -e API_TOKEN=$(openssl rand -hex 32) \
  -e CLOAK_HEADLESS=false \
  --restart unless-stopped \
  ghcr.io/<你的用户名>/supercrawler:latest

# 查看日志
docker logs -f supercrawler
```

> **镜像地址选择：**
> - Docker Hub: `<你的用户名>/supercrawler:latest`
> - GitHub Container Registry: `ghcr.io/<你的用户名>/supercrawler:latest`

### 2. 生成并记录 Token

```bash
# 如果启动时没设置 API_TOKEN，手动生成一个
export API_TOKEN=$(openssl rand -hex 32)
echo "你的 Token: $API_TOKEN"
# ⚠️ 把上面的 Token 记下来，后续所有 API 调用都要用
```

### 3. 扫码登录

**小红书：**
```bash
curl -X POST http://localhost:5510/api/auth/login \
  -H "X-API-Key: $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"accountId":"default"}'
# 屏幕会弹出浏览器，用小红书 App 扫码
```

**抖音：**
```bash
curl -X POST http://localhost:5510/api/auth/login \
  -H "X-API-Key: $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"accountId":"default","platform":"douyin"}'
# 屏幕会弹出浏览器，用抖音 App 扫码
```

### 4. 验证安装

```bash
# 健康检查
curl http://localhost:5510/api/health

# 查看账号状态
curl "http://localhost:5510/api/auth/status?accountId=default" \
  -H "X-API-Key: $API_TOKEN"

# 测试抓取（小红书搜索）
curl -X POST http://localhost:5510/api/xhs/search \
  -H "X-API-Key: $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"keywords":["穿搭"],"sort":"hot","limit":5}'
```

---

## Docker Compose（推荐）

创建 `docker-compose.yml`：

```yaml
version: "3.9"

services:
  supercrawler:
    image: ghcr.io/<你的用户名>/supercrawler:latest
    container_name: supercrawler
    restart: unless-stopped
    environment:
      PORT: 5510
      API_TOKEN: ${API_TOKEN:-}  # 从 .env 读取
      CLOAK_HEADLESS: "false"    # 需要扫码登录时设为 false
      CLOAK_HUMANIZE: "true"
      XHS_SCRAPE_CONCURRENCY: "1"
      DOUYIN_SCRAPE_CONCURRENCY: "1"
    ports:
      - "5510:5510"
    volumes:
      - ./data:/data
```

创建 `.env`：
```env
API_TOKEN=你的token（openssl rand -hex 32 生成）
```

启动：
```bash
docker compose up -d
docker compose logs -f
```

---

## 环境变量

| 变量 | 默认 | 说明 |
| -- | -- | -- |
| `PORT` | 5510 | HTTP 端口 |
| `API_TOKEN` | *(空)* | 鉴权 token（⚠️ 生产环境必须设置） |
| `CLOAK_HEADLESS` | true | 抓取/登录是否无头 |
| `CLOAK_HUMANIZE` | true | 人类行为模拟 |
| `XHS_SCRAPE_CONCURRENCY` | 1 | 小红书并发上限 |
| `DOUYIN_SCRAPE_CONCURRENCY` | 1 | 抖音并发上限 |
| `CACHE_TTL_MS` | 300000 | 幂等缓存 TTL (5分钟) |

---

## API 速查

| 端点 | 用途 |
| -- | -- |
| `GET /api/health` | 健康检查 |
| `POST /api/auth/login` | 扫码登录 |
| `GET /api/auth/status` | 查询登录态 |
| `POST /api/xhs/search` | 小红书搜索 |
| `POST /api/xhs/notes` | 小红书笔记详情 |
| `POST /api/douyin/search` | 抖音搜索 |
| `POST /api/douyin/awemes` | 抖音作品详情 |
| `GET /api/storage/peek` | 读取 JSONL 结果 |

完整文档：`http://localhost:5510/docs` (Swagger UI)

---

## OpenClaw 接入

### MCP 配置

在 OpenClaw 配置中添加：

```json
{
  "mcpServers": {
    "supercrawler": {
      "command": "docker",
      "args": [
        "exec", "-i", "supercrawler",
        "node", "dist/mcp/mcp.stdio.js"
      ],
      "env": {
        "PROFILE_DIR": "/data/profiles"
      }
    }
  }
}
```

### Skill 文件

把项目中的 `.openclaw/skills/` 目录复制到 `~/.openclaw/skills/`：

```bash
# 从源码仓库复制（或从 release 包中解压）
cp -r .openclaw/skills/xhs-scraper ~/.openclaw/skills/
cp -r .openclaw/skills/douyin-scraper ~/.openclaw/skills/
```

---

## 运维命令

```bash
# 查看日志
docker logs -f supercrawler

# 重启服务
docker restart supercrawler

# 停止服务
docker stop supercrawler

# 查看数据（抓取结果）
ls -lh ~/supercrawler/data/output/

# 更新镜像
docker pull ghcr.io/<你的用户名>/supercrawler:latest
docker stop supercrawler
docker rm supercrawler
# 重新执行第 1 步的 docker run 命令
```

---

## 故障排查

| 问题 | 解决方案 |
| -- | -- |
| 启动后 `/api/health` 不通 | `docker logs supercrawler` 查看启动日志 |
| 扫码浏览器不弹出 | 检查 `CLOAK_HEADLESS` 是否为 `false` |
| 提示 `LOGIN_REQUIRED` | 先执行 `/api/auth/login` 扫码 |
| 数据丢失 | 确认 `-v ~/supercrawler/data:/data` 挂载正确 |
| 容器重启循环 | `docker logs supercrawler` 查看错误，通常是端口冲突 |

---

## 镜像来源

- **Docker Hub**: `https://hub.docker.com/r/<你的用户名>/supercrawler`
- **GitHub Container Registry**: `https://github.com/<你的用户名>/supercrawler/pkgs/container/supercrawler`
