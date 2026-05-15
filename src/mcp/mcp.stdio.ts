/**
 * MCP stdio entry — 启动一个仅供 agent 通过 stdio 调用的 MCP server。
 *
 * 用法：
 *   npm run mcp           # 启动 stdio MCP server（前台）
 *
 * agent 侧可以这样配置（以 Claude Desktop 为例）：
 *   {
 *     "mcpServers": {
 *       "supercrawler": {
 *         "command": "node",
 *         "args": ["dist/mcp/mcp.stdio.js"],
 *         "cwd": "/path/to/supercrawler"
 *       }
 *     }
 *   }
 */
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { loadMcp, registerSkillTools } from './mcp.bridge';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * 清理残留的浏览器锁文件（防止异常退出后无法启动）
 */
function cleanupBrowserLocks(): void {
  const profileBase = path.resolve(process.cwd(), 'data', 'profiles');
  
  if (!fs.existsSync(profileBase)) {
    return; // profile 目录不存在，无需清理
  }
  
  try {
    const accounts = fs.readdirSync(profileBase);
    let cleaned = 0;
    
    for (const account of accounts) {
      const lockFile = path.join(profileBase, account, 'SingletonLock');
      const lockSocket = path.join(profileBase, account, 'SingletonSocket');
      
      if (fs.existsSync(lockFile)) {
        fs.unlinkSync(lockFile);
        cleaned++;
      }
      
      if (fs.existsSync(lockSocket)) {
        fs.unlinkSync(lockSocket);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      console.error(`[McpStdio] cleaned ${cleaned} stale browser lock files`);
    }
  } catch (err) {
    // 忽略清理错误，不影响主流程
    console.error(`[McpStdio] lock cleanup warning: ${(err as Error).message}`);
  }
}

async function main(): Promise<void> {
  const logger = new Logger('McpStdio');
  
  // 启动前清理残留的浏览器锁文件
  cleanupBrowserLocks();
  
  // standalone context = 不开 HTTP，仅复用 IoC
  const ctx = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'], // stdio 协议要求 stdout 干净，禁用 info 级别打印
  });
  ctx.enableShutdownHooks();

  const { McpServer, StdioServerTransport } = await loadMcp();
  const server = new McpServer({ name: 'supercrawler', version: '0.1.0' });
  registerSkillTools(server, ctx);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // stderr 才能写日志，stdout 留给 MCP 协议
  logger.warn('mcp stdio server ready, waiting for client...');

  const shutdown = async () => {
    try {
      await server.close();
    } finally {
      await ctx.close();
      process.exit(0);
    }
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

void main().catch((err) => {
  console.error('mcp stdio failed:', err);
  process.exit(1);
});
