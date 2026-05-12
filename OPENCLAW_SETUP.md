# OpenClaw 配置 SuperCrawler — Agent 自动安装指南

> **目标**：让 OpenClaw agent 自动完成 MCP 配置和 Skill 安装
> 
> **前提条件**（需要先确认）：
> - [ ] Docker 镜像已运行（执行 `docker ps | grep supercrawler` 验证）
> - [ ] 容器名为 `supercrawler`（如果不是，记录下来）
> - [ ] 用户已提供 `SUPERCRAWLER_TOKEN`（如果服务设置了鉴权）

---

## 🤖 Agent 自动执行流程

### Step 1: 验证 Docker 容器状态

**执行命令：**
```bash
docker ps --filter "name=supercrawler" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
```

**预期输出：**
```
NAMES         STATUS          PORTS
supercrawler  Up 5 minutes    0.0.0.0:5510->5510/tcp
```

**决策：**
- 如果容器存在 → 继续 Step 2
- 如果容器不存在 → 提示用户先启动 Docker 镜像

---

### Step 2: 创建 OpenClaw 配置目录

**执行命令：**
```bash
mkdir -p ~/.openclaw
```

**说明：** 确保 `~/.openclaw` 目录存在

---

### Step 3: 配置 MCP Server

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

### Step 4: 安装 Skills（可选但推荐）

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

### Step 5: 配置环境变量（如果需要）

**检查用户是否提供了 token：**
```bash
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
  echo "✅ 环境变量已设置"
else
  echo "⚠️  未提供 SUPERCRAWLER_TOKEN，如果服务需要鉴权，请手动配置"
fi
```

---

### Step 6: 验证配置

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

### Step 7: 生成配置报告

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

## 📝 Agent 执行说明

**给 agent 的指令：**

> 请按照上述 Step 1-7 顺序执行，每步完成后输出执行结果。
> 
> **注意事项：**
> 1. 如果遇到错误，停止执行并提示用户
> 2. 如果用户提供了 SUPERCRAWLER_TOKEN，一定要配置到环境变量
> 3. 容器名如果不是 `supercrawler`，需要替换所有命令中的容器名
> 4. 不要跳过验证步骤，每步都要确认成功再继续
> 
> **用户可能提供的信息：**
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
