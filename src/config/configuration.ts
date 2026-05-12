export interface AppConfig {
  port: number;
  apiToken: string; // 空字符串表示不鉴权
  cloak: {
    headless: boolean;
    humanize: boolean;
    timezone: string;
    locale: string;
    proxy?: string;
  };
  profileDir: string;
  outputDir: string;
  xhs: {
    concurrency: number;
    minDelayMs: number;
    maxDelayMs: number;
    navigationTimeoutMs: number;
    loginWaitMs: number;
  };
  douyin: {
    concurrency: number;
    minDelayMs: number;
    maxDelayMs: number;
    navigationTimeoutMs: number;
    loginWaitMs: number;
  };
  cache: {
    ttlMs: number;
    maxEntries: number;
  };
  mcp: {
    sseEnabled: boolean;
    sseEndpoint: string;
  };
}

const toBool = (v: string | undefined, def: boolean): boolean => {
  if (v === undefined) return def;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
};

const toInt = (v: string | undefined, def: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : def;
};

export default (): AppConfig => ({
  port: toInt(process.env.PORT, 5510),
  apiToken: process.env.API_TOKEN || '',
  cloak: {
    headless: toBool(process.env.CLOAK_HEADLESS, false),
    humanize: toBool(process.env.CLOAK_HUMANIZE, true),
    timezone: process.env.CLOAK_TIMEZONE || 'Asia/Shanghai',
    locale: process.env.CLOAK_LOCALE || 'zh-CN',
    proxy: process.env.CLOAK_PROXY || undefined,
  },
  profileDir: process.env.PROFILE_DIR || './data/profiles',
  outputDir: process.env.OUTPUT_DIR || './data/output',
  xhs: {
    concurrency: toInt(process.env.XHS_SCRAPE_CONCURRENCY, 1),
    minDelayMs: toInt(process.env.XHS_MIN_DELAY_MS, 800),
    maxDelayMs: toInt(process.env.XHS_MAX_DELAY_MS, 2400),
    navigationTimeoutMs: toInt(process.env.XHS_NAV_TIMEOUT_MS, 45000),
    loginWaitMs: toInt(process.env.XHS_LOGIN_WAIT_MS, 300000),
  },
  douyin: {
    concurrency: toInt(process.env.DOUYIN_SCRAPE_CONCURRENCY, 1),
    minDelayMs: toInt(process.env.DOUYIN_MIN_DELAY_MS, 1200),
    maxDelayMs: toInt(process.env.DOUYIN_MAX_DELAY_MS, 3000),
    navigationTimeoutMs: toInt(process.env.DOUYIN_NAV_TIMEOUT_MS, 45000),
    loginWaitMs: toInt(process.env.DOUYIN_LOGIN_WAIT_MS, 300000),
  },
  cache: {
    ttlMs: toInt(process.env.CACHE_TTL_MS, 5 * 60 * 1000),
    maxEntries: toInt(process.env.CACHE_MAX_ENTRIES, 256),
  },
  mcp: {
    sseEnabled: toBool(process.env.MCP_SSE_ENABLED, true),
    sseEndpoint: process.env.MCP_SSE_ENDPOINT || '/mcp',
  },
});
