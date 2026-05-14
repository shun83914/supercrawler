# 美团经营宝 OpenClaw 使用指南

> 📋 本文档说明如何在 OpenClaw 中使用美团经营宝的抓取工具进行数据分析。

---

## 🎯 快速开始（3 步完成）

### 步骤 1：确认 SuperCrawler 服务运行中

```bash
# 检查 Docker 容器是否运行
docker ps | grep supercrawler

# 如果没有运行，启动容器
docker start supercrawler
```

### 步骤 2：确认 MCP 配置正确

OpenClaw 的 MCP 配置文件位于：`~/.openclaw/mcp.json` 或项目根目录的 `.openclaw/mcp.json`

**必需配置**（已自动包含）：
```json
{
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

### 步骤 3：确认美团 Skill 已安装

美团抓取 Skill 位于：`.openclaw/skills/meituan-scraper/`

**包含文件**：
- ✅ `skill.json` - Skill 元数据
- ✅ `SKILL.md` - 使用指南和工作流
- ✅ `index.mjs` - 钩子函数（健康检查、错误预警）

---

## 🛠️ 可用的美团抓取工具

OpenClaw 会自动发现以下 **5 个美团 MCP 工具**：

| 工具名称 | 功能 | 触发关键词 |
|---------|------|-----------|
| `meituan_scrape_orders` | 抓取订单数据 | "美团订单"、"经营宝订单" |
| `meituan_scrape_products` | 抓取商品数据 | "美团商品"、"商品信息" |
| `meituan_scrape_reviews` | 抓取商品评价 | "美团评价"、"用户评价" |
| `meituan_scrape_promotion_campaigns` | 抓取推广通活动 | "推广通"、"推广活动" |
| `meituan_scrape_promotion_stats` | 抓取推广数据统计 | "推广数据"、"推广效果" |

---

## 📖 使用场景与示例

### 场景 1：抓取订单数据

**用户对话**：
> "帮我抓取美团经营宝最近 7 天的订单"

**Agent 自动执行**：
```javascript
// Agent 会调用：
meituan_scrape_orders({
  startDate: "2025-05-04T00:00:00Z",
  endDate: "2025-05-11T23:59:59Z",
  limit: 100
})
```

**返回数据**：
- 订单 ID、订单号、状态
- 商品名称、数量、金额
- 下单时间、支付时间
- 用户信息（昵称、电话、地址）

---

### 场景 2：分析推广通活动效果

**用户对话**：
> "查看所有运行中的推广通活动，哪些消耗最多？"

**Agent 自动执行**：
```javascript
// 第一步：抓取推广通活动
meituan_scrape_promotion_campaigns({
  status: "running",
  limit: 50
})

// 第二步：分析数据
// Agent 会根据返回的 spent（消耗）、ctr（点击率）、cpc（点击成本）排序
```

**分析维度**：
- 📊 消耗金额排名
- 📈 点击率（CTR）对比
- 💰 平均点击成本（CPC）
- 🎯 转化率分析

---

### 场景 3：推广数据统计与 ROI 分析

**用户对话**：
> "分析最近 30 天的推广效果，ROI 怎么样？"

**Agent 自动执行**：
```javascript
// 抓取每日推广统计数据
meituan_scrape_promotion_stats({
  period: "day",
  startDate: "2025-04-11T00:00:00Z",
  endDate: "2025-05-11T23:59:59Z"
})
```

**返回数据**：
- 📅 每日统计数据
- 👁️ 展示次数、点击次数、CTR
- 💵 总消耗、平均 CPC
- 🎯 转化次数、转化率、ROI
- 📦 推广订单数、交易额
- 🏆 最佳表现商品
- 🌆 最佳表现城市

---

### 场景 4：商品评价分析

**用户对话**：
> "抓取商品 ID 123456 的评价，只要 4 星以上的"

**Agent 自动执行**：
```javascript
meituan_scrape_reviews({
  productId: "123456",
  rating: 4,
  limit: 50
})
```

---

## 🔧 高级用法

### 1. 组合查询：推广效果 + 订单数据

**用户对话**：
> "帮我分析推广通活动带来的订单转化情况"

**Agent 工作流程**：
```
1. 抓取推广通活动列表
   → meituan_scrape_promotion_campaigns({status: "running"})

2. 抓取推广统计数据
   → meituan_scrape_promotion_stats({period: "day", startDate: "...", endDate: "..."})

3. 抓取订单数据
   → meituan_scrape_orders({startDate: "...", endDate: "..."})

4. 综合分析：
   - 推广消耗 vs 订单收入
   - ROI 计算
   - 高转化活动识别
   - 优化建议
```

---

### 2. 时间范围过滤

所有支持时间的工具都可以使用 ISO 8601 格式：

```javascript
// 示例：抓取本月数据
{
  startDate: "2025-05-01T00:00:00Z",
  endDate: "2025-05-31T23:59:59Z"
}
```

---

### 3. 状态过滤

推广通活动支持按状态过滤：

```javascript
{
  status: "running"    // 运行中
  status: "paused"     // 已暂停
  status: "expired"    // 已过期
}
```

---

## ⚠️ 注意事项

### 1. 登录态检查

**首次使用**时，Agent 会自动检查登录状态：

```
1. 调用 health() 确认服务在线
2. 调用 auth_status({accountId: "meituan-default"})
3. 如果未登录 → 调用 auth_login({platform: "meituan"})
4. 等待您在浏览器中完成登录
```

### 2. 并发限制

- ⚠️ **不要同时调用多个美团工具**（服务端 concurrency=1）
- ✅ Agent 会自动排队执行
- 💡 批量数据请一次性说明需求

### 3. 数据量控制

- 默认 `limit=50`，最大 `200`
- 避免设置 `includeRecords=true`（会占用大量上下文）
- 使用 `storage_peek` 分页读取大文件

### 4. 错误处理

常见错误码：

| 错误码 | 原因 | 解决方法 |
|--------|------|---------|
| `LOGIN_REQUIRED` | 未登录 | Agent 会自动调用 auth_login |
| `LOGIN_TIMEOUT` | 登录超时 | 重新触发登录流程 |
| `RATE_LIMITED` | 触发风控 | 等待 5 分钟后重试 |
| `TIMEOUT` | 网络超时 | 自动重试 ≤2 次 |

---

## 🚀 完整工作流示例

### 需求："帮我做一份推广效果周报"

**Agent 自动执行流程**：

```
Step 1: 前置检查
├─ health() → 服务在线 ✅
├─ auth_status({accountId: "meituan-default"}) → 已登录 ✅
└─ 准备抓取数据

Step 2: 抓取推广通活动
├─ meituan_scrape_promotion_campaigns({status: "running", limit: 50})
├─ 获取活动列表、预算、消耗、CTR、CPC
└─ 保存文件：meituan-promotion-campaigns.jsonl

Step 3: 抓取推广统计
├─ meituan_scrape_promotion_stats({
│    period: "day",
│    startDate: "2025-05-04T00:00:00Z",
│    endDate: "2025-05-11T23:59:59Z"
│  })
├─ 获取每日：展示、点击、转化、ROI、订单
└─ 保存文件：meituan-promotion-stats.jsonl

Step 4: 抓取订单数据
├─ meituan_scrape_orders({
│    startDate: "2025-05-04T00:00:00Z",
│    endDate: "2025-05-11T23:59:59Z",
│    limit: 200
│  })
└─ 保存文件：meituan-orders.jsonl

Step 5: 数据分析与报告
├─ 计算本周 ROI = 推广收入 / 推广消耗
├─ 对比各活动表现（CTR、CPC、转化率）
├─ 识别高转化时段和城市
├─ 找出最佳表现商品
└─ 生成周报（包含图表和建议）

Step 6: 输出报告
✅ 本周推广总览
✅ 活动表现排名
✅ ROI 趋势分析
✅ 优化建议（暂停低效活动、调整预算分配）
```

---

## 📚 相关文件

- MCP 配置：`.openclaw/mcp.json`
- Skill 目录：`.openclaw/skills/meituan-scraper/`
- 使用指南：`.openclaw/skills/meituan-scraper/SKILL.md`
- Skill 元数据：`.openclaw/skills/meituan-scraper/skill.json`

---

## 💡 常见问题

### Q1: Agent 没有识别到美团工具？

**检查清单**：
1. ✅ SuperCrawler 容器是否运行：`docker ps | grep supercrawler`
2. ✅ MCP 配置是否正确：`cat ~/.openclaw/mcp.json`
3. ✅ 重启 OpenClaw：`openclaw restart`
4. ✅ 检查日志：`openclaw logs`

### Q2: 提示需要登录？

Agent 会自动处理登录流程：
1. 弹出浏览器（headful 模式）
2. 等待您扫码或输入账号密码
3. 登录成功后自动继续抓取

### Q3: 数据抓取不完整？

- 增加 `limit` 参数（最大 200）
- 使用 `storage_peek` 读取完整文件
- 检查是否有过滤条件（日期、状态等）

### Q4: 如何查看原始数据文件？

```javascript
// Agent 会使用 storage_peek 工具
storage_peek({
  file: "data/output/meituan-promotion-stats.jsonl",
  offset: 0,
  limit: 50
})
```

---

## 🎓 下一步

- 📖 查看完整 Skill 文档：`.openclaw/skills/meituan-scraper/SKILL.md`
- 🔧 自定义抓取参数：参考 `src/meituan/dto/scrape.dto.ts`
- 📊 数据分析示例：询问 Agent "如何做推广数据分析"

---

**文档版本**: v1.0  
**最后更新**: 2025-05-11  
**维护者**: SuperCrawler Team
