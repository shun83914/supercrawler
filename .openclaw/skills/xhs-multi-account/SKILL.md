---
name: xhs-multi-account
description: 多账号轮询版小红书抓取 skill。自动在 profile 池中挑选可用账号注入 accountId，
  遇到 RATE_LIMITED/XHS_BLOCKED 自动冷却该账号切换下一个，显著降低单账号被风控概率。
  触发时机：用户明确要求"多账号"/"轮询"/"批量长任务"，或 xhs-scraper 频繁撞风控时。
version: 0.1.0
tools:
  - supercrawler:health
  - supercrawler:auth_status
  - supercrawler:auth_login
  - supercrawler:auth_cleanup
  - supercrawler:xhs_scrape_notes
  - supercrawler:xhs_scrape_user
  - supercrawler:xhs_scrape_search
  - supercrawler:xhs_scrape_comments
  - supercrawler:xhs_batch
  - supercrawler:storage_peek
---

# xhs-multi-account skill（多账号轮询版）

本 skill 在 `xhs-scraper` 基础上增加**账号池管理**，由 skill 钩子自动为每次
`xhs_scrape_*` 调用注入最优 `accountId`，你（agent）**不需要**自己选账号。

## 使用规则（agent 端）

1. **不要主动传 `accountId`**：留空让 skill 钩子自动注入；你传了会覆盖轮询逻辑
2. **工具调用形式与 xhs-scraper 完全一致**（同一套 MCP tools）
3. **冷却响应识别**：若钩子返回 `code=ALL_ACCOUNTS_COOLING` → 告知用户"全部账号冷却中"并停止

## 工作流

### Step 1: 预热账号池
首次会话时调一次 `supercrawler:health` 看 `accounts.profilesOnDisk`：
- 若 ≥2 → skill 自动启用轮询
- 若 =1 → 退化为单账号模式（等价 xhs-scraper）
- 若 =0 → 提示用户至少登录一个账号

### Step 2: 常规抓取
调用 `xhs_scrape_search` / `xhs_scrape_notes` 等工具时**省略 accountId**，
skill 钩子会：
1. 从池中选一个非冷却、登录态有效、最久未使用的 accountId
2. 注入到 `args.accountId`
3. 调用完成后记录 lastUsedAt；失败码是风控类时打入 10min 冷却

### Step 3: 失败码决策（与单账号版差异）

| code | 单账号版 | 多账号版差异 |
|---|---|---|
| `RATE_LIMITED` / `XHS_BLOCKED` | 停止退避 | **skill 自动冷却该账号**，你继续调用下一次即切到其它账号 |
| `LOGIN_REQUIRED` | 调 auth_login | skill 跳过该账号，检查原因；全部失效时才提示 |
| `ALL_ACCOUNTS_COOLING`（本 skill 自定义） | — | 全部账号冷却中，建议 5-10 分钟后再试 |

## 示例

> **User**: 批量抓 30 个 noteId 的详情

```
# 不必传 accountId，skill 自动分配
xhs_batch({
  tasks: [{type:"note", id:"..."}, ... 30 条]
})
```

skill 钩子会在 agent 不感知的情况下轮询 `default`/`biz1`/`biz2` 三个账号执行，
任一账号触发风控自动冷却 10min，其它账号继续服务。

## 硬性约束

- **PROFILE_DIR 里每个子目录 = 一个 accountId**（命名仅允许 `[\w.-]{1,64}`）
- **冷却期默认 10 分钟**（可由 `XHS_COOL_DOWN_MS` 环境变量覆盖）
- **不兼容显式 auth_login**：扫码登录仍需手工指定 `accountId`
- **服务端 concurrency=1 的限制不变**——轮询只降单账号打扰频率，不提升总吞吐

## 登录态管理

### 多账号登录态检查
```javascript
// 检查所有账号的登录状态
auth_status({ accountId: "default", platform: "xhs" })
auth_status({ accountId: "biz1", platform: "xhs" })
auth_status({ accountId: "biz2", platform: "xhs" })
```

### 处理账号登录失效

当某个账号返回 `LOGIN_REQUIRED` 时：
1. Skill 钩子自动跳过该账号
2. 选择下一个登录态有效的账号
3. 如果全部账号都失效，提示用户：
   ```
   ⚠️ 所有小红书账号均未登录或已过期
   
   请逐个账号登录：
   ./scripts/login.sh xhs default
   ./scripts/login.sh xhs biz1
   ./scripts/login.sh xhs biz2
   
   登录完成后继续抓取。
   ```

### ⚠️ 登录模式说明

**重要：OpenClaw 服务运行在 Headless 模式（无法弹出浏览器）**

登录需要切换到 Headed 模式，请使用登录脚本：
```bash
# 登录指定账号
./scripts/login.sh xhs default
./scripts/login.sh xhs biz1
./scripts/login.sh xhs biz2

# 如果不指定 accountId，默认登录 default
./scripts/login.sh xhs
```

**登录态持久化：**
- 登录态通过 Volume 挂载持久化
- 7 天内自动缓存，不重复验证
- 多账号共享同一个 Volume，切换模式不丢失
