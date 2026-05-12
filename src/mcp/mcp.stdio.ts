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

async function main(): Promise<void> {
  const logger = new Logger('McpStdio');
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
