import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration';
import { PageFactoryService } from '../browser/page-factory.service';
import { ScrapeCacheService } from '../common/cache/scrape-cache.service';
import {
  BusinessException,
  normalizeError,
} from '../common/errors/business.exception';
import { ErrorCode } from '../common/errors/error-code';
import { randomSleep } from '../common/utils/humanize.util';
import { Semaphore } from '../common/utils/semaphore.util';
import {
  JsonlWriterService,
  WriteResult,
} from '../storage/jsonl-writer.service';
import type { ScrapeTarget } from '../storage/file-naming.service';
import type { AwemeEntity } from './entities/aweme.entity';
import type { DouyinCommentEntity } from './entities/douyin-comment.entity';
import type { DouyinUserEntity } from './entities/douyin-user.entity';
import type {
  ScrapeAwemeDto,
  ScrapeDouyinCommentsDto,
  ScrapeDouyinSearchDto,
  ScrapeDouyinUserDto,
} from './dto/scrape.dto';
import type {
  DouyinBatchTaskDto,
  DouyinScrapeBatchDto,
} from './dto/scrape-batch.dto';
import { AwemeDetailStrategy } from './strategies/aweme-detail.strategy';
import { CommentsStrategy } from './strategies/comments.strategy';
import { DouyinSearchItem, SearchStrategy } from './strategies/search.strategy';
import { UserProfileStrategy } from './strategies/user-profile.strategy';
import { AuthService } from '../auth/auth.service';

export interface DouyinScrapeResponseOptions {
  includeRecords?: boolean;
  includeRaw?: boolean;
  maxRecords?: number;
  useCache?: boolean;
}

export type DouyinScrapeKind = 'aweme' | 'user' | 'search' | 'comments';

export interface DouyinScrapeSummary<T = unknown> {
  target: DouyinScrapeKind;
  file: string;
  count: number;
  durationMs: number;
  cached: boolean;
  preview?: Array<{ id?: string; title?: string; brief?: string }>;
  records?: T[];
}

export interface DouyinBatchSummary {
  total: number;
  succeeded: number;
  failed: number;
  results: Array<
    | { ok: true; task: DouyinBatchTaskDto; summary: DouyinScrapeSummary }
    | { ok: false; task: DouyinBatchTaskDto; code: string; error: string }
  >;
  durationMs: number;
}

const TARGET_FILE_MAP: Record<DouyinScrapeKind, ScrapeTarget> = {
  aweme: 'douyin-aweme',
  user: 'douyin-user',
  search: 'douyin-search',
  comments: 'douyin-comments',
};

@Injectable()
export class DouyinService implements OnModuleInit {
  private readonly logger = new Logger(DouyinService.name);
  private semaphore!: Semaphore;

  constructor(
    private readonly pages: PageFactoryService,
    private readonly writer: JsonlWriterService,
    private readonly config: ConfigService,
    private readonly cache: ScrapeCacheService,
    private readonly awemeStrategy: AwemeDetailStrategy,
    private readonly userStrategy: UserProfileStrategy,
    private readonly searchStrategy: SearchStrategy,
    private readonly commentsStrategy: CommentsStrategy,
    private readonly auth: AuthService,
  ) {}

  onModuleInit(): void {
    const dy = this.config.get<AppConfig['douyin']>('douyin');
    const max = dy?.concurrency ?? 1;
    this.semaphore = new Semaphore(max);
    this.logger.log(`douyin scrape concurrency limit = ${max}`);
  }

  semaphoreStats(): { running: number; queued: number; max: number } {
    return this.semaphore?.stats() ?? { running: 0, queued: 0, max: 0 };
  }

  // ===== 公开入口：缓存 + 信号量 =====
  async scrapeAwemes(
    dto: ScrapeAwemeDto,
  ): Promise<DouyinScrapeSummary<AwemeEntity>> {
    return this.runWithCache('aweme', dto, () =>
      this.semaphore.run(() => this.doScrapeAwemes(dto)),
    );
  }
  async scrapeUser(
    dto: ScrapeDouyinUserDto,
  ): Promise<DouyinScrapeSummary<DouyinUserEntity>> {
    return this.runWithCache('user', dto, () =>
      this.semaphore.run(() => this.doScrapeUser(dto)),
    );
  }
  async scrapeSearch(
    dto: ScrapeDouyinSearchDto,
  ): Promise<DouyinScrapeSummary<DouyinSearchItem>> {
    return this.runWithCache('search', dto, () =>
      this.semaphore.run(() => this.doScrapeSearch(dto)),
    );
  }
  async scrapeComments(
    dto: ScrapeDouyinCommentsDto,
  ): Promise<DouyinScrapeSummary<DouyinCommentEntity>> {
    return this.runWithCache('comments', dto, () =>
      this.semaphore.run(() => this.doScrapeComments(dto)),
    );
  }

  async runBatch(dto: DouyinScrapeBatchDto): Promise<DouyinBatchSummary> {
    const start = Date.now();
    const accountId = dto.accountId ?? 'default';
    const results: DouyinBatchSummary['results'] = [];
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
    return {
      total: dto.tasks.length,
      succeeded,
      failed,
      results,
      durationMs: Date.now() - start,
    };
  }

  private runSingleTask(
    task: DouyinBatchTaskDto,
    accountId: string,
  ): Promise<DouyinScrapeSummary> {
    const need = (v?: string) => {
      if (!v)
        throw new BusinessException(
          ErrorCode.INVALID_INPUT,
          `batch task ${task.type} requires id`,
        );
      return v;
    };
    switch (task.type) {
      case 'aweme':
        return this.scrapeAwemes({ awemeIds: [need(task.id)], accountId });
      case 'user':
        return this.scrapeUser({
          secUserId: need(task.id),
          limit: task.limit,
          accountId,
        });
      case 'search':
        return this.scrapeSearch({
          keywords: [need(task.id)],
          sort: task.sort,
          limit: task.limit,
          accountId,
        });
      case 'comments':
        return this.scrapeComments({
          awemeId: need(task.id),
          limit: task.limit,
          accountId,
        });
      default:
        throw new BusinessException(
          ErrorCode.INVALID_INPUT,
          `unknown douyin batch task type: ${String(task.type)}`,
        );
    }
  }

  private async runWithCache<T>(
    target: DouyinScrapeKind,
    dto: DouyinScrapeResponseOptions,
    exec: () => Promise<DouyinScrapeSummary<T>>,
  ): Promise<DouyinScrapeSummary<T>> {
    const useCache = dto.useCache !== false;
    const key = this.cache.buildKey(
      `douyin-${target}`,
      this.cacheableShape(dto as unknown as Record<string, unknown>),
    );
    if (useCache) {
      const hit = this.cache.get<DouyinScrapeSummary<T>>(key);
      if (hit) return this.shapeResponse({ ...hit, cached: true }, dto);
    }
    try {
      const fresh = await exec();
      if (useCache) this.cache.set(key, fresh);
      return this.shapeResponse(fresh, dto);
    } catch (err) {
      throw normalizeError(err);
    }
  }

  private cacheableShape(
    dto: Record<string, unknown>,
  ): Record<string, unknown> {
    const skip = new Set([
      'includeRecords',
      'includeRaw',
      'maxRecords',
      'useCache',
    ]);
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(dto)) if (!skip.has(k)) out[k] = dto[k];
    return out;
  }

  private shapeResponse<T>(
    summary: DouyinScrapeSummary<T>,
    opts: DouyinScrapeResponseOptions,
  ): DouyinScrapeSummary<T> {
    const includeRecords = opts.includeRecords === true;
    const includeRaw = opts.includeRaw === true;
    const maxRecords = opts.maxRecords ?? 50;
    const records = summary.records ?? [];
    const preview = records.slice(0, 5).map((r) => this.toPreview(r));
    const out: DouyinScrapeSummary<T> = {
      target: summary.target,
      file: summary.file,
      count: summary.count,
      durationMs: summary.durationMs,
      cached: summary.cached ?? false,
      preview,
    };
    if (includeRecords) {
      const sliced = records.slice(0, maxRecords);
      out.records = includeRaw ? sliced : sliced.map((r) => this.stripRaw(r));
    }
    return out;
  }

  private stripRaw<T>(r: T): T {
    if (r && typeof r === 'object' && 'raw' in (r as object)) {
      const { raw: _ignored, ...rest } = r as unknown as Record<
        string,
        unknown
      >;
      return rest as unknown as T;
    }
    return r;
  }

  private toPreview(r: unknown): {
    id?: string;
    title?: string;
    brief?: string;
  } {
    if (!r || typeof r !== 'object') return {};
    const o = r as Record<string, unknown>;
    return {
      id: (o.awemeId ?? o.secUserId ?? o.cid) as string | undefined,
      title: (o.title ?? o.nickname ?? o.desc) as string | undefined,
      brief:
        typeof o.text === 'string'
          ? o.text.slice(0, 80)
          : typeof o.desc === 'string'
            ? o.desc.slice(0, 80)
            : undefined,
    };
  }

  // ===== 实现 =====

  private async doScrapeAwemes(
    dto: ScrapeAwemeDto,
  ): Promise<DouyinScrapeSummary<AwemeEntity>> {
    const start = Date.now();
    const accountId = dto.accountId ?? 'default';
    
    // 检查登录状态
    await this.ensureLoggedIn(accountId, 'douyin');
    
    const lease = await this.pages.acquire(accountId);
    const results: AwemeEntity[] = [];
    try {
      for (const awemeId of dto.awemeIds) {
        await this.applyDelay();
        try {
          const data = await this.awemeStrategy.run(
            lease.page,
            { awemeId },
            { accountId },
          );
          results.push(data);
        } catch (err) {
          this.logger.warn(
            `aweme ${awemeId} failed: ${(err as Error).message}`,
          );
        }
      }
    } finally {
      await lease.release();
    }
    if (results.length === 0) {
      throw new BusinessException(
        ErrorCode.DOUYIN_TARGET_NOT_FOUND,
        `no awemes parsed for ${dto.awemeIds.join(',')}`,
      );
    }
    const written = await this.writer.append(TARGET_FILE_MAP.aweme, results);
    return this.summary('aweme', written, Date.now() - start, results);
  }

  private async doScrapeUser(
    dto: ScrapeDouyinUserDto,
  ): Promise<DouyinScrapeSummary<DouyinUserEntity>> {
    const start = Date.now();
    const accountId = dto.accountId ?? 'default';
    
    // 检查登录状态
    await this.ensureLoggedIn(accountId, 'douyin');
    
    const lease = await this.pages.acquire(accountId);
    try {
      const data = await this.userStrategy.run(
        lease.page,
        { secUserId: dto.secUserId, limit: dto.limit },
        { accountId },
      );
      const written = await this.writer.append(TARGET_FILE_MAP.user, [data], {
        suffix: dto.secUserId,
      });
      return this.summary('user', written, Date.now() - start, [data]);
    } finally {
      await lease.release();
    }
  }

  private async doScrapeSearch(
    dto: ScrapeDouyinSearchDto,
  ): Promise<DouyinScrapeSummary<DouyinSearchItem>> {
    const start = Date.now();
    const accountId = dto.accountId ?? 'default';
    
    // 检查登录状态
    await this.ensureLoggedIn(accountId, 'douyin');
    
    const lease = await this.pages.acquire(accountId);
    const aggregated: DouyinSearchItem[] = [];
    const limit = dto.limit ?? 20;
    try {
      for (const keyword of dto.keywords) {
        await this.applyDelay();
        try {
          const items = await this.searchStrategy.run(
            lease.page,
            { keyword, sort: dto.sort, limit },
            { accountId },
          );
          aggregated.push(...items);
        } catch (err) {
          this.logger.warn(
            `search "${keyword}" failed: ${(err as Error).message}`,
          );
        }
      }
    } finally {
      await lease.release();
    }
    const written = await this.writer.append(
      TARGET_FILE_MAP.search,
      aggregated,
    );
    return this.summary('search', written, Date.now() - start, aggregated);
  }

  private async doScrapeComments(
    dto: ScrapeDouyinCommentsDto,
  ): Promise<DouyinScrapeSummary<DouyinCommentEntity>> {
    const start = Date.now();
    const accountId = dto.accountId ?? 'default';
    
    // 检查登录状态
    await this.ensureLoggedIn(accountId, 'douyin');
    
    const lease = await this.pages.acquire(accountId);
    try {
      const data = await this.commentsStrategy.run(
        lease.page,
        { awemeId: dto.awemeId, limit: dto.limit },
        { accountId },
      );
      const written = await this.writer.append(TARGET_FILE_MAP.comments, data, {
        suffix: dto.awemeId,
      });
      return this.summary('comments', written, Date.now() - start, data);
    } finally {
      await lease.release();
    }
  }

  private async applyDelay(): Promise<void> {
    const dy = this.config.get<AppConfig['douyin']>('douyin');
    const min = dy?.minDelayMs ?? 1200;
    const max = dy?.maxDelayMs ?? 3000;
    await randomSleep(min, max);
  }

  private summary<T>(
    target: DouyinScrapeKind,
    written: WriteResult,
    durationMs: number,
    records: T[],
  ): DouyinScrapeSummary<T> {
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
