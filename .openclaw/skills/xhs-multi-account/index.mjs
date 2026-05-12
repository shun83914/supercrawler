/**
 * xhs-multi-account skill 钩子：维护账号池 + 轮询调度 + 风控冷却。
 *
 * 核心能力：
 *   1. 启动时从 PROFILE_DIR 自动发现 accountId（每个子目录一个账号）
 *   2. onBeforeInvoke: 为 xhs_scrape_* 调用自动注入 accountId（LRU + 冷却过滤）
 *   3. onAfterInvoke:  解析响应码，RATE_LIMITED/XHS_BLOCKED 打入冷却
 *   4. 全部冷却时拦截调用并返回 ALL_ACCOUNTS_COOLING 错误（agent 可识别）
 *
 * OpenClaw skill 钩子契约：
 *   - onBeforeInvoke({toolName, args}) → 可修改 args 或抛错拦截
 *   - onAfterInvoke({toolName, args, result}) → 只读观测
 */

import { readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

// ---------- 配置 ----------
const PROFILE_DIR = process.env.SUPERCRAWLER_PROFILE_DIR
  ?? resolve(process.cwd(), 'data/profiles');
const COOL_DOWN_MS = Number(process.env.XHS_COOL_DOWN_MS ?? 600_000); // 默认 10min
const ACCOUNT_NAME_RE = /^[\w.-]{1,64}$/;

// 需要被注入 accountId 的工具（auth_* 不要动——扫码登录必须显式指定）
const TARGET_TOOLS = new Set([
  'supercrawler:xhs_scrape_notes',
  'supercrawler:xhs_scrape_user',
  'supercrawler:xhs_scrape_search',
  'supercrawler:xhs_scrape_comments',
  'supercrawler:xhs_batch',
]);

// ---------- 账号池（进程级内存状态） ----------
/** @type {Map<string, { lastUsedAt: number; cooldownUntil: number; failCount: number }>} */
const pool = new Map();

function discoverAccounts() {
  try {
    const entries = readdirSync(PROFILE_DIR, { withFileTypes: true });
    const found = entries
      .filter((e) => e.isDirectory() && ACCOUNT_NAME_RE.test(e.name))
      .map((e) => e.name);
    for (const id of found) {
      if (!pool.has(id)) {
        pool.set(id, { lastUsedAt: 0, cooldownUntil: 0, failCount: 0 });
      }
    }
    // 清理已被删除的 profile
    for (const id of [...pool.keys()]) {
      if (!found.includes(id)) pool.delete(id);
    }
    return found;
  } catch {
    return [];
  }
}

/** 从池中挑一个：非冷却 + 最久未使用 */
function pickAccount(now = Date.now()) {
  discoverAccounts();
  const candidates = [...pool.entries()]
    .filter(([, s]) => s.cooldownUntil <= now)
    .sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt);
  return candidates[0]?.[0];
}

function snapshot(now = Date.now()) {
  return [...pool.entries()].map(([id, s]) => ({
    id,
    cooling: s.cooldownUntil > now,
    coolingRemainSec: Math.max(0, Math.round((s.cooldownUntil - now) / 1000)),
    lastUsedAgoSec: s.lastUsedAt ? Math.round((now - s.lastUsedAt) / 1000) : -1,
    failCount: s.failCount,
  }));
}

// ---------- 钩子 ----------

export async function onBeforeInvoke({ toolName, args }) {
  if (!TARGET_TOOLS.has(toolName)) return;

  // 用户/agent 显式指定 accountId → 尊重，不覆盖
  if (args && typeof args.accountId === 'string' && args.accountId) {
    const s = pool.get(args.accountId);
    if (s) s.lastUsedAt = Date.now();
    return;
  }

  const chosen = pickAccount();
  if (!chosen) {
    const all = snapshot();
    const hasAny = all.length > 0;
    // 抛错让 OpenClaw 把 isError=true 的响应返给 agent，agent 按 SKILL.md 约定识别
    const payload = hasAny
      ? {
          code: 'ALL_ACCOUNTS_COOLING',
          message: '所有账号处于冷却窗口，建议 5-10 分钟后重试',
          details: { pool: all },
        }
      : {
          code: 'NO_ACCOUNT_AVAILABLE',
          message: `PROFILE_DIR(${PROFILE_DIR}) 下未发现任何账号 profile，请先 auth_login`,
        };
    const err = new Error(payload.message);
    // OpenClaw 钩子抛错时 err.toolResult 会被作为 tool_result 返回
    err.toolResult = {
      isError: true,
      content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    };
    throw err;
  }

  // 注入选中的 accountId
  args.accountId = chosen;
  const s = pool.get(chosen);
  s.lastUsedAt = Date.now();
  console.error(
    `[xhs-multi-account] → ${toolName} using accountId=${chosen} (pool: ${
      snapshot().map((x) => `${x.id}${x.cooling ? '(cool)' : ''}`).join(', ')
    })`,
  );
}

export async function onAfterInvoke({ toolName, args, result }) {
  if (!TARGET_TOOLS.has(toolName)) return;

  const accountId = args?.accountId;
  if (!accountId) return;
  const s = pool.get(accountId);
  if (!s) return;

  // 从 tool_result 文本里解析 code（supercrawler 统一响应壳）
  const txt = result?.content?.[0]?.text ?? '';
  let code;
  try {
    const obj = JSON.parse(txt);
    code = obj?.code ?? obj?.error?.code;
  } catch {
    // 非 JSON（如正常 preview 摘要），无 code 就当成功
    code = undefined;
  }

  if (result?.isError || /RATE_LIMITED|XHS_BLOCKED/.test(String(code ?? ''))) {
    // 风控 → 打冷却
    if (/RATE_LIMITED|XHS_BLOCKED/.test(String(code ?? '')) || /RATE_LIMITED|XHS_BLOCKED/.test(txt)) {
      s.cooldownUntil = Date.now() + COOL_DOWN_MS;
      s.failCount += 1;
      console.error(
        `[xhs-multi-account] 🚨 accountId=${accountId} 触发风控(${code})，冷却 ${COOL_DOWN_MS / 60000}min`,
      );
    }
    // 登录失效 → 短暂冷却 60s（方便 agent 重试时跳过该账号）
    else if (/LOGIN_REQUIRED|LOGIN_TIMEOUT/.test(String(code ?? '')) || /LOGIN_REQUIRED/.test(txt)) {
      s.cooldownUntil = Date.now() + 60_000;
      s.failCount += 1;
      console.error(`[xhs-multi-account] 🔐 accountId=${accountId} 登录失效，短期跳过 60s`);
    }
  } else {
    // 成功一次，清零连续失败计数
    s.failCount = 0;
  }
}

// ---------- 启动日志（skill 加载时执行一次） ----------
const initial = discoverAccounts();
if (initial.length > 0) {
  console.error(
    `[xhs-multi-account] 发现 ${initial.length} 个账号: ${initial.join(', ')} (冷却=${COOL_DOWN_MS / 60000}min)`,
  );
} else {
  console.error(
    `[xhs-multi-account] ⚠️  PROFILE_DIR(${PROFILE_DIR}) 未发现账号；首次使用请先 auth_login`,
  );
}
