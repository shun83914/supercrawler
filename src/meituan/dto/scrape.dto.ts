import {
  IsArray,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * 抓取响应选项（通用）
 */
export class MeituanScrapeResponseOptions {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2000)
  @Type(() => Number)
  limit?: number;

  @IsOptional()
  @IsString()
  @Matches(/^[\w.-]{1,64}$/)
  accountId?: string;
}

/**
 * 订单抓取 DTO
 */
export class ScrapeMeituanOrdersDto extends MeituanScrapeResponseOptions {
  @IsOptional()
  @IsISO8601()
  startDate?: string;

  @IsOptional()
  @IsISO8601()
  endDate?: string;

  @IsOptional()
  @IsString()
  status?: string;
}

/**
 * 商品抓取 DTO
 */
export class ScrapeMeituanProductsDto extends MeituanScrapeResponseOptions {
  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  keyword?: string;
}

/**
 * 评价抓取 DTO
 */
export class ScrapeMeituanReviewsDto extends MeituanScrapeResponseOptions {
  @IsString()
  productId!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  @Type(() => Number)
  rating?: number;
}

/**
 * 批量任务 DTO
 */
export class MeituanScrapeBatchDto extends MeituanScrapeResponseOptions {
  @IsArray()
  @IsOptional()
  tasks?: Array<{
    type: 'orders' | 'products' | 'reviews' | 'promotion-campaigns' | 'promotion-stats';
    id?: string;
    limit?: number;
    startDate?: string;
    endDate?: string;
    status?: string;
    category?: string;
    keyword?: string;
    rating?: number;
    period?: string;
  }>;
}

/**
 * 推广通活动抓取 DTO
 */
export class ScrapeMeituanPromotionCampaignsDto extends MeituanScrapeResponseOptions {
  @IsOptional()
  @IsString()
  status?: string; // running/paused/expired

  @IsOptional()
  @IsString()
  campaignType?: string;
}

/**
 * 推广数据统计抓取 DTO
 */
export class ScrapeMeituanPromotionStatsDto extends MeituanScrapeResponseOptions {
  @IsOptional()
  @IsString()
  period?: string; // day/week/month

  @IsOptional()
  @IsISO8601()
  startDate?: string;

  @IsOptional()
  @IsISO8601()
  endDate?: string;
}
