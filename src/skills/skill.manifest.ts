/**
 * Skill Manifest — agent 可以通过 GET /api/skills/manifest 拉取本服务全部能力清单。
 * 字段语义对齐 OpenAI / MCP tool schema：name / description / input / output。
 * 所有 input schema 用 JSON Schema 描述，避免依赖具体框架。
 */
export interface SkillDef {
  name: string;
  description: string;
  /** REST 端点：method + path。 */
  http: { method: 'POST' | 'GET'; path: string };
  /** input JSON Schema（draft-07 子集）。 */
  inputSchema: Record<string, unknown>;
  /** 返回数据语义（精简描述）。 */
  outputHint: string;
  /** 调用前的前置条件（agent 决策提示）。 */
  preconditions?: string[];
  /** 是否登录态相关。 */
  requiresLogin?: boolean;
}

const ACCOUNT_FIELD = {
  accountId: {
    type: 'string',
    description: '账号 profile id，复用持久化登录态。默认 default',
  },
};

const RESPONSE_OPTIONS_FIELDS = {
  includeRecords: {
    type: 'boolean',
    default: false,
    description: '是否在响应中返回明细记录',
  },
  includeRaw: {
    type: 'boolean',
    default: false,
    description: '若返回明细，是否包含 raw 原始字段',
  },
  maxRecords: { type: 'integer', minimum: 1, maximum: 2000, default: 50 },
  useCache: { type: 'boolean', default: true, description: 'TTL 内幂等命中' },
};

export const SKILL_MANIFEST: SkillDef[] = [
  {
    name: 'xhs.scrapeNotes',
    description: '按 noteId 列表抓取小红书笔记详情，结果以 JSONL 文件落盘',
    http: { method: 'POST', path: '/api/xhs/notes' },
    inputSchema: {
      type: 'object',
      required: ['noteIds'],
      properties: {
        noteIds: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          maxItems: 50,
        },
        ...ACCOUNT_FIELD,
        ...RESPONSE_OPTIONS_FIELDS,
      },
    },
    outputHint:
      'ScrapeSummary { target: "note", file, count, preview, [records] }',
    preconditions: ['accountId 对应 profile 已扫码登录'],
    requiresLogin: true,
  },
  {
    name: 'xhs.scrapeUser',
    description: '抓取指定用户主页信息及最近笔记列表',
    http: { method: 'POST', path: '/api/xhs/users' },
    inputSchema: {
      type: 'object',
      required: ['userId'],
      properties: {
        userId: { type: 'string', pattern: '^[A-Za-z0-9]{16,32}$' },
        noteLimit: { type: 'integer', minimum: 1, maximum: 500 },
        ...ACCOUNT_FIELD,
        ...RESPONSE_OPTIONS_FIELDS,
      },
    },
    outputHint:
      'ScrapeSummary { target: "user", file, count, preview, [records] }',
    requiresLogin: true,
  },
  {
    name: 'xhs.scrapeSearch',
    description:
      '按关键词列表抓取搜索结果（笔记摘要），支持综合/最新/热门排序。' +
      'minLikes 过滤点赞下限、noteType 区分图文/视频。' +
      'publishedAfter/publishedBefore (ISO8601) 为实验性：需逐条进详情页拼发布时间，' +
      '实测下详情页可能被小红书风控重定向而拿不到发布时间，应作为软限制。',
    http: { method: 'POST', path: '/api/xhs/search' },
    inputSchema: {
      type: 'object',
      required: ['keywords'],
      properties: {
        keywords: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          maxItems: 30,
        },
        sort: { type: 'string', enum: ['general', 'latest', 'popular'] },
        limit: { type: 'integer', minimum: 1, maximum: 200, default: 30 },
        publishedAfter: {
          type: 'string',
          format: 'date-time',
          description:
            '实验性。ISO8601；仅保留 publishTime 在该时点之后的记录。详情页受风控可能拿不到时间，未拿到时记录会被过滤。',
        },
        publishedBefore: {
          type: 'string',
          format: 'date-time',
          description:
            '实验性。ISO8601；仅保留 publishTime 在该时点之前的记录。',
        },
        minLikes: {
          type: 'integer',
          minimum: 0,
          description: '点赞数下限，记录未返回数值点赞时被过滤',
        },
        noteType: { type: 'string', enum: ['normal', 'video'] },
        ...ACCOUNT_FIELD,
        ...RESPONSE_OPTIONS_FIELDS,
      },
    },
    outputHint:
      'ScrapeSummary { target: "search", file, count, preview, [records: { noteId, title, cover, likedText, likedCount, noteType, publishTime, author, ... }] }',
    requiresLogin: true,
  },
  {
    name: 'xhs.scrapeComments',
    description: '抓取指定笔记下的评论（含子评论），通过 XHR 监听 + 滚动分页',
    http: { method: 'POST', path: '/api/xhs/comments' },
    inputSchema: {
      type: 'object',
      required: ['noteId'],
      properties: {
        noteId: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 2000 },
        ...ACCOUNT_FIELD,
        ...RESPONSE_OPTIONS_FIELDS,
      },
    },
    outputHint:
      'ScrapeSummary { target: "comments", file, count, preview, [records] }',
    requiresLogin: true,
  },
  {
    name: 'xhs.batch',
    description: '混合批量抓取：tasks 数组按顺序执行，每项包含 type 与 id',
    http: { method: 'POST', path: '/api/xhs/batch' },
    inputSchema: {
      type: 'object',
      required: ['tasks'],
      properties: {
        tasks: {
          type: 'array',
          minItems: 1,
          maxItems: 50,
          items: {
            type: 'object',
            required: ['type', 'id'],
            properties: {
              type: {
                type: 'string',
                enum: ['note', 'user', 'search', 'comments'],
              },
              id: { type: 'string' },
              limit: { type: 'integer' },
              noteLimit: { type: 'integer' },
              sort: { type: 'string', enum: ['general', 'latest', 'popular'] },
            },
          },
        },
        ...ACCOUNT_FIELD,
      },
    },
    outputHint: 'BatchSummary { total, succeeded, failed, results[] }',
    requiresLogin: true,
  },
  {
    name: 'douyin.scrapeAwemes',
    description:
      '按 awemeId 列表抓取抖音作品详情（XHR 拦截 + SSR 兑底 + 分享页回退），结果以 JSONL 落盘',
    http: { method: 'POST', path: '/api/douyin/awemes' },
    inputSchema: {
      type: 'object',
      required: ['awemeIds'],
      properties: {
        awemeIds: {
          type: 'array',
          items: { type: 'string', pattern: '^\\d{15,25}$' },
          minItems: 1,
          maxItems: 50,
        },
        ...ACCOUNT_FIELD,
        ...RESPONSE_OPTIONS_FIELDS,
      },
    },
    outputHint:
      'DouyinScrapeSummary { target: "aweme", file, count, preview, [records] }',
    preconditions: ['accountId 对应 profile 已扫码登录抖音'],
    requiresLogin: true,
  },
  {
    name: 'douyin.scrapeUser',
    description: '抓取指定抖音用户主页（sec_uid）及其最近作品列表',
    http: { method: 'POST', path: '/api/douyin/users' },
    inputSchema: {
      type: 'object',
      required: ['secUserId'],
      properties: {
        secUserId: { type: 'string', pattern: '^[A-Za-z0-9_-]{20,80}$' },
        limit: { type: 'integer', minimum: 1, maximum: 500 },
        ...ACCOUNT_FIELD,
        ...RESPONSE_OPTIONS_FIELDS,
      },
    },
    outputHint:
      'DouyinScrapeSummary { target: "user", file, count, preview, [records] }',
    requiresLogin: true,
  },
  {
    name: 'douyin.scrapeSearch',
    description: '按关键词列表抓取抖音视频搜索结果，支持综合/最新/热门排序',
    http: { method: 'POST', path: '/api/douyin/search' },
    inputSchema: {
      type: 'object',
      required: ['keywords'],
      properties: {
        keywords: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          maxItems: 30,
        },
        sort: { type: 'string', enum: ['general', 'latest', 'popular'] },
        limit: { type: 'integer', minimum: 1, maximum: 200, default: 20 },
        ...ACCOUNT_FIELD,
        ...RESPONSE_OPTIONS_FIELDS,
      },
    },
    outputHint:
      'DouyinScrapeSummary { target: "search", file, count, preview, [records: { awemeId, desc, author, stats, ... }] }',
    requiresLogin: true,
  },
  {
    name: 'douyin.scrapeComments',
    description: '抓取指定抖音作品下的评论（XHR 监听 + 评论区滚动分页）',
    http: { method: 'POST', path: '/api/douyin/comments' },
    inputSchema: {
      type: 'object',
      required: ['awemeId'],
      properties: {
        awemeId: { type: 'string', pattern: '^\\d{15,25}$' },
        limit: { type: 'integer', minimum: 1, maximum: 2000 },
        ...ACCOUNT_FIELD,
        ...RESPONSE_OPTIONS_FIELDS,
      },
    },
    outputHint:
      'DouyinScrapeSummary { target: "comments", file, count, preview, [records] }',
    requiresLogin: true,
  },
  {
    name: 'douyin.batch',
    description: '抖音混合批量抓取：tasks 数组按顺序执行，每项包含 type 与 id',
    http: { method: 'POST', path: '/api/douyin/batch' },
    inputSchema: {
      type: 'object',
      required: ['tasks'],
      properties: {
        tasks: {
          type: 'array',
          minItems: 1,
          maxItems: 50,
          items: {
            type: 'object',
            required: ['type', 'id'],
            properties: {
              type: {
                type: 'string',
                enum: ['aweme', 'user', 'search', 'comments'],
              },
              id: { type: 'string' },
              limit: { type: 'integer' },
              sort: { type: 'string', enum: ['general', 'latest', 'popular'] },
            },
          },
        },
        ...ACCOUNT_FIELD,
      },
    },
    outputHint: 'DouyinBatchSummary { total, succeeded, failed, results[] }',
    requiresLogin: true,
  },
  {
    name: 'auth.login',
    description:
      '打开浏览器进入指定平台（小红书/抖音）并等待用户扫码登录，登录成功后持久化 cookie',
    http: { method: 'POST', path: '/api/auth/login' },
    inputSchema: {
      type: 'object',
      properties: {
        ...ACCOUNT_FIELD,
        platform: { type: 'string', enum: ['xhs', 'douyin'], default: 'xhs' },
        proxy: { type: 'string', description: '可选代理，覆盖默认' },
      },
    },
    outputHint:
      '{ accountId, platform, loggedIn, userId?, nickname?, checkedAt }',
    preconditions: ['服务部署在能弹窗的环境（headful）'],
  },
  {
    name: 'auth.status',
    description: '无头探测某个账号 profile 在指定平台是否仍有有效登录态',
    http: { method: 'GET', path: '/api/auth/status' },
    inputSchema: {
      type: 'object',
      properties: {
        ...ACCOUNT_FIELD,
        platform: { type: 'string', enum: ['xhs', 'douyin'], default: 'xhs' },
      },
    },
    outputHint:
      '{ accountId, platform, loggedIn, userId?, nickname?, checkedAt }',
  },
  {
    name: 'storage.peek',
    description: '按文件路径读取 JSONL 抓取结果（分页）',
    http: { method: 'GET', path: '/api/storage/peek' },
    inputSchema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          description: '相对/绝对路径，必须落在 OUTPUT_DIR 内',
        },
        offset: { type: 'integer', minimum: 0, default: 0 },
        limit: { type: 'integer', minimum: 1, maximum: 500, default: 50 },
      },
    },
    outputHint: '{ file, total, offset, limit, items[] }',
  },
  {
    name: 'health',
    description: '健康检查：返回服务状态、登录账号、并发占用、缓存命中数',
    http: { method: 'GET', path: '/api/health' },
    inputSchema: { type: 'object', properties: {} },
    outputHint: '{ status, uptime, accounts, semaphore, cache }',
  },
];

export const SKILL_INDEX: Record<string, SkillDef> = Object.fromEntries(
  SKILL_MANIFEST.map((s) => [s.name, s]),
);
