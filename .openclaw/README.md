# .openclaw/ — OpenClaw 集成配置

本目录为项目团队共享的 OpenClaw agent 集成资产，提交到仓库即可让任何人
clone 后一键接入。

## 目录结构

```
.openclaw/
├── mcp.json                          # MCP server 注册（指向 dist/mcp/mcp.stdio.js）
├── mcp.absolute.json                 # 绝对路径兼容版（不支持 ${workspaceFolder} 时用）
├── mcp.absolute.generate.sh          # 从当前工作区重生绝对路径 mcp.json
└── skills/
    ├── xhs-scraper/                  # 小红书 基础单账号 skill
    │   ├── SKILL.md                  # agent 可读指令（工作流 + 错误码决策）
    │   ├── skill.json                # skill 元信息（entry/env/requires）
    │   └── index.mjs                 # before/after 钩子（存活探测 + 风控预警）
    ├── xhs-multi-account/            # 小红书 多账号轮询 skill（长任务/批量场景推荐）
    │   ├── SKILL.md                  # agent 约定（不传 accountId 让钩子自动注入）
    │   ├── skill.json
    │   └── index.mjs                 # 账号池 + LRU + 冷却窗口调度器
    └── douyin-scraper/               # 抖音 基础单账号 skill
        ├── SKILL.md                  # agent 可读指令（工作流 + 错误码决策，含验证码/风控）
        ├── skill.json
        └── index.mjs                 # before/after 钩子（DOUYIN_CAPTCHA 预警）
```

## 快速开始

```bash
# 1. 生成 token（服务端 .env 自动写入）
node scripts/gen-token.mjs
# → 按提示 export SUPERCRAWLER_TOKEN=...

# 2. 构建 MCP server
npm run build

# 3. 首次扫码（至少登录 1 个账号）
npm run start:dev   # 另一终端窗口
curl -X POST http://localhost:3000/api/auth/login \
  -H "X-API-Key: $SUPERCRAWLER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"accountId":"default"}'
# 多账号：重复上一步，把 accountId 换成 biz1/biz2/...

# 4. OpenClaw 已自动加载 .openclaw/mcp.json 与 .openclaw/skills/
#    （如果是全局 OpenClaw，复制到 ~/.openclaw/ 或配置项目工作区路径）
```

## 三个 skill 怎么选

| 场景 | 选 | 原因 |
|---|---|---|
| 小红书：单次/小批量抓取 | `xhs-scraper` | 简单，agent 完全掌控 accountId |
| 小红书：批量 ≥20 目标 / 长周期 | `xhs-multi-account` | 自动轮询 + 冷却，显著降风控概率 |
| 小红书：频繁撞 RATE_LIMITED | `xhs-multi-account` | 单账号已极限，多账号分摊 |
| 抖音：单次/小批量抓取 | `douyin-scraper` | platform=douyin，包含验证码预警 |

注：抖音调用任何 `auth_login` / `auth_status` 请传参 `platform: "douyin"`。

## 全局安装（可选）

### 方式 A：symlink（推荐，随项目更新自动生效）

```bash
mkdir -p ~/.openclaw
ln -sf "$(pwd)/.openclaw/mcp.json"   ~/.openclaw/mcp.json
ln -sf "$(pwd)/.openclaw/skills"     ~/.openclaw/skills
```

### 方式 B：绝对路径复制（OpenClaw 不支持 `${workspaceFolder}` 时）

```bash
bash .openclaw/mcp.absolute.generate.sh --to-home
# 自动生成 .openclaw/mcp.absolute.json 并同步到 ~/.openclaw/mcp.json
```

## 运维工具

| 命令 | 用途 |
|------|------|
| `npm run gen-token` | 生成 token 并写入 .env |
| `npm run gen-token -- --print-only` | 仅打印不落盘 |
| `npm run accounts:status` | 表格输出所有账号的登录态 |
| `npm run accounts:status -- --json` | JSON 输出（CI 巡检）、退出码 0=全健康 / 1=部分失效 / 2=服务不可达 |
| `./scripts/login.sh xhs` | 小红书登录（自动处理 Headed/Headless 切换） |
| `./scripts/login.sh douyin` | 抖音登录 |
| `./scripts/login.sh xhs biz1` | 多账号登录 |
