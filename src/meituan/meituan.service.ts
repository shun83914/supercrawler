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
import type { MeituanOrderEntity } from './entities/order.entity';
import type { MeituanProductEntity } from './entities/product.entity';
import type { MeituanReviewEntity } from './entities/review.entity';
import type { MeituanPromotionCampaignEntity } from './entities/promotion-campaign.entity';
import type { MeituanPromotionStatsEntity } from './entities/promotion-stats.entity';
import type {
  ScrapeMeituanOrdersDto,
  ScrapeMeituanProductsDto,
  ScrapeMeituanReviewsDto,
  ScrapeMeituanPromotionCampaignsDto,
  ScrapeMeituanPromotionStatsDto,
} from './dto/scrape.dto';
import { OrderResultItem, OrdersStrategy } from './strategies/orders.strategy';
import { ProductResultItem, ProductsStrategy } from './strategies/products.strategy';
import { ReviewResultItem, ReviewsStrategy } from './strategies/reviews.strategy';
import { PromotionCampaignResultItem, PromotionCampaignsStrategy } from './strategies/promotion-campaigns.strategy';
import { PromotionStatsResultItem, PromotionStatsStrategy } from './strategies/promotion-stats.strategy';

export interface ScrapeSummary<T = unknown> {
  target: 'orders' | 'products' | 'reviews' | 'promotion-campaigns' | 'promotion-stats';
  file: string;
  count: number;
  durationMs: number;
  cached: boolean;
  preview?: Array<{ id?: string; title?: string; brief?: string }>;
  records?: T[];
}

@Injectable()
export class MeituanService implements OnModuleInit {
  private readonly logger = new Logger(MeituanService.name);
  private semaphore!: Semaphore;

  constructor(
    private readonly pages: PageFactoryService,
    private readonly writer: JsonlWriterService,
    private readonly config: ConfigService,
    private readonly cache: ScrapeCacheService,
    private readonly ordersStrategy: OrdersStrategy,
    private readonly productsStrategy: ProductsStrategy,
    private readonly reviewsStrategy: ReviewsStrategy,
    private readonly promotionCampaignsStrategy: PromotionCampaignsStrategy,
    private readonly promotionStatsStrategy: PromotionStatsStrategy,
  ) {}

  onModuleInit(): void {
    const meituan = this.config.get<AppConfig['meituan']>('meituan');
    const max = meituan?.concurrency ?? 1;
    this.semaphore = new Semaphore(max);
    this.logger.log(`meituan scrape concurrency limit = ${max}`);
  }

  /** 信号量状态告知健康接口。 */
  semaphoreStats(): { running: number; queued: number; max: number } {
    return this.semaphore?.stats() ?? { running: 0, queued: 0, max: 0 };
  }

  // ===== 公开入口：幂等缓存 + 信号量 =====
  async scrapeOrders(dto: ScrapeMeituanOrdersDto, opts?: { returnRecords?: boolean; returnFile?: boolean }): Promise<ScrapeSummary<MeituanOrderEntity>> {
    return this.runWithCache('orders', dto, () =>
      this.semaphore.run(() => this.doScrapeOrders(dto, opts)),
    );
  }

  async scrapeProducts(dto: ScrapeMeituanProductsDto, opts?: { returnRecords?: boolean; returnFile?: boolean }): Promise<ScrapeSummary<MeituanProductEntity>> {
    return this.runWithCache('products', dto, () =>
      this.semaphore.run(() => this.doScrapeProducts(dto, opts)),
    );
  }

  async scrapeReviews(dto: ScrapeMeituanReviewsDto, opts?: { returnRecords?: boolean; returnFile?: boolean }): Promise<ScrapeSummary<MeituanReviewEntity>> {
    return this.runWithCache('reviews', dto, () =>
      this.semaphore.run(() => this.doScrapeReviews(dto, opts)),
    );
  }

  async scrapePromotionCampaigns(dto: ScrapeMeituanPromotionCampaignsDto, opts?: { returnRecords?: boolean; returnFile?: boolean }): Promise<ScrapeSummary<MeituanPromotionCampaignEntity>> {
    return this.runWithCache('promotion-campaigns', dto, () =>
      this.semaphore.run(() => this.doScrapePromotionCampaigns(dto, opts)),
    );
  }

  async scrapePromotionStats(dto: ScrapeMeituanPromotionStatsDto, opts?: { returnRecords?: boolean; returnFile?: boolean }): Promise<ScrapeSummary<MeituanPromotionStatsEntity>> {
    return this.runWithCache('promotion-stats', dto, () =>
      this.semaphore.run(() => this.doScrapePromotionStats(dto, opts)),
    );
  }

  // ===== 实际抓取实现 =====
  private async doScrapeOrders(dto: ScrapeMeituanOrdersDto, opts?: { returnRecords?: boolean; returnFile?: boolean }): Promise<ScrapeSummary<MeituanOrderEntity>> {
    const start = Date.now();
    const accountId = dto.accountId || 'meituan-default';

    const lease = await this.pages.acquire(accountId);
    try {
      await this.ensureLogin(lease.page, accountId);

      const result = await this.ordersStrategy.run(lease.page, {
        startDate: dto.startDate,
        endDate: dto.endDate,
        status: dto.status,
        limit: dto.limit,
      }, { accountId });

      const entities: MeituanOrderEntity[] = result.map((item) => ({
        orderId: item.orderId,
        orderNo: item.orderNo,
        status: item.status,
        amount: item.amount,
        payAmount: item.payAmount,
        productName: item.productName,
        quantity: item.quantity,
        orderTime: item.orderTime,
        payTime: item.payTime,
        userNickname: item.userNickname,
        userPhone: item.userPhone,
        address: item.address,
        fetchedAt: item.fetchedAt,
        platform: 'meituan',
      })) as MeituanOrderEntity[];

      const writeResult = await this.writeResults('meituan-orders', entities as unknown as Record<string, unknown>[], opts);

      return {
        target: 'orders',
        file: writeResult.file,
        count: entities.length,
        durationMs: Date.now() - start,
        cached: false,
        preview: entities.slice(0, 5).map((e) => ({
          id: e.orderId,
          title: e.productName,
          brief: `¥${e.amount} | ${e.status}`,
        })),
        records: opts?.returnRecords ? (entities as unknown as MeituanOrderEntity[]) : undefined,
      };
    } finally {
      await lease.release();
    }
  }

  private async doScrapeProducts(dto: ScrapeMeituanProductsDto, opts?: { returnRecords?: boolean; returnFile?: boolean }): Promise<ScrapeSummary<MeituanProductEntity>> {
    const start = Date.now();
    const accountId = dto.accountId || 'meituan-default';

    const lease = await this.pages.acquire(accountId);
    try {
      await this.ensureLogin(lease.page, accountId);

      const result = await this.productsStrategy.run(lease.page, {
        category: dto.category,
        keyword: dto.keyword,
        limit: dto.limit,
      }, { accountId });

      const entities: MeituanProductEntity[] = result.map((item) => ({
        productId: item.productId,
        productName: item.productName,
        category: item.category,
        price: item.price,
        originalPrice: item.originalPrice,
        monthlySales: item.monthlySales,
        totalSales: item.totalSales,
        rating: item.rating,
        reviewCount: item.reviewCount,
        status: item.status,
        imageUrl: item.imageUrl,
        fetchedAt: item.fetchedAt,
        platform: 'meituan',
      })) as MeituanProductEntity[];

      const writeResult = await this.writeResults('meituan-products', entities as unknown as Record<string, unknown>[], opts);

      return {
        target: 'products',
        file: writeResult.file,
        count: entities.length,
        durationMs: Date.now() - start,
        cached: false,
        preview: entities.slice(0, 5).map((e) => ({
          id: e.productId,
          title: e.productName,
          brief: `¥${e.price} | 月售${e.monthlySales ?? '-'}`,
        })),
        records: opts?.returnRecords ? (entities as unknown as MeituanProductEntity[]) : undefined,
      };
    } finally {
      await lease.release();
    }
  }

  private async doScrapeReviews(dto: ScrapeMeituanReviewsDto, opts?: { returnRecords?: boolean; returnFile?: boolean }): Promise<ScrapeSummary<MeituanReviewEntity>> {
    const start = Date.now();
    const accountId = dto.accountId || 'meituan-default';

    const lease = await this.pages.acquire(accountId);
    try {
      await this.ensureLogin(lease.page, accountId);

      const result = await this.reviewsStrategy.run(lease.page, {
        productId: dto.productId,
        minRating: dto.rating,
        limit: dto.limit,
      }, { accountId });

      const entities: MeituanReviewEntity[] = result.map((item) => ({
        reviewId: item.reviewId,
        orderId: item.orderId,
        productId: item.productId,
        productName: item.productName,
        rating: item.rating,
        content: item.content,
        images: item.images,
        userNickname: item.userNickname,
        reviewTime: item.reviewTime,
        merchantReply: item.merchantReply,
        merchantReplyTime: item.merchantReplyTime,
        fetchedAt: item.fetchedAt,
        platform: 'meituan',
      })) as MeituanReviewEntity[];

      const writeResult = await this.writeResults('meituan-reviews', entities as unknown as Record<string, unknown>[], opts);

      return {
        target: 'reviews',
        file: writeResult.file,
        count: entities.length,
        durationMs: Date.now() - start,
        cached: false,
        preview: entities.slice(0, 5).map((e) => ({
          id: e.reviewId,
          title: e.productName,
          brief: `${e.rating}⭐ | ${e.content?.slice(0, 50) ?? ''}`,
        })),
        records: opts?.returnRecords ? (entities as unknown as MeituanReviewEntity[]) : undefined,
      };
    } finally {
      await lease.release();
    }
  }

  private async doScrapePromotionCampaigns(dto: ScrapeMeituanPromotionCampaignsDto, opts?: { returnRecords?: boolean; returnFile?: boolean }): Promise<ScrapeSummary<MeituanPromotionCampaignEntity>> {
    const start = Date.now();
    const accountId = dto.accountId || 'meituan-default';

    const lease = await this.pages.acquire(accountId);
    try {
      await this.ensureLogin(lease.page, accountId);

      const result = await this.promotionCampaignsStrategy.run(lease.page, {
        status: dto.status,
        campaignType: dto.campaignType,
        limit: dto.limit,
      }, { accountId });

      const entities: MeituanPromotionCampaignEntity[] = result.map((item) => ({
        campaignId: item.campaignId,
        campaignName: item.campaignName,
        campaignType: item.campaignType,
        status: item.status,
        budget: item.budget,
        spent: item.spent,
        startTime: item.startTime,
        endTime: item.endTime,
        impressions: item.impressions,
        clicks: item.clicks,
        ctr: item.ctr,
        cpc: item.cpc,
        conversions: item.conversions,
        costPerConversion: item.costPerConversion,
        productIds: item.productIds,
        fetchedAt: item.fetchedAt,
        platform: 'meituan',
      })) as MeituanPromotionCampaignEntity[];

      const writeResult = await this.writeResults('meituan-promotion-campaigns', entities as unknown as Record<string, unknown>[], opts);

      return {
        target: 'promotion-campaigns',
        file: writeResult.file,
        count: entities.length,
        durationMs: Date.now() - start,
        cached: false,
        preview: entities.slice(0, 5).map((e) => ({
          id: e.campaignId,
          title: e.campaignName,
          brief: `￥${e.spent} | ${e.status}`,
        })),
        records: opts?.returnRecords ? (entities as unknown as MeituanPromotionCampaignEntity[]) : undefined,
      };
    } finally {
      await lease.release();
    }
  }

  private async doScrapePromotionStats(dto: ScrapeMeituanPromotionStatsDto, opts?: { returnRecords?: boolean; returnFile?: boolean }): Promise<ScrapeSummary<MeituanPromotionStatsEntity>> {
    const start = Date.now();
    const accountId = dto.accountId || 'meituan-default';

    const lease = await this.pages.acquire(accountId);
    try {
      await this.ensureLogin(lease.page, accountId);

      const result = await this.promotionStatsStrategy.run(lease.page, {
        period: dto.period,
        startDate: dto.startDate,
        endDate: dto.endDate,
      }, { accountId });

      const entities: MeituanPromotionStatsEntity[] = result.map((item) => ({
        statsId: item.statsId,
        date: item.date,
        period: item.period,
        totalImpressions: item.totalImpressions,
        totalClicks: item.totalClicks,
        averageCtr: item.averageCtr,
        totalSpent: item.totalSpent,
        averageCpc: item.averageCpc,
        totalConversions: item.totalConversions,
        totalConversionCost: item.totalConversionCost,
        conversionRate: item.conversionRate,
        roi: item.roi,
        promotionOrders: item.promotionOrders,
        promotionRevenue: item.promotionRevenue,
        averageOrderValue: item.averageOrderValue,
        promotedProducts: item.promotedProducts,
        topProductId: item.topProductId,
        topProductName: item.topProductName,
        peakHours: item.peakHours,
        offPeakHours: item.offPeakHours,
        topCities: item.topCities,
        bestPerformingCity: item.bestPerformingCity,
        fetchedAt: item.fetchedAt,
        platform: 'meituan',
      })) as MeituanPromotionStatsEntity[];

      const writeResult = await this.writeResults('meituan-promotion-stats', entities as unknown as Record<string, unknown>[], opts);

      return {
        target: 'promotion-stats',
        file: writeResult.file,
        count: entities.length,
        durationMs: Date.now() - start,
        cached: false,
        preview: entities.slice(0, 5).map((e) => ({
          id: e.statsId,
          title: e.date,
          brief: `￥${e.totalSpent} | ROI ${e.roi ?? '-'}`,
        })),
        records: opts?.returnRecords ? (entities as unknown as MeituanPromotionStatsEntity[]) : undefined,
      };
    } finally {
      await lease.release();
    }
  }

  // ===== 辅助方法 =====

  private async ensureLogin(page: any, accountId: string): Promise<void> {
    // 先导航到美团经营宝页面
    const currentUrl = page.url();
    if (!currentUrl.includes('ecom.meituan.com')) {
      this.logger.log('正在打开美团经营宝...');
      await page.goto('https://ecom.meituan.com/', { 
        waitUntil: 'domcontentloaded',
        timeout: 30000 
      }).catch((err: any) => {
        this.logger.warn('导航到美团经营宝失败，但继续等待登录', err.message);
      });
      await randomSleep(1000, 2000);
    }

    // 智能检测登录状态（多种方式）
    const isLoggedIn = await this.checkMeituanLogin(page);

    if (!isLoggedIn) {
      this.logger.log(`美团未登录，等待手动登录 [accountId=${accountId}]`);
      this.logger.log('💡 提示：请在弹出的浏览器中登录美团经营宝');
      this.logger.log('💡 登录后系统会自动检测到并继续抓取');
      // 等待用户完成登录（最长 5 分钟）
      await this.waitForLogin(page, 300000);
    } else {
      this.logger.log('✅ 检测到美团已登录状态');
    }
  }

  private async checkMeituanLogin(page: any): Promise<boolean> {
    try {
      // 简化检测：只要 URL 在经营宝且不在登录页，就认为已登录
      const currentUrl = page.url();
      const isLoginPage = currentUrl.includes('login') || currentUrl.includes('passport');
      
      this.logger.log(`📍 当前 URL: ${currentUrl}`);
      
      if (!isLoginPage && currentUrl.includes('ecom.meituan.com')) {
        this.logger.log('✅ 已访问经营宝页面（非登录页），判定为已登录');
        return true;
      }

      this.logger.log('❌ 不在经营宝页面或在登录页');
      return false;
    } catch (error) {
      this.logger.warn('登录状态检测失败，假设未登录', error.message);
      return false;
    }
  }

  private async waitForLogin(page: any, timeoutMs: number): Promise<void> {
    const start = Date.now();
    let checkCount = 0;
    
    while (Date.now() - start < timeoutMs) {
      await randomSleep(2000, 3000);
      checkCount++;
      
      // 使用智能检测机制
      const isLoggedIn = await this.checkMeituanLogin(page);
      
      if (isLoggedIn) {
        this.logger.log(`✅ 美团登录成功（检测 ${checkCount} 次后成功）`);
        await randomSleep(1000, 2000);
        return;
      }
      
      // 每 5 次检查输出一次日志
      if (checkCount % 5 === 0) {
        const elapsed = Math.round((Date.now() - start) / 1000);
        this.logger.log(`⏳ 等待登录中... (${elapsed}s)`);
      }
    }
    
    throw new BusinessException(ErrorCode.LOGIN_TIMEOUT, '美团登录超时（5 分钟），请检查登录状态');
  }

  private async writeResults(
    type: string,
    records: Record<string, unknown>[],
    opts?: { returnRecords?: boolean; returnFile?: boolean },
  ): Promise<WriteResult> {
    if (!opts?.returnFile && !opts?.returnRecords) {
      return { file: '', count: 0 };
    }

    const target = type as any;
    return this.writer.append(target, records);
  }

  private async runWithCache<T>(
    target: string,
    dto: any,
    fn: () => Promise<T>,
  ): Promise<T> {
    // 如果禁用缓存，直接执行
    if ((dto as any).useCache === false) {
      return fn();
    }

    const cacheKey = this.buildCacheKey(target, dto);
    const cached = await this.cache.get<T>(cacheKey);

    if (cached) {
      this.logger.log(`cache hit: ${cacheKey}`);
      return cached;
    }

    const result = await fn();
    await this.cache.set(cacheKey, result);
    return result;
  }

  private buildCacheKey(target: string, dto: any): string {
    const sorted = Object.keys(dto)
      .sort()
      .map((k) => `${k}=${JSON.stringify(dto[k])}`)
      .join('&');
    return `meituan:${target}:${sorted}`;
  }
}
