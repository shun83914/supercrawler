import { z } from 'zod';
import type { INestApplicationContext } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { DouyinService } from '../douyin/douyin.service';
import { JsonlReaderService } from '../storage/jsonl-reader.service';
import { XhsService } from '../xhs/xhs.service';
import { AppService } from '../app.service';
import { normalizeError } from '../common/errors/business.exception';

// ========== MCP SDK 动态加载（ESM-only） ==========
type McpServerCtor = new (info: { name: string; version: string }) => {
  registerTool(
    name: string,
    cfg: {
      title?: string;
      description?: string;
      inputSchema?: Record<string, z.ZodTypeAny>;
    },
    cb: (args: unknown) => Promise<unknown>,
  ): unknown;
  connect(transport: unknown): Promise<void>;
  close(): Promise<void>;
};

interface McpModules {
  McpServer: McpServerCtor;
  StdioServerTransport: new () => unknown;
}

export async function loadMcp(): Promise<McpModules> {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const server = (await new Function(
    'return import("@modelcontextprotocol/sdk/server/mcp.js")',
  )()) as {
    McpServer: McpServerCtor;
  };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const stdio = (await new Function(
    'return import("@modelcontextprotocol/sdk/server/stdio.js")',
  )()) as {
    StdioServerTransport: new () => unknown;
  };
  return {
    McpServer: server.McpServer,
    StdioServerTransport: stdio.StdioServerTransport,
  };
}

// ========== Tool schemas ==========
const accountId = z
  .string()
  .regex(/^[\w.-]{1,64}$/)
  .optional();
const respOpts = {
  includeRecords: z.boolean().optional(),
  includeRaw: z.boolean().optional(),
  maxRecords: z.number().int().min(1).max(2000).optional(),
  useCache: z.boolean().optional(),
};

/**
 * 把抓取/认证/存储等服务映射为 MCP tools。返回的 unknown 都会被 SDK 包成 textContent。
 */
export function registerSkillTools(
  server: InstanceType<McpServerCtor>,
  ctx: INestApplicationContext,
): void {
  const xhs = ctx.get(XhsService);
  const douyin = ctx.get(DouyinService);
  const auth = ctx.get(AuthService);
  const reader = ctx.get(JsonlReaderService);
  const appSvc = ctx.get(AppService);

  const wrap = (data: unknown) => ({
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  });
  const wrapErr = (err: unknown) => {
    const biz = normalizeError(err);
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            { code: biz.code, message: biz.message, details: biz.details },
            null,
            2,
          ),
        },
      ],
    };
  };
  const safe = <T>(fn: () => Promise<T>) => fn().then(wrap).catch(wrapErr);

  server.registerTool(
    'xhs_scrape_notes',
    {
      description:
        '抓取指定 noteId 列表的笔记详情；agent 应基于 preview 决定是否拉 records',
      inputSchema: {
        noteIds: z.array(z.string()).min(1).max(50),
        accountId,
        ...respOpts,
      },
    },
    (args: unknown) =>
      safe(() =>
        xhs.scrapeNotes(args as Parameters<XhsService['scrapeNotes']>[0]),
      ),
  );

  server.registerTool(
    'xhs_scrape_user',
    {
      description: '抓取指定 userId 的主页信息及最近笔记列表',
      inputSchema: {
        userId: z.string().regex(/^[A-Za-z0-9]{16,32}$/),
        noteLimit: z.number().int().min(1).max(500).optional(),
        accountId,
        ...respOpts,
      },
    },
    (args: unknown) =>
      safe(() =>
        xhs.scrapeUser(args as Parameters<XhsService['scrapeUser']>[0]),
      ),
  );

  server.registerTool(
    'xhs_scrape_search',
    {
      description:
        '按关键词列表抓取小红书搜索结果。sort=general|latest|popular；可选后置过滤：' +
        'minLikes 过滤点赞下限；noteType 限定 normal/video。' +
        'publishedAfter/Before(ISO8601) 为实验性参数：需进详情页拼发布时间，' +
        '当前实测下详情页受风控重定向可能拿不到时间，必填场景请谨慎使用。' +
        '带过滤时服务会多抓三倍原始记录后置过滤以补足数量。',
      inputSchema: {
        keywords: z.array(z.string()).min(1).max(30),
        sort: z.enum(['general', 'latest', 'popular']).optional(),
        limit: z.number().int().min(1).max(200).optional(),
        publishedAfter: z.string().datetime().optional(),
        publishedBefore: z.string().datetime().optional(),
        minLikes: z.number().int().min(0).optional(),
        noteType: z.enum(['normal', 'video']).optional(),
        accountId,
        ...respOpts,
      },
    },
    (args: unknown) =>
      safe(() =>
        xhs.scrapeSearch(args as Parameters<XhsService['scrapeSearch']>[0]),
      ),
  );

  server.registerTool(
    'xhs_scrape_comments',
    {
      description: '抓取指定笔记的评论（含子评论）',
      inputSchema: {
        noteId: z.string(),
        limit: z.number().int().min(1).max(2000).optional(),
        accountId,
        ...respOpts,
      },
    },
    (args: unknown) =>
      safe(() =>
        xhs.scrapeComments(args as Parameters<XhsService['scrapeComments']>[0]),
      ),
  );

  server.registerTool(
    'xhs_batch',
    {
      description: '混合批量抓取：tasks=[{type, id, ...}]',
      inputSchema: {
        tasks: z
          .array(
            z.object({
              type: z.enum(['note', 'user', 'search', 'comments']),
              id: z.string(),
              limit: z.number().int().optional(),
              noteLimit: z.number().int().optional(),
              sort: z.enum(['general', 'latest', 'popular']).optional(),
            }),
          )
          .min(1)
          .max(50),
        accountId,
      },
    },
    (args: unknown) =>
      safe(() => xhs.runBatch(args as Parameters<XhsService['runBatch']>[0])),
  );

  server.registerTool(
    'auth_login',
    {
      description:
        '触发 headful 浏览器扫码登录（需服务部署在能弹窗的环境）；platform 默认 xhs，可选 douyin',
      inputSchema: {
        accountId: z.string().optional(),
        platform: z.enum(['xhs', 'douyin']).optional(),
        proxy: z.string().optional(),
      },
    },
    (args: unknown) => {
      const {
        accountId: id = 'default',
        proxy,
        platform = 'xhs',
      } = args as {
        accountId?: string;
        proxy?: string;
        platform?: 'xhs' | 'douyin';
      };
      return safe(() => auth.loginInteractive(id, proxy, platform));
    },
  );

  server.registerTool(
    'auth_status',
    {
      description:
        '无头探测某 accountId 在指定平台的登录态；platform 默认 xhs，可选 douyin',
      inputSchema: {
        accountId: z.string().optional(),
        platform: z.enum(['xhs', 'douyin']).optional(),
      },
    },
    (args: unknown) => {
      const { accountId: id = 'default', platform = 'xhs' } = args as {
        accountId?: string;
        platform?: 'xhs' | 'douyin';
      };
      return safe(() => auth.checkStatus(id, platform));
    },
  );

  server.registerTool(
    'storage_peek',
    {
      description: '分页读取 JSONL 抓取结果文件（仅允许 OUTPUT_DIR 内）',
      inputSchema: {
        file: z.string(),
        offset: z.number().int().min(0).optional(),
        limit: z.number().int().min(1).max(500).optional(),
      },
    },
    (args: unknown) => {
      const {
        file,
        offset = 0,
        limit = 50,
      } = args as { file: string; offset?: number; limit?: number };
      return safe(() => reader.peek(file, offset, limit));
    },
  );

  server.registerTool(
    'health',
    {
      description: '查看服务/账号/并发/缓存状态',
      inputSchema: {},
    },
    () => safe(() => appSvc.health()),
  );

  // ===== Douyin tools =====
  server.registerTool(
    'douyin_scrape_awemes',
    {
      description:
        '抓取指定 awemeId 列表的抖音作品详情；agent 应基于 preview 决定是否拉 records',
      inputSchema: {
        awemeIds: z
          .array(z.string().regex(/^\d{15,25}$/))
          .min(1)
          .max(50),
        accountId,
        ...respOpts,
      },
    },
    (args: unknown) =>
      safe(() =>
        douyin.scrapeAwemes(
          args as Parameters<DouyinService['scrapeAwemes']>[0],
        ),
      ),
  );

  server.registerTool(
    'douyin_scrape_user',
    {
      description: '抓取指定 secUserId 的抖音用户主页及最近作品列表',
      inputSchema: {
        secUserId: z.string().regex(/^[A-Za-z0-9_-]{20,80}$/),
        limit: z.number().int().min(1).max(500).optional(),
        accountId,
        ...respOpts,
      },
    },
    (args: unknown) =>
      safe(() =>
        douyin.scrapeUser(args as Parameters<DouyinService['scrapeUser']>[0]),
      ),
  );

  server.registerTool(
    'douyin_scrape_search',
    {
      description:
        '按关键词列表抓取抖音视频搜索结果。sort=general|latest|popular',
      inputSchema: {
        keywords: z.array(z.string()).min(1).max(30),
        sort: z.enum(['general', 'latest', 'popular']).optional(),
        limit: z.number().int().min(1).max(200).optional(),
        accountId,
        ...respOpts,
      },
    },
    (args: unknown) =>
      safe(() =>
        douyin.scrapeSearch(
          args as Parameters<DouyinService['scrapeSearch']>[0],
        ),
      ),
  );

  server.registerTool(
    'douyin_scrape_comments',
    {
      description: '抓取指定作品的评论（XHR 拦截 + 评论区滚动分页）',
      inputSchema: {
        awemeId: z.string().regex(/^\d{15,25}$/),
        limit: z.number().int().min(1).max(2000).optional(),
        accountId,
        ...respOpts,
      },
    },
    (args: unknown) =>
      safe(() =>
        douyin.scrapeComments(
          args as Parameters<DouyinService['scrapeComments']>[0],
        ),
      ),
  );

  server.registerTool(
    'douyin_batch',
    {
      description:
        '抖音混合批量抓取：tasks=[{type:aweme|user|search|comments, id, ...}]',
      inputSchema: {
        tasks: z
          .array(
            z.object({
              type: z.enum(['aweme', 'user', 'search', 'comments']),
              id: z.string(),
              limit: z.number().int().optional(),
              sort: z.enum(['general', 'latest', 'popular']).optional(),
            }),
          )
          .min(1)
          .max(50),
        accountId,
      },
    },
    (args: unknown) =>
      safe(() =>
        douyin.runBatch(args as Parameters<DouyinService['runBatch']>[0]),
      ),
  );
}
