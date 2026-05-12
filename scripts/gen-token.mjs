#!/usr/bin/env node
/**
 * 生成 SUPERCRAWLER_TOKEN（API_TOKEN）
 *
 * 功能：
 *   1. 用 crypto.randomBytes 生成 32 字节（64 hex）高强度随机 token
 *   2. 自动写入/更新项目根的 .env 文件中的 API_TOKEN
 *   3. 输出 agent 端 export 命令（复制粘贴即可）
 *   4. 支持 --print-only 仅打印不落盘；--force 覆盖已有 token
 *
 * 用法：
 *   node scripts/gen-token.mjs              # 生成并写入 .env（已存在则询问）
 *   node scripts/gen-token.mjs --force      # 强制覆盖已有 API_TOKEN
 *   node scripts/gen-token.mjs --print-only # 仅输出到终端，不改 .env
 */

import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const ENV_PATH = resolve(ROOT, '.env');

const args = new Set(process.argv.slice(2));
const PRINT_ONLY = args.has('--print-only');
const FORCE = args.has('--force');

// ---- 1. 生成 token ----
const token = randomBytes(32).toString('hex');

// ---- 2. 写入 .env（除非 --print-only） ----
let action = 'skipped';
if (!PRINT_ONLY) {
  let content = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8') : '';
  const line = `API_TOKEN=${token}`;
  const hasToken = /^API_TOKEN=.*/m.test(content);
  const nonEmpty = /^API_TOKEN=.+/m.test(content);

  if (hasToken && nonEmpty && !FORCE) {
    console.error(`[gen-token] .env 中已存在非空 API_TOKEN，跳过写入。`);
    console.error(`            如需覆盖：node scripts/gen-token.mjs --force`);
    action = 'kept-existing';
  } else if (hasToken) {
    content = content.replace(/^API_TOKEN=.*/m, line);
    writeFileSync(ENV_PATH, content, 'utf8');
    action = 'replaced';
  } else {
    if (content.length > 0 && !content.endsWith('\n')) content += '\n';
    content += `${line}\n`;
    writeFileSync(ENV_PATH, content, 'utf8');
    action = 'appended';
  }
}

// ---- 3. 输出 ----
console.log('\n======== SuperCrawler Token ========');
console.log(`token  : ${token}`);
console.log(`length : ${token.length} chars (32 bytes)`);
console.log(`action : ${action}${PRINT_ONLY ? ' (--print-only)' : ''}`);
console.log('====================================\n');

console.log('【服务端】.env 已同步（或自行检查 API_TOKEN 字段）');
console.log('【agent 端】复制以下命令写入 shell rc：\n');
console.log(`  export SUPERCRAWLER_TOKEN=${token}\n`);
console.log('【快速验证】');
console.log(`  curl -sS http://localhost:${process.env.PORT || '5510'}/api/health -H "X-API-Key: ${token}" | head\n`);
