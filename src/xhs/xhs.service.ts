import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration';
import { PageFactoryService } from '../browser/page-factory.service';
import { ScrapeCacheService } from '../common/cache/scrape-cache.service';
import { BusinessException, normalizeError } from '../common/errors/business.exception';
import { ErrorCode } from '../common/errors/error-code';
import { randomSleep } from '../common/utils/humanize.util';
import { Semaphore } from '../common/utils/semaphore.util';
import { JsonlWriterService, WriteResult } from '../storage/jsonl-writer.service';
import type { CommentEntity } from './entities/comment.entity';
import type { NoteEntity } from './entities/note.entity';
import type { UserEntity } from './entities/user.entity';
import type {
  ScrapeCommentsDto,
  ScrapeNoteDto,
  ScrapeResponseOptions,
  ScrapeSearchDto,
  ScrapeUserDto,
} from './dto/scrape.dto';
import type { BatchTaskDto, ScrapeBatchDto } from './dto/scrape-batch.dto';
import { CommentsStrategy } from './strategies/comments.strategy';
import { NoteDetailStrategy } from './strategies/note-detail.strategy';
import { SearchResultItem, SearchStrategy, enrichItemsInPlace } from './strategies/search.strategy';
import { UserProfileStrategy } from './strategies/user-profile.strategy';
import { AuthService } from '../auth/auth.service';

export interface ScrapeSummary<T = unknown> {
  target: 'note' | 'user' | 'search' | 'comments';
  file: string;
  count: number;
  durationMs: number;
  cached: boolean;
  /** 只返回前 N 条记录的摸要字段，供 agent 预览。 */
  preview?: Array<{ id?: string; title?: string; brief?: string }>;
  records?: T[];
}

export interface BatchSummary {
  total: number;
  succeeded: number;
  failed: number;
  results: Array<
    | { ok: true; task: BatchTaskDto; summary: ScrapeSummary }
    | { ok: false; task: BatchTaskDto; code: string; error: string }
  >;
  durationMs: number;
}

@Injectable()
export class XhsService implements OnModuleInit {
  private readonly logger = new Logger(XhsService.name);
  private semaphore!: Semaphore;

  constructor(
    private readonly pages: PageFactoryService,
    private readonly writer: JsonlWriterService,
    private readonly config: ConfigService,
    private readonly cache: ScrapeCacheService,
    private readonly noteStrategy: NoteDetailStrategy,
    private readonly userStrategy: UserProfileStrategy,
    private readonly searchStrategy: SearchStrategy,
    private readonly commentsStrategy: CommentsStrategy,
    private readonly auth: AuthService,
  ) {}

  onModuleInit(): void {
    const xhs = this.config.get<AppConfig['xhs']>('xhs');
    const max = xhs?.concurrency ?? 1;
    this.semaphore = new Semaphore(max);
    this.logger.log(`xhs scrape concurrency limit = ${max}`);
  }

  /** 信号量状态告知健康接口。 */
  semaphoreStats(): { running: number; queued: number; max: number } {
    return this.semaphore?.stats() ?? { running: 0, queued: 0, max: 0 };
  }

  // ===== 公开入口：幂等缓存 + 信号量 =====
  async scrapeNotes(dto: ScrapeNoteDto): Promise<ScrapeSummary<NoteEntity>> {
    return this.runWithCache('note', dto, () =>
      this.semaphore.run(() => this.doScrapeNotes(dto)),
    );
  }
  async scrapeUser(dto: ScrapeUserDto): Promise<ScrapeSummary<UserEntity>> {
    return this.runWithCache('user', dto, () =>
      this.semaphore.run(() => this.doScrapeUser(dto)),
    );
  }
  async scrapeSearch(dto: ScrapeSearchDto): Promise<ScrapeSummary<SearchResultItem>> {
    return this.runWithCache('search', dto, () =>
      this.semaphore.run(() => this.doScrapeSearch(dto)),
    );
  }
  async scrapeComments(dto: ScrapeCommentsDto): Promise<ScrapeSummary<CommentEntity>> {
    return this.runWithCache('comments', dto, () =>
      this.semaphore.run(() => this.doScrapeComments(dto)),
    );
  }

  async runBatch(dto: ScrapeBatchDto): Promise<BatchSummary> {
    const start = Date.now();
    const accountId = dto.accountId ?? 'default';
    const results: BatchSummary['results'] = [];
    let succeeded = 0;
    let failed = 0;
    for (const task of dto.tasks) {
      try {
        const summary = await this.runSingleTask(task, accountId);
        results.push({ ok: true, task, summary });
        succeeded += 1;
      } catch (err) {
        failed += 1;
        const biz = normalizeError(err);
        results.push({ ok: false, task, code: biz.code, error: biz.message });
      }
    }
    return { total: dto.tasks.length, succeeded, failed, results, durationMs: Date.now() - start };
  }

  private runSingleTask(task: BatchTaskDto, accountId: string): Promise<ScrapeSummary> {
    const need = (v?: string) => {
      if (!v) throw new BusinessException(ErrorCode.INVALID_INPUT, `batch task ${task.type} requires id`);
      return v;
    };
    switch (task.type) {
      case 'note':
        return this.scrapeNotes({ noteIds: [need(task.id)], accountId });
      case 'user':
        return this.scrapeUser({ userId: need(task.id), noteLimit: task.noteLimit, accountId });
      case 'search':
        return this.scrapeSearch({
          keywords: [need(task.id)],
          sort: task.sort,
          limit: task.limit,
          accountId,
        });
      case 'comments':
        return this.scrapeComments({ noteId: need(task.id), limit: task.limit, accountId });
      default:
        throw new BusinessException(
          ErrorCode.INVALID_INPUT,
          `unknown batch task type: ${String((task as BatchTaskDto).type)}`,
        );
    }
  }

  private async runWithCache<T>(
    target: ScrapeSummary['target'],
    dto: ScrapeResponseOptions,
    exec: () => Promise<ScrapeSummary<T>>,
  ): Promise<ScrapeSummary<T>> {
    const useCache = dto.useCache !== false; // 默认开
    const key = this.cache.buildKey(target, this.cacheableShape(dto as Record<string, unknown>));
    if (useCache) {
      const hit = this.cache.get<ScrapeSummary<T>>(key);
      if (hit) {
        return this.shapeResponse({ ...hit, cached: true }, dto);
      }
    }
    try {
      const fresh = await exec();
      if (useCache) this.cache.set(key, fresh);
      return this.shapeResponse(fresh, dto);
    } catch (err) {
      throw normalizeError(err);
    }
  }

  /** 只保留影响拓动结果的字段作为缓存 key，排除其他选项。 */
  private cacheableShape(dto: Record<string, unknown>): Record<string, unknown> {
    const skip = new Set(['includeRecords', 'includeRaw', 'maxRecords', 'useCache']);
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(dto)) if (!skip.has(k)) out[k] = dto[k];
    return out;
  }

  /** 按 includeRecords/includeRaw/maxRecords 裁剪响应。 */
  private shapeResponse<T>(
    summary: ScrapeSummary<T>,
    opts: ScrapeResponseOptions,
  ): ScrapeSummary<T> {
    const includeRecords = opts.includeRecords === true;
    const includeRaw = opts.includeRaw === true;
    const maxRecords = opts.maxRecords ?? 50;
    const records = summary.records ?? [];
    const preview = records.slice(0, 5).map((r) => this.toPreview(r));
    const out: ScrapeSummary<T> = {
      target: summary.target,
      file: summary.file,
      count: summary.count,
      durationMs: summary.durationMs,
      cached: summary.cached ?? false,
      preview,
    };
    if (includeRecords) {
      const sliced = records.slice(0, maxRecords);
      out.records = includeRaw
        ? sliced
        : (sliced.map((r) => this.stripRaw(r)) as T[]);
    }
    return out;
  }

  private stripRaw<T>(r: T): T {
    if (r && typeof r === 'object' && 'raw' in (r as object)) {
      const { raw: _ignored, ...rest } = r as unknown as Record<string, unknown>;
      return rest as unknown as T;
    }
    return r;
  }

  private toPreview(r: unknown): { id?: string; title?: string; brief?: string } {
    if (!r || typeof r !== 'object') return {};
    const o = r as Record<string, unknown>;
    return {
      id: (o.noteId ?? o.userId ?? o.commentId) as string | undefined,
      title: (o.title ?? o.nickname) as string | undefined,
      brief: typeof o.content === 'string' ? (o.content as string).slice(0, 80) : undefined,
    };
  }

  // ===== 下面是原生抓取实现（doXxx） =====

  private async doScrapeNotes(dto: ScrapeNoteDto): Promise<ScrapeSummary<NoteEntity>> {
    const start = Date.now();
    const accountId = dto.accountId ?? 'default';
    
    // 检查登录状态
    await this.ensureLoggedIn(accountId, 'xhs');
    
    const lease = await this.pages.acquire(accountId);
    const results: NoteEntity[] = [];
    try {
      for (const noteId of dto.noteIds) {
        await this.applyDelay();
        try {
          const data = await this.noteStrategy.run(lease.page, { noteId }, { accountId });
          results.push(data);
        } catch (err) {
          this.logger.warn(`note ${noteId} failed: ${(err as Error).message}`);
        }
      }
    } finally {
      await lease.release();
    }
    if (results.length === 0) {
      throw new BusinessException(
        ErrorCode.XHS_TARGET_NOT_FOUND,
        `no notes parsed for ${dto.noteIds.join(',')}`,
      );
    }
    const written = await this.writer.append('note', results);
    return this.summary('note', written, Date.now() - start, results);
  }

  private async doScrapeUser(dto: ScrapeUserDto): Promise<ScrapeSummary<UserEntity>> {
    const start = Date.now();
    const accountId = dto.accountId ?? 'default';
    
    // 检查登录状态
    await this.ensureLoggedIn(accountId, 'xhs');
    
    const lease = await this.pages.acquire(accountId);
    try {
      const data = await this.userStrategy.run(
        lease.page,
        { userId: dto.userId, noteLimit: dto.noteLimit },
        { accountId },
      );
      const written = await this.writer.append('user', [data], { suffix: dto.userId });
      return this.summary('user', written, Date.now() - start, [data]);
    } finally {
      await lease.release();
    }
  }

  private async doScrapeSearch(dto: ScrapeSearchDto): Promise<ScrapeSummary<SearchResultItem>> {
    const start = Date.now();
    const accountId = dto.accountId ?? 'default';
    
    // 检查登录状态
    await this.ensureLoggedIn(accountId, 'xhs');
    
    const lease = await this.pages.acquire(accountId);
    const aggregated: SearchResultItem[] = [];
    const wantDateFilter = Boolean(dto.publishedAfter || dto.publishedBefore);
    const targetLimit = dto.limit ?? 30;
    try {
      for (const keyword of dto.keywords) {
        await this.applyDelay();
        try {
          // 有日期过滤时 search.strategy 不提前过滤 publishTime（因为 search API 不返回），后面 enrich 后再过滤。
          const items = await this.searchStrategy.run(
            lease.page,
            {
              keyword,
              sort: dto.sort,
              // 要 enrich 时拉多些 raw，以补足过滤后数量
              limit: wantDateFilter ? Math.min(targetLimit * 3, 60) : targetLimit,
              minLikes: dto.minLikes,
              noteType: dto.noteType,
              // 不走 search.strategy 里的日期过滤（那里拿不到发布时间）
            },
            { accountId },
          );
          aggregated.push(...items);
        } catch (err) {
          this.logger.warn(`search "${keyword}" failed: ${(err as Error).message}`);
        }
      }

      if (wantDateFilter && aggregated.length > 0) {
        // SPA 内原地补 publishTime（点击卡片弹浮层，避开 explore 直跳被重定向到 /404/sec_xxx 的风控）
        await enrichItemsInPlace(lease.page, aggregated, {
          maxEnrich: Math.min(targetLimit * 2, 60),
          perItemTimeoutMs: 5000,
          logger: this.logger,
          sort: dto.sort,
        });
        const after = dto.publishedAfter ? Date.parse(dto.publishedAfter) : undefined;
        const before = dto.publishedBefore ? Date.parse(dto.publishedBefore) : undefined;
        const filtered = aggregated.filter((it) => {
          if (it.publishTimestamp === undefined) return false;
          if (after !== undefined && it.publishTimestamp < after) return false;
          if (before !== undefined && it.publishTimestamp > before) return false;
          return true;
        });
        aggregated.length = 0;
        aggregated.push(
          ...filtered.slice(0, targetLimit).map((it, i) => ({ ...it, rank: i + 1 })),
        );
      }
    } finally {
      await lease.release();
    }
    const written = await this.writer.append('search', aggregated);
    return this.summary('search', written, Date.now() - start, aggregated);
  }

  /**
   * 备用：走 noteStrategy.run -> page.goto(/explore/{id})，但受小红书风控拿不到发布时间，默认不调用。
   */
  private async enrichWithPublishTime(
    page: import('playwright-core').Page,
    items: SearchResultItem[],
    accountId: string,
  ): Promise<void> {
    const MAX_ENRICH = 30;
    let done = 0;
    for (const it of items) {
      if (done >= MAX_ENRICH) break;
      if (it.publishTimestamp !== undefined) continue;
      try {
        await this.applyDelay();
        const detail = await this.noteStrategy.run(page, { noteId: it.noteId }, { accountId });
        if (detail.publishedAt) {
          const ts = Number(detail.publishedAt);
          const ms = Number.isFinite(ts)
            ? ts > 1e12
              ? ts
              : ts * 1000
            : Date.parse(detail.publishedAt);
          if (Number.isFinite(ms)) {
            it.publishTimestamp = ms;
            it.publishTime = new Date(ms).toISOString();
          }
        }
        if (detail.likedCount !== undefined && it.likedCount === undefined) {
          it.likedCount = detail.likedCount;
        }
        if (detail.type && !it.noteType) it.noteType = detail.type;
        done += 1;
      } catch (err) {
        this.logger.warn(`enrich ${it.noteId} failed: ${(err as Error).message}`);
      }
    }
    this.logger.log(`enriched ${done}/${items.length} items with publishTime`);
  }

  private async doScrapeComments(dto: ScrapeCommentsDto): Promise<ScrapeSummary<CommentEntity>> {
    const start = Date.now();
    const accountId = dto.accountId ?? 'default';
    
    // 检查登录状态
    await this.ensureLoggedIn(accountId, 'xhs');
    
    const lease = await this.pages.acquire(accountId);
    try {
      const data = await this.commentsStrategy.run(
        lease.page,
        { noteId: dto.noteId, limit: dto.limit },
        { accountId },
      );
      const written = await this.writer.append('comments', data, { suffix: dto.noteId });
      return this.summary('comments', written, Date.now() - start, data);
    } finally {
      await lease.release();
    }
  }

  private async applyDelay(): Promise<void> {
    const xhs = this.config.get<AppConfig['xhs']>('xhs');
    const min = xhs?.minDelayMs ?? 800;
    const max = xhs?.maxDelayMs ?? 2400;
    await randomSleep(min, max);
  }

  private summary<T>(
    target: ScrapeSummary['target'],
    written: WriteResult,
    durationMs: number,
    records: T[],
  ): ScrapeSummary<T> {
    return {
      target,
      file: written.file,
      count: written.count,
      durationMs,
      cached: false,
      records,
    };
  }

  /** 检查登录状态，未则抛出异常 */
  private async ensureLoggedIn(accountId: string, platform: 'xhs' | 'douyin'): Promise<void> {
    const status = await this.auth.checkStatus(accountId, platform);
    if (!status.loggedIn) {
      throw new BusinessException(
        ErrorCode.LOGIN_REQUIRED,
        `${platform} 未登录，请先调用 /api/auth/login 进行登录`,
      );
    }
    this.logger.log(`[${platform}/${accountId}] 已登录，userId=${status.userId || 'unknown'}`);
  }
}
