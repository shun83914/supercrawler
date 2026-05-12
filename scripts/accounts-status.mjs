#!/usr/bin/env node
/**
 * 账号健康度导出 —— 离线扫描 PROFILE_DIR 并对每个 accountId 调 auth_status，
 * 打印表格 + JSON 双视图，方便团队值班 / CI 巡检使用。
 *
 * 依赖：
 *   - supercrawler HTTP 服务已启动（默认 http://localhost:5510）
 *   - SUPERCRAWLER_TOKEN 环境变量（若服务启用鉴权）
 *
 * 端口优先级：--base 显式 > $PORT 环境变量 > .env PORT > 5510
 *
 * 用法：
 *   npm run accounts:status                    # 表格输出
 *   npm run accounts:status -- --json          # JSON 输出（CI 友好）
 *   npm run accounts:status -- --base=http://host:5510
 *
 * 退出码：
 *   0  全部账号 loggedIn=true
 *   1  部分账号失效（>=1 个 loggedIn=false）
 *   2  服务不可达 / 无账号
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ---- 从 .env 解析 PORT（只取 PORT 行，不执行文件） ----
function readEnvPort() {
  const envPath = resolve(ROOT, '.env');
  if (!existsSync(envPath)) return null;
  const m = readFileSync(envPath, 'utf8').match(/^PORT\s*=\s*(\d+)/m);
  return m ? Number(m[1]) : null;
}
const DEFAULT_PORT = Number(process.env.PORT) || readEnvPort() || 5510;
const DEFAULT_BASE = `http://localhost:${DEFAULT_PORT}`;

// ---- CLI ----
const argv = process.argv.slice(2);
const AS_JSON = argv.includes('--json');
const BASE = (argv.find((a) => a.startsWith('--base=')) ?? `--base=${DEFAULT_BASE}`).slice(7);
const TOKEN = process.env.SUPERCRAWLER_TOKEN ?? '';
const PROFILE_DIR = process.env.PROFILE_DIR ?? resolve(ROOT, 'data/profiles');
const TIMEOUT_MS = 8000;
const ACCOUNT_NAME_RE = /^[\w.-]{1,64}$/;

// ---- helpers ----
function discover() {
  try {
    return readdirSync(PROFILE_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory() && ACCOUNT_NAME_RE.test(e.name))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

async function probe(accountId) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const url = `${BASE}/api/auth/status?accountId=${encodeURIComponent(accountId)}`;
    const r = await fetch(url, {
      method: 'GET',
      headers: TOKEN ? { 'X-API-Key': TOKEN } : {},
      signal: ac.signal,
    });
    const body = await r.json();
    return {
      accountId,
      reachable: true,
      loggedIn: body?.data?.loggedIn === true,
      cookies: body?.data?.cookies?.length ?? 0,
      code: body?.code ?? 'OK',
      message: body?.message,
    };
  } catch (err) {
    return {
      accountId,
      reachable: false,
      loggedIn: false,
      cookies: 0,
      code: 'UNREACHABLE',
      message: err?.message ?? String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function probeHealth() {
  try {
    const r = await fetch(`${BASE}/api/health`, {
      headers: TOKEN ? { 'X-API-Key': TOKEN } : {},
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

function pad(s, w) {
  s = String(s ?? '');
  return s + ' '.repeat(Math.max(0, w - [...s].length));
}

// ---- main ----
const health = await probeHealth();
const accounts = discover();

if (!health) {
  const payload = {
    ok: false,
    error: `supercrawler HTTP 不可达: ${BASE}/api/health`,
    hint: '先启动 npm run start:dev 或 docker compose up -d',
  };
  console[AS_JSON ? 'log' : 'error'](AS_JSON ? JSON.stringify(payload, null, 2) : `❌ ${payload.error}\n   ${payload.hint}`);
  process.exit(2);
}

if (accounts.length === 0) {
  const payload = {
    ok: false,
    error: `PROFILE_DIR(${PROFILE_DIR}) 下无账号`,
    hint: '先执行 auth_login 扫码登录至少一个账号',
  };
  console[AS_JSON ? 'log' : 'error'](AS_JSON ? JSON.stringify(payload, null, 2) : `❌ ${payload.error}\n   ${payload.hint}`);
  process.exit(2);
}

const rows = await Promise.all(accounts.map(probe));
const okCount = rows.filter((r) => r.loggedIn).length;
const failCount = rows.length - okCount;

if (AS_JSON) {
  console.log(JSON.stringify(
    {
      ok: failCount === 0,
      base: BASE,
      profileDir: PROFILE_DIR,
      total: rows.length,
      healthy: okCount,
      unhealthy: failCount,
      accounts: rows,
      serviceHealth: health?.data ?? health,
    },
    null,
    2,
  ));
} else {
  console.log('\n======= supercrawler accounts health =======');
  console.log(`base        : ${BASE}`);
  console.log(`profileDir  : ${PROFILE_DIR}`);
  console.log(`accounts    : ${rows.length} (healthy=${okCount}, unhealthy=${failCount})`);
  console.log('');
  console.log(`${pad('accountId', 24)} ${pad('loggedIn', 10)} ${pad('cookies', 8)} ${pad('code', 18)} message`);
  console.log('-'.repeat(90));
  for (const r of rows) {
    const mark = r.loggedIn ? '✅' : r.reachable ? '⚠️ ' : '❌';
    console.log(
      `${mark} ${pad(r.accountId, 22)} ${pad(String(r.loggedIn), 10)} ${pad(r.cookies, 8)} ${pad(r.code, 18)} ${
        r.message ?? ''
      }`.trimEnd(),
    );
  }
  console.log('');
  if (failCount > 0) {
    console.log(`⚠️  ${failCount} 个账号需要重新扫码：`);
    for (const r of rows.filter((x) => !x.loggedIn)) {
      console.log(`   curl -X POST ${BASE}/api/auth/login -H "X-API-Key: \\$SUPERCRAWLER_TOKEN" -H "Content-Type: application/json" -d '{"accountId":"${r.accountId}"}'`);
    }
    console.log('');
  }
}

process.exit(failCount === 0 ? 0 : 1);
