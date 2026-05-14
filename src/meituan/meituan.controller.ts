import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import {
  ScrapeMeituanOrdersDto,
  ScrapeMeituanProductsDto,
  ScrapeMeituanReviewsDto,
  ScrapeMeituanPromotionCampaignsDto,
  ScrapeMeituanPromotionStatsDto,
} from './dto/scrape.dto';
import { MeituanService, ScrapeSummary } from './meituan.service';
import type { MeituanOrderEntity } from './entities/order.entity';
import type { MeituanProductEntity } from './entities/product.entity';
import type { MeituanReviewEntity } from './entities/review.entity';
import type { MeituanPromotionCampaignEntity } from './entities/promotion-campaign.entity';
import type { MeituanPromotionStatsEntity } from './entities/promotion-stats.entity';

@Controller('meituan')
export class MeituanController {
  constructor(private readonly meituanService: MeituanService) {}

  @Get('health')
  health(): { status: string; semaphore: { running: number; queued: number; max: number } } {
    return {
      status: 'ok',
      semaphore: this.meituanService.semaphoreStats(),
    };
  }

  // ===== 订单抓取 =====
  @Post('orders')
  async scrapeOrders(
    @Body() dto: ScrapeMeituanOrdersDto,
    @Query('returnRecords') returnRecords?: string,
    @Query('returnFile') returnFile?: string,
  ): Promise<ScrapeSummary<MeituanOrderEntity>> {
    return this.meituanService.scrapeOrders(dto, {
      returnRecords: returnRecords === 'true',
      returnFile: returnFile === 'true',
    });
  }

  // ===== 商品抓取 =====
  @Post('products')
  async scrapeProducts(
    @Body() dto: ScrapeMeituanProductsDto,
    @Query('returnRecords') returnRecords?: string,
    @Query('returnFile') returnFile?: string,
  ): Promise<ScrapeSummary<MeituanProductEntity>> {
    return this.meituanService.scrapeProducts(dto, {
      returnRecords: returnRecords === 'true',
      returnFile: returnFile === 'true',
    });
  }

  // ===== 评价抓取 =====
  @Post('reviews')
  async scrapeReviews(
    @Body() dto: ScrapeMeituanReviewsDto,
    @Query('returnRecords') returnRecords?: string,
    @Query('returnFile') returnFile?: string,
  ): Promise<ScrapeSummary<MeituanReviewEntity>> {
    return this.meituanService.scrapeReviews(dto, {
      returnRecords: returnRecords === 'true',
      returnFile: returnFile === 'true',
    });
  }

  // ===== 推广通活动抓取 =====
  @Post('promotion/campaigns')
  async scrapePromotionCampaigns(
    @Body() dto: ScrapeMeituanPromotionCampaignsDto,
    @Query('returnRecords') returnRecords?: string,
    @Query('returnFile') returnFile?: string,
  ): Promise<ScrapeSummary<MeituanPromotionCampaignEntity>> {
    return this.meituanService.scrapePromotionCampaigns(dto, {
      returnRecords: returnRecords === 'true',
      returnFile: returnFile === 'true',
    });
  }

  // ===== 推广数据统计抓取 =====
  @Post('promotion/stats')
  async scrapePromotionStats(
    @Body() dto: ScrapeMeituanPromotionStatsDto,
    @Query('returnRecords') returnRecords?: string,
    @Query('returnFile') returnFile?: string,
  ): Promise<ScrapeSummary<MeituanPromotionStatsEntity>> {
    return this.meituanService.scrapePromotionStats(dto, {
      returnRecords: returnRecords === 'true',
      returnFile: returnFile === 'true',
    });
  }
}
