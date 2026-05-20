import { Injectable, Logger } from '@nestjs/common';
import type { Page, Response } from 'playwright-core';
import { randomSleep, scrollPage } from '../../common/utils/humanize.util';
import type { SearchSort } from '../dto/scrape.dto';
import type { IScrapeStrategy, ScrapeContext } from './strategy.interface';

type AnyObj = Record<string, unknown>;

export interface SearchInput {
  keyword: string;
  sort?: SearchSort;
  limit?: number;
  /** 后置过滤：仅保留 publishTime >= 该 ISO 时间的记录。 */
  publishedAfter?: string;
  /** 后置过滤：仅保留 publishTime <= 该 ISO 时间的记录。 */
  publishedBefore?: string;
  /** 后置过滤：点赞数下限（依赖 likedCount 数值字段）。 */
  minLikes?: number;
  /** 后置过滤：笔记类型。 */
  noteType?: 'normal' | 'video';
}

export interface SearchResultItem {
  noteId: string;
  title?: string;
  cover?: string;
  /** 原始点赞文本（可能带“万/k”）。 */
  likedText?: string;
  /** 点赞数值，来自 search API raw。 */
  likedCount?: number;
  /** 笔记类型：normal/video/。 */
  noteType?: string;
  /** ISO 发布时间（raw 中有才填）。 */
  publishTime?: string;
  /** 发布时间戳（毫秒），后置过滤用。 */
  publishTimestamp?: number;
  author?: { userId?: string; nickname?: string };
  keyword: string;
  rank: number;
  fetchedAt: string;
  source: 'xhs';
  /** 笔记详情数据（通过点击卡片获取）。 */
  detail?: {
    content?: string;
    description?: string;
    collectedCount?: number;
    commentCount?: number;
    shareCount?: number;
    ipLocation?: string;
    tags?: string[];
  };
}

const SORT_MAP: Record<SearchSort, string> = {
  general: 'general',
  latest: 'time_descending',
  popular: 'popularity_descending',
};

const SEARCH_API_PATTERN = /(search\/notes|api\/sns\/web\/v\d+\/search|web\/v\d+\/homefeed|search_result)/i;

// SPA 浮层详情 API（feed/note/note_info 多路径兼容）
const NOTE_API_PATTERN =
  /(api\/sns\/(web|h5)\/v\d+\/(feed|note(_info)?)|note_card|noteDetail)/i;

@Injectable()
export class SearchStrategy implements IScrapeStrategy<SearchInput, SearchResultItem[]> {
  readonly name = 'search';
  private readonly logger = new Logger(SearchStrategy.name);

  async run(page: Page, input: SearchInput, _ctx: ScrapeContext): Promise<SearchResultItem[]> {
    const sort = SORT_MAP[input.sort ?? 'general'];
    const url = `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(input.keyword)}&source=web_explore_feed&sort=${sort}`;

    // 拦截搜索 API 响应，按 noteId 索引 raw payload，后续补 publishTime/likedCount/noteType。
    const rawByNoteId = new Map<string, AnyObj>();
    let apiCallCount = 0;
    const onResponse = (resp: Response): void => {
      const u = resp.url();
      // 调试：记录所有 JSON 响应
      const ct = resp.headers()['content-type'] ?? '';
      if (ct.includes('json')) {
        this.logger.log(`[search:${input.keyword}] API response: ${u.substring(0, 100)}`);
        apiCallCount++;
      }
      
      if (!SEARCH_API_PATTERN.test(u)) return;
      if (!ct.includes('json')) return;
      void resp
        .json()
        .then((json) => {
          this.logger.log(`[search:${input.keyword}] intercepted search API, keys: ${Object.keys(json).join(', ')}`);
          indexNoteRawByNoteId(json, rawByNoteId);
        })
        .catch(() => undefined);
    };
    page.on('response', onResponse);

    const hasFilter = Boolean(
      input.publishedAfter || input.publishedBefore || input.minLikes || input.noteType,
    );
    const targetLimit = input.limit ?? 30;
    // 有过滤时多抓三倍原始记录以补足过滤后数量，上限 200 防衰退。
    const fetchLimit = Math.min(hasFilter ? targetLimit * 3 : targetLimit, 200);

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForLoadState('networkidle').catch(() => undefined);
      await randomSleep(1500, 2500);

      // 检测是否需要登录（检查二维码弹窗或页面重定向）
      const needsLogin = await page.evaluate(() => {
        const qrElements = document.querySelectorAll(
          '[class*="qr-code"], [class*="QRCode"], [class*="login"], [class*="Login"]'
        );
        for (const el of qrElements) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 200 && rect.height > 200) {
            return true;
          }
        }
        return false;
      }).catch(() => false);

      const currentUrlCheck = page.url();
      const redirectedToExplore = currentUrlCheck.includes('/explore') && !currentUrlCheck.includes('search_result');

      if (needsLogin || redirectedToExplore) {
        // 抛出特殊异常，让上层服务处理登录流程
        throw new Error('LOGIN_REQUIRED: 检测到二维码登录弹窗，需要先完成登录。请调用 POST /api/auth/login 进行扫码登录，然后重试。');
      }

      // 调试：检查页面状态
      const pageTitle = await page.title();
      const currentUrl = page.url();
      this.logger.log(`[search:${input.keyword}] page loaded: ${currentUrl}, title: ${pageTitle}`);

      // 检查是否被重定向到验证码页面
      if (currentUrl.includes('verify') || currentUrl.includes('captcha')) {
        this.logger.warn(`[search:${input.keyword}] redirected to verify page: ${currentUrl}`);
        throw new Error('页面被重定向到验证码验证，可能触发反爬机制');
      }

      // 检查页面是否有搜索结果内容
      const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 500) || '');
      this.logger.log(`[search:${input.keyword}] page body preview: ${bodyText.slice(0, 200)}`);

      const collected = new Map<string, SearchResultItem>();
      let stagnant = 0;
      const maxRounds = 120;
      
      for (let round = 0; round < maxRounds && collected.size < fetchLimit; round++) {
        // 调试：首轮检查DOM元素数量
        if (round === 0) {
          const domCount = await page.$$eval('section.note-item, a.cover', (nodes) => nodes.length).catch(() => 0);
          this.logger.log(`[search:${input.keyword}] DOM elements found in round 0: ${domCount}`);
          
          // 如果首轮没有元素，等待更长时间再试
          if (domCount === 0) {
            this.logger.log(`[search:${input.keyword}] no elements found, waiting 3 seconds...`);
            await page.waitForTimeout(3000);
            const retryCount = await page.$$eval('section.note-item, a.cover', (nodes) => nodes.length).catch(() => 0);
            this.logger.log(`[search:${input.keyword}] DOM elements after wait: ${retryCount}`);
          }
        }
        
        const batch = await page.$$eval('section.note-item, a.cover', (nodes) =>
          nodes.slice(0, 400).map((el) => {
            const anchor = (el.tagName === 'A' ? el : el.querySelector('a')) as
              | HTMLAnchorElement
              | null;
            const href = anchor?.getAttribute('href') ?? '';
            const match = href.match(/\/explore\/([\w]+)|\/search_result\/([\w]+)/);
            const noteId = match?.[1] ?? match?.[2] ?? '';
            const img = el.querySelector('img') as HTMLImageElement | null;
            const title =
              (el.querySelector('.title, .footer .title') as HTMLElement | null)?.innerText ??
              undefined;
            const liked =
              (el.querySelector('.count, .like-wrapper .count') as HTMLElement | null)?.innerText ??
              undefined;
            const authorEl = el.querySelector('.author a, .author .name') as HTMLAnchorElement | null;
            const authorHref = authorEl?.getAttribute('href') ?? '';
            const userIdMatch = authorHref.match(/\/user\/profile\/([\w]+)/);
            return {
              noteId,
              title,
              cover: img?.src,
              likedText: liked,
              authorName: authorEl?.innerText,
              userId: userIdMatch?.[1],
            };
          }),
        );
        const prev = collected.size;
        for (const b of batch) {
          if (!b.noteId || collected.has(b.noteId)) continue;
          
          const item: SearchResultItem = {
            noteId: b.noteId,
            title: b.title,
            cover: b.cover,
            likedText: b.likedText,
            author:
              b.authorName || b.userId ? { nickname: b.authorName, userId: b.userId } : undefined,
            keyword: input.keyword,
            rank: collected.size + 1,
            fetchedAt: new Date().toISOString(),
            source: 'xhs',
          };
          
          // 关键改进：点击笔记卡片获取详情数据
          this.logger.log(`[search:${input.keyword}] 📝 点击笔记 ${b.noteId} 获取详情...`);
          try {
            const detail = await this.clickAndFetchDetail(page, b.noteId);
            if (detail) {
              item.detail = detail;
              this.logger.log(`[search:${input.keyword}] ✅ 笔记 ${b.noteId} 详情获取成功: title=${detail.content ? '✅' : '❌'}`);
            } else {
              this.logger.warn(`[search:${input.keyword}] ⚠️ 笔记 ${b.noteId} 详情获取失败`);
            }
          } catch (err) {
            this.logger.warn(`[search:${input.keyword}] ❌ 笔记 ${b.noteId} 点击失败: ${(err as Error).message}`);
          }
          
          collected.set(b.noteId, item);
          if (collected.size >= fetchLimit) break;
        }
        if (collected.size === prev) {
          stagnant += 1;
          if (stagnant >= 4) break;
        } else {
          stagnant = 0;
        }
        await scrollPage(page, { steps: 1, stepDelayMs: [800, 1600] });
      }

      // 记录搜索结果
      this.logger.log(`[search:${input.keyword}] collected ${collected.size} items after ${maxRounds} rounds`);
      this.logger.log(`[search:${input.keyword}] total API calls intercepted: ${apiCallCount}`);
      this.logger.log(`[search:${input.keyword}] raw data entries: ${rawByNoteId.size}`);
      
      // 如果结果为空，提供调试信息
      if (collected.size === 0) {
        this.logger.warn(`[search:${input.keyword}] no results found. Diagnostic info:`);
        this.logger.warn(`  - API calls intercepted: ${apiCallCount}`);
        this.logger.warn(`  - Raw data entries: ${rawByNoteId.size}`);
        this.logger.warn(`  - Possible reasons:`);
        this.logger.warn(`    1. Page structure changed (anti-scraping)`);
        this.logger.warn(`    2. JavaScript not fully loaded`);
        this.logger.warn(`    3. Network requests blocked or empty response`);
        this.logger.warn(`    4. Login session expired or account restricted`);
        this.logger.warn(`    5. Account in cooldown period (new login)`);
        
        // 截图调试
        try {
          const screenshot = await page.screenshot({ fullPage: false });
          this.logger.warn(`[search:${input.keyword}] screenshot captured: ${screenshot.length} bytes`);
        } catch {
          // 忽略截图错误
        }
      }

      // 给拦截到的未处理 response 一点时间 flush。
      await randomSleep(300, 600);

      // 合并 raw 补充字段。
      const enriched: SearchResultItem[] = [];
      for (const item of collected.values()) {
        const raw = rawByNoteId.get(item.noteId);
        if (raw) mergeRawIntoItem(item, raw);
        enriched.push(item);
      }

      // 后置过滤。
      const filtered = applyFilters(enriched, input);
      this.logger.log(
        `[search:${input.keyword}] collected=${enriched.length} filtered=${filtered.length} target=${targetLimit} rawHits=${rawByNoteId.size}`,
      );
      return filtered.slice(0, targetLimit).map((it, i) => ({ ...it, rank: i + 1 }));
    } finally {
      page.off('response', onResponse);
    }
  }

  /**
   * 点击笔记卡片并获取详情数据
   * 模拟人类点击行为，等待详情页加载后提取数据
   */
  private async clickAndFetchDetail(page: Page, noteId: string): Promise<SearchResultItem['detail'] | null> {
    try {
      // 查找笔记卡片并点击
      const cardSelectors = [
        `a[href*="${noteId}"]`,
        `section.note-item a[href*="${noteId}"]`,
        `[data-note-id="${noteId}"]`,
      ];

      let clicked = false;
      for (const selector of cardSelectors) {
        try {
          const card = await page.$(selector);
          if (card) {
            // 模拟人类鼠标移动
            const box = await card.boundingBox();
            if (box) {
              await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 });
              await randomSleep(300, 600);
            }
            
            // 点击卡片
            await card.click();
            clicked = true;
            break;
          }
        } catch {
          // 尝试下一个选择器
        }
      }

      if (!clicked) {
        return null;
      }

      // 等待详情页加载
      await page.waitForLoadState('networkidle').catch(() => undefined);
      await randomSleep(2000, 3000);

      // 检测登录状态
      const needsLogin = await page.evaluate(() => {
        const qrElements = document.querySelectorAll(
          '[class*="qr-code"], [class*="QRCode"], [class*="qrcode"]'
        );
        for (const el of qrElements) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 150 && rect.height > 150) {
            return true;
          }
        }
        return false;
      }).catch(() => false);

      if (needsLogin) {
        this.logger.warn(`[${noteId}] ⚠️ 检测到登录弹窗，等待用户扫码...`);
        // 等待登录完成（最长120秒）
        await this.waitForLoginComplete(page, noteId);
      }

      // 模拟人类滚动阅读
      await scrollPage(page, { steps: 2, stepDelayMs: [800, 1500] });
      await randomSleep(1000, 2000);

      // 提取详情数据
      const detail = await page.evaluate(() => {
        const q = (sel: string) => document.querySelector(sel)?.textContent?.trim() || undefined;
        const qa = (sel: string) => Array.from(document.querySelectorAll(sel)).map(el => el.textContent?.trim()).filter(Boolean).join('\n');
        
        return {
          content: q('#detail-desc') ?? q('.note-content .desc') ?? q('.content') ?? qa('.note-content p'),
          description: q('.description') ?? q('.desc'),
          ipLocation: q('.ip-location') ?? q('.location'),
        };
      });

      // 返回上一页
      await page.goBack({ waitUntil: 'networkidle' }).catch(() => undefined);
      await randomSleep(1000, 2000);

      return detail;
    } catch (err) {
      this.logger.warn(`[${noteId}] 点击获取详情失败: ${(err as Error).message}`);
      // 确保返回搜索页
      await page.goBack({ waitUntil: 'networkidle' }).catch(() => undefined);
      return null;
    }
  }

  /**
   * 等待用户扫码登录完成
   */
  private async waitForLoginComplete(page: Page, noteId: string, timeoutMs = 120000): Promise<void> {
    const startTime = Date.now();
    const checkInterval = 3000;
    let checkCount = 0;

    while (Date.now() - startTime < timeoutMs) {
      checkCount++;
      await page.waitForTimeout(checkInterval);
      
      const stillNeedLogin = await page.evaluate(() => {
        const qrElements = document.querySelectorAll(
          '[class*="qr-code"], [class*="QRCode"], [class*="qrcode"]'
        );
        for (const el of qrElements) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 150 && rect.height > 150) {
            return true;
          }
        }
        return false;
      }).catch(() => false);

      if (!stillNeedLogin) {
        this.logger.log(`[${noteId}] ✅ 登录成功（检查 ${checkCount} 次）`);
        await page.waitForLoadState('networkidle').catch(() => undefined);
        await randomSleep(2000, 3000);
        return;
      }

      if (checkCount % 10 === 0) {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        this.logger.log(`[${noteId}] ⏳ 等待中... 已等待 ${elapsed} 秒`);
      }
    }

    throw new Error(`[${noteId}] 登录超时`);
  }
}

// ===== 辅助函数 =====

function indexNoteRawByNoteId(payload: unknown, sink: Map<string, AnyObj>, depth = 0): void {
  if (!payload || depth > 6) return;
  if (Array.isArray(payload)) {
    for (const v of payload) indexNoteRawByNoteId(v, sink, depth + 1);
    return;
  }
  if (typeof payload !== 'object') return;
  const obj = payload as AnyObj;
  // 常见路径：items[].id + note_card / id + noteCard / item.note
  const id =
    typeof obj.id === 'string' && /^[0-9a-fA-F]{16,}$/.test(obj.id) ? obj.id : undefined;
  const noteCard =
    (obj.note_card as AnyObj | undefined) ?? (obj.noteCard as AnyObj | undefined) ?? undefined;
  if (id && noteCard) {
    sink.set(id, noteCard);
  } else if (id && (obj.title !== undefined || obj.interact_info || obj.interactInfo)) {
    sink.set(id, obj);
  }
  for (const key of Object.keys(obj)) {
    const v = obj[key];
    if (v && typeof v === 'object') indexNoteRawByNoteId(v, sink, depth + 1);
  }
}

function mergeRawIntoItem(item: SearchResultItem, raw: AnyObj): void {
  const interact = (raw.interact_info ?? raw.interactInfo ?? {}) as AnyObj;
  const likedNum = toNumber(interact.liked_count ?? interact.likedCount);
  if (likedNum !== undefined) item.likedCount = likedNum;

  const t = raw.type;
  if (typeof t === 'string') item.noteType = t;

  // 小红书 time 字段通常是毫秒时间戳。
  const timeRaw =
    raw.time ??
    raw.publish_time ??
    raw.publishTime ??
    raw.last_update_time ??
    raw.lastUpdateTime;
  const ts = toNumber(timeRaw);
  if (ts !== undefined) {
    const ms = ts > 1e12 ? ts : ts * 1000; // 秒 -> 毫秒
    item.publishTimestamp = ms;
    item.publishTime = new Date(ms).toISOString();
  } else if (typeof timeRaw === 'string') {
    const d = new Date(timeRaw);
    if (!Number.isNaN(d.getTime())) {
      item.publishTimestamp = d.getTime();
      item.publishTime = d.toISOString();
    }
  }

  // 补 author / title / cover。
  if (!item.title && typeof raw.display_title === 'string') item.title = raw.display_title;
  const user = (raw.user ?? {}) as AnyObj;
  if (item.author) {
    if (!item.author.userId)
      item.author.userId = (user.user_id as string | undefined) ?? (user.userId as string | undefined);
    if (!item.author.nickname) item.author.nickname = user.nickname as string | undefined;
  }
}

function applyFilters(items: SearchResultItem[], input: SearchInput): SearchResultItem[] {
  const after = input.publishedAfter ? Date.parse(input.publishedAfter) : undefined;
  const before = input.publishedBefore ? Date.parse(input.publishedBefore) : undefined;
  const minLikes = input.minLikes;
  const noteType = input.noteType;
  return items.filter((it) => {
    if (after !== undefined) {
      if (it.publishTimestamp === undefined || it.publishTimestamp < after) return false;
    }
    if (before !== undefined) {
      if (it.publishTimestamp === undefined || it.publishTimestamp > before) return false;
    }
    if (minLikes !== undefined) {
      if (it.likedCount === undefined || it.likedCount < minLikes) return false;
    }
    if (noteType !== undefined) {
      if (it.noteType !== noteType) return false;
    }
    return true;
  });
}

function toNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/**
 * SPA 内原地补 publishTime：重新 goto 搜索页（避免虚拟列表 detach），在顶部依次点击卡片弹出浮层，拦截 feed/note API 拿发布时间。
 * 不走 page.goto(/explore/{id})，避免被小红书重定向到 /404/sec_xxx。
 */
export async function enrichItemsInPlace(
  page: Page,
  items: SearchResultItem[],
  opts: { maxEnrich?: number; perItemTimeoutMs?: number; logger?: Logger; keyword?: string; sort?: SearchSort } = {},
): Promise<{ enriched: number; failed: number }> {
  const maxEnrich = opts.maxEnrich ?? 30;
  const perItemTimeoutMs = opts.perItemTimeoutMs ?? 5000;
  const logger = opts.logger ?? new Logger('SearchEnrich');

  // 只处理需要 enrich 的前 N 条，避免后面虚拟列表补可能需要多轮滚动。
  const targets = items.filter((it) => it.publishTimestamp === undefined).slice(0, maxEnrich);
  if (targets.length === 0) return { enriched: 0, failed: 0 };

  const rawByNoteId = new Map<string, AnyObj>();
  const sniffedJson: string[] = [];
  const onResponse = (resp: Response): void => {
    const u = resp.url();
    const ct = resp.headers()['content-type'] ?? '';
    if (!ct.includes('json')) return;
    if (sniffedJson.length < 80) sniffedJson.push(u.slice(0, 200));
    if (!NOTE_API_PATTERN.test(u)) return;
    void resp
      .json()
      .then((json) => indexNoteRawByNoteId(json, rawByNoteId))
      .catch(() => undefined);
  };
  page.on('response', onResponse);

  let enriched = 0;
  let failed = 0;
  try {
    // 重新进入搜索结果页，让虚拟列表从顶部 rank=1 开始。
    // 使用首个 target 的 keyword（items 均同 keyword，取首条即可）。
    const keyword = opts.keyword ?? targets[0]?.keyword ?? '';
    const sortKey = SORT_MAP[opts.sort ?? 'general'];
    const url = `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(keyword)}&source=web_explore_feed&sort=${sortKey}`;
    await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await page.waitForTimeout(800);

    // 一次性 dump 全部 explore href，debug 虚拟列表是否是隐藏在 shadow DOM / iframe 中。
    const exploreHrefs = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href*="/explore/"]')) as HTMLAnchorElement[];
      return links.slice(0, 10).map((a) => a.getAttribute('href') ?? '');
    });
    logger.log(`enrich-in-place: page has ${exploreHrefs.length} explore links sample=${JSON.stringify(exploreHrefs.slice(0, 3))}`);

    // 全局兜底：在 capture 阶段拦截所有 a[href^="/explore/"] 的 click，preventDefault 阻止 href navigate，
    // 但不 stopPropagation，让 React 委托在 document 上的合成事件 onClick 仍能触发浮层逻辑。
    await page.evaluate(() => {
      // 幂等：避免重复挂载
      const W = window as unknown as { __xhsExploreClickGuard?: boolean };
      if (W.__xhsExploreClickGuard) return;
      W.__xhsExploreClickGuard = true;
      document.addEventListener(
        'click',
        (e) => {
          const tgt = e.target as HTMLElement | null;
          if (!tgt) return;
          const a = tgt.closest('a[href*="/explore/"]') as HTMLAnchorElement | null;
          if (!a) return;
          e.preventDefault();
        },
        true, // capture 阶段先于 a 默认 navigate 处理
      );
      // 同时拦截 ctrl/middle click 触发的 auxclick
      document.addEventListener(
        'auxclick',
        (e) => {
          const tgt = e.target as HTMLElement | null;
          if (!tgt) return;
          const a = tgt.closest('a[href*="/explore/"]') as HTMLAnchorElement | null;
          if (!a) return;
          e.preventDefault();
        },
        true,
      );
    });

    for (const it of targets) {
      try {
        // 先检查元素是否存在；不存在则逐步滚动刷出。
        let exists = await page.evaluate(
          (id) => !!document.querySelector(`a[href*="/explore/${id}"]`),
          it.noteId,
        );
        let scrollAttempts = 0;
        while (!exists && scrollAttempts < 10) {
          await page.mouse.wheel(0, 800).catch(() => undefined);
          await page.waitForTimeout(500);
          exists = await page.evaluate(
            (id) => !!document.querySelector(`a[href*="/explore/${id}"]`),
            it.noteId,
          );
          scrollAttempts += 1;
        }
        if (!exists) {
          logger.warn(`enrich-in-place ${it.noteId} no link in DOM after ${scrollAttempts} scrolls`);
          failed += 1;
          continue;
        }
        // 获取元素边界框并用真实鼠标点击（让 React 拦截合成事件弹浮层）。
        // 避免 a.click() 触发 href 默认跳转被小红书风控到 /404/sec_xxx。
        // 注意：a 标签本身可能是 inline 包裹层 0×0，需递归到祖先或可点子元素拿可视边界。
        const box = await page.evaluate((id) => {
          const a = document.querySelector(`a[href*="/explore/${id}"]`) as HTMLElement | null;
          if (!a) return null;
          a.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });
          // 候选顺序：先试 a 自身→祖先 section.note-item / .note-item→a 内 .cover/img→a 递归子元素
          const candidates: HTMLElement[] = [
            a,
            (a.closest('section.note-item') as HTMLElement | null) ?? (null as unknown as HTMLElement),
            (a.closest('.note-item') as HTMLElement | null) ?? (null as unknown as HTMLElement),
            (a.querySelector('.cover') as HTMLElement | null) ?? (null as unknown as HTMLElement),
            (a.querySelector('img') as HTMLElement | null) ?? (null as unknown as HTMLElement),
            (a.firstElementChild as HTMLElement | null) ?? (null as unknown as HTMLElement),
          ].filter(Boolean);
          let chosen: { el: HTMLElement; r: DOMRect } | null = null;
          const dims: Array<{ tag: string; cls: string; w: number; h: number }> = [];
          for (const c of candidates) {
            if (!c) continue;
            const r = c.getBoundingClientRect();
            dims.push({ tag: c.tagName, cls: (c.className ?? '').toString().slice(0, 40), w: Math.round(r.width), h: Math.round(r.height) });
            if (r.width > 4 && r.height > 4 && !chosen) chosen = { el: c, r };
          }
          if (!chosen) return { box: null, dims };
          // 确保 chosen 在可视区
          chosen.el.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });
          const r = chosen.el.getBoundingClientRect();
          return {
            box: { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height, tag: chosen.el.tagName },
            dims,
          };
        }, it.noteId);
        if (!box || !box.box) {
          logger.warn(`enrich-in-place ${it.noteId} no clickable box, dims=${JSON.stringify(box?.dims ?? [])}`);
          failed += 1;
          continue;
        }
        // scrollIntoView 后等一点点让边界框稳定。
        await page.waitForTimeout(200);
        await page.mouse.click(box.box.x, box.box.y, { delay: 50 }).catch(() => undefined);

        const t0 = Date.now();
        while (Date.now() - t0 < perItemTimeoutMs && !rawByNoteId.has(it.noteId)) {
          await page.waitForTimeout(150);
        }
        const raw = rawByNoteId.get(it.noteId);
        // 注：page.url() 可能已 navigate 到 /explore/{id}（携正确 xsec_token 不会被风控），
        // explore 页加载会触发 feed/note API 是 publishTime 的真实来源，不需产生警告。
        if (raw) {
          mergeRawIntoItem(it, raw);
          enriched += 1;
        } else {
          logger.warn(`enrich-in-place ${it.noteId} timeout, no raw within ${perItemTimeoutMs}ms (rawHits=${rawByNoteId.size})`);
          failed += 1;
        }
      } catch (err) {
        failed += 1;
        logger.warn(`enrich-in-place ${it.noteId} failed: ${(err as Error).message}`);
      } finally {
        // 关闭可能弹出的浮层
        await page.keyboard.press('Escape').catch(() => undefined);
        await page.waitForTimeout(300);
      }
    }
  } finally {
    page.off('response', onResponse);
  }
  if (enriched === 0 && targets.length > 0 && sniffedJson.length > 0) {
    logger.warn(`enrich-in-place: 0 enriched. JSON URLs sample: ${JSON.stringify(sniffedJson.slice(-15))}`);
  }
  logger.log(`enrich-in-place: enriched=${enriched} failed=${failed} total=${targets.length}`);
  return { enriched, failed };
}
