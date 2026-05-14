# 美团经营宝 - 登录状态检测说明

## ✅ 好消息：支持检测已登录状态！

现在系统可以**自动检测您是否已经登录美团经营宝**。

---

## 🎯 使用流程

### 方式 1：提前在浏览器登录（推荐）

#### 步骤：

1. **在浏览器中登录**
   ```
   1. 打开 Chrome/Edge 浏览器
   2. 访问: https://ecom.meituan.com/
   3. 使用账号密码登录:
      - 账号: 123ZXT123
      - 密码: DJS@666888
   4. 确保登录成功，能看到经营宝首页
   ```

2. **运行抓取任务**
   ```bash
   # 测试登录检测
   ./test-meituan-login.sh
   
   # 或直接使用 MCP 工具（通过 OpenClaw）
   # Agent 会自动检测登录状态
   ```

3. **系统自动检测**
   ```
   系统会通过以下方式检测登录：
   ✅ 检查登录 Cookie
   ✅ 检查 localStorage
   ✅ 检查页面用户元素
   ✅ 检查当前 URL（是否在登录页）
   ```

4. **检测成功后开始抓取**
   ```
   ✅ 检测到美团已登录状态
   🚀 开始抓取订单数据...
   ```

---

### 方式 2：抓取时弹出浏览器登录

如果您没有提前登录，系统会：

1. **自动弹出浏览器**
2. **显示登录页面**
3. **等待您手动登录**（最长 5 分钟）
4. **检测到登录后自动继续**

```
日志输出：
美团未登录，等待手动登录 [accountId=meituan-default]
💡 提示：请先在浏览器中登录 https://ecom.meituan.com/
💡 登录后系统会自动检测到并继续抓取

[您在弹出的浏览器中完成登录]

✅ 检测到美团已登录状态
🚀 开始抓取...
```

---

## 🔍 登录检测机制（4 层检测）

系统使用**智能多重检测**，确保准确识别登录状态：

### 检测 1：Cookie 检测（最可靠）
```typescript
检查包含以下关键词的 Cookie：
- token
- session  
- login
- auth
- userid
```

### 检测 2：LocalStorage 检测
```typescript
检查浏览器本地存储中是否包含：
- token 相关键
- session 相关键
- user 相关键
```

### 检测 3：页面元素检测
```typescript
检查页面是否有用户信息元素：
- .user-info
- .merchant-name
- .account-info
- [class*="user"]
- [class*="merchant"]
```

### 检测 4：URL 检测
```typescript
如果当前 URL：
✅ 包含 ecom.meituan.com
❌ 不包含 login 或 passport
→ 判定为已登录
```

---

## 📋 测试步骤

### 快速测试（3 步）

```bash
# Step 1: 在浏览器中登录
# 访问 https://ecom.meituan.com/ 并登录

# Step 2: 运行测试脚本
./test-meituan-login.sh

# Step 3: 查看结果
# 如果显示 "✅ 成功！系统检测到您已登录"
# 说明登录检测正常工作！
```

### 详细测试

```bash
# 1. 检查服务状态
curl http://localhost:5510/api/health

# 2. 检查登录状态
curl -X POST "http://localhost:5510/api/meituan/orders?limit=1" \
  -H "Content-Type: application/json" \
  -d '{}'

# 3. 查看日志
docker logs supercrawler | grep -i "meituan\|login"
```

---

## ⚠️ 常见问题

### Q1: 为什么检测不到我的登录状态？

**可能原因**：
1. **浏览器不同**：您在 Chrome 登录，但抓取使用 Playwright 内置浏览器
2. **Cookie 未共享**：两个浏览器的 Cookie 不共享
3. **登录过期**：Cookie 已过期

**解决方案**：
- 使用方式 2（抓取时弹出浏览器登录）
- 或在同一个浏览器 Profile 中保持登录

---

### Q2: 每次都要重新登录吗？

**不需要！** 登录态会持久化：

```
登录一次 → Cookie 保存到 data/profiles/meituan/ 
→ 下次自动登录（除非删除该目录）
```

---

### Q3: 如何查看登录状态？

```bash
# 方式 1：通过 API
curl "http://localhost:5510/api/auth/status?accountId=meituan-default&platform=meituan"

# 方式 2：查看日志
docker logs supercrawler | grep "检测到美团已登录"

# 方式 3：运行测试脚本
./test-meituan-login.sh
```

---

## 🚀 下一步

登录检测成功后，您需要提供**截图**来帮助我完善抓取代码：

### 需要 4 张截图：

1. **登录页面截图**
   - 显示登录方式（账号密码输入框）

2. **经营宝首页截图**
   - 显示完整导航菜单
   - 包含：订单、商品、推广等菜单项

3. **订单页面截图**
   - 点击"订单"后的页面
   - 显示浏览器 URL

4. **推广页面截图**
   - 点击"推广中心"或"推广数据"后的页面
   - 显示浏览器 URL

**有了这些截图，我可以在 10 分钟内完成抓取代码的适配！**

---

## 💡 提示

- 登录检测已优化，支持 4 种检测方式
- 登录态持久化，无需重复登录
- 如果检测失败，系统会等待您手动登录（5 分钟超时）
- 所有检测过程都有详细日志输出

---

**现在请您先在浏览器中登录美团经营宝，然后运行测试脚本验证！** 🎯
