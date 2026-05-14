import { Injectable, Logger } from '@nestjs/common';
import type { Page, Response } from 'playwright-core';
import { randomSleep } from '../../common/utils/humanize.util';
import type { IScrapeStrategy, ScrapeContext } from './strategy.interface';

type AnyObj = Record<string, unknown>;

export interface PromotionStatsInput {
  period?: string; // day/week/month
  startDate?: string;
  endDate?: string;
}

export interface PromotionStatsResultItem {
  statsId: string;
  date?: string;
  period?: string;
  totalImpressions?: number;
  totalClicks?: number;
  averageCtr?: number;
  totalSpent?: number;
  averageCpc?: number;
  totalConversions?: number;
  totalConversionCost?: number;
  conversionRate?: number;
  roi?: number;
  promotionOrders?: number;
  promotionRevenue?: number;
  averageOrderValue?: number;
  promotedProducts?: number;
  topProductId?: string;
  topProductName?: string;
  peakHours?: string[];
  offPeakHours?: string[];
  topCities?: string[];
  bestPerformingCity?: string;
  fetchedAt: string;
  platform: 'meituan';
}

// 美团推广数据统计 API 特征
const PROMOTION_STATS_API_PATTERN = /(promotion\/stats|api\/promotion\/data|advert\/report|analytics)/i;

@Injectable()
export class PromotionStatsStrategy implements IScrapeStrategy<PromotionStatsInput, PromotionStatsResultItem[]> {
  readonly name = 'promotion-stats';
  private readonly logger = new Logger(PromotionStatsStrategy.name);

  async run(page: Page, input: PromotionStatsInput, _ctx: ScrapeContext): Promise<PromotionStatsResultItem[]> {
    const url = 'https://ecom.meituan.com/meishi/promotion/stats';

    // 拦截推广统计 API 响应
    const statsById = new Map<string, AnyObj>();
    const onResponse = (resp: Response): void => {
      const u = resp.url();
      if (!PROMOTION_STATS_API_PATTERN.test(u)) return;
      const ct = resp.headers()['content-type'] ?? '';
      if (!ct.includes('json')) return;
      void resp
        .json()
        .then((json) => indexStatsById(json, statsById))
        .catch(() => undefined);
    };
    page.on('response', onResponse);

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle').catch(() => undefined);
      await randomSleep(1000, 2000);

      // 等待统计数据加载
      await page.waitForSelector('.stats-panel, [class*="stats"], .analytics-dashboard', { timeout: 10000 }).catch(() => {
        this.logger.warn('统计数据元素未找到，尝试等待');
      });
      await randomSleep(500, 1000);

      // 选择时间周期
      if (input.period) {
        const periodTab = input.period === 'day' ? '.day-tab' : 
                         input.period === 'week' ? '.week-tab' : 
                         input.period === 'month' ? '.month-tab' : null;
        if (periodTab) {
          await page.click(periodTab).catch(() => {
            this.logger.warn(`周期标签 ${input.period} 未找到`);
          });
          await randomSleep(500, 1000);
        }
      }

      // 从 DOM 提取统计数据
      const statsData = await page.evaluate(() => {
        const panels = document.querySelectorAll('.stats-panel, [class*="stats-card"], .data-card');
        if (!panels || panels.length === 0) return null;

        const result: Array<Record<string, unknown>> = [];

        panels.forEach((panel) => {
          const data: Record<string, unknown> = {};

          // 提取日期
          const dateEl = panel.querySelector('.date, .stats-date, [class*="date"]');
          if (dateEl) data.date = dateEl.textContent?.trim();

          // 提取各项指标
          const metrics = panel.querySelectorAll('.metric, .stat-item, .data-item');
          metrics.forEach((metric) => {
            const label = (metric.querySelector('.label, .metric-label') as HTMLElement)?.textContent?.trim();
            const value = (metric.querySelector('.value, .metric-value') as HTMLElement)?.textContent?.trim();
            
            if (label && value) {
              const numMatch = value.match(/([\d.]+)/);
              const numValue = numMatch ? parseFloat(numMatch[1]) : undefined;
              
              // 映射常见指标
              if (label.includes('展示') || label.includes('impress')) data.totalImpressions = numValue;
              else if (label.includes('点击') && !label.includes('成本')) data.totalClicks = numValue;
              else if (label.includes('CTR') || label.includes('点击率')) data.averageCtr = numValue;
              else if (label.includes('消耗') || label.includes('spent')) data.totalSpent = numValue;
              else if (label.includes('CPC') || label.includes('点击成本')) data.averageCpc = numValue;
              else if (label.includes('转化')) data.totalConversions = numValue;
              else if (label.includes('转化成本') || label.includes('CPA')) data.totalConversionCost = numValue;
              else if (label.includes('转化率')) data.conversionRate = numValue;
              else if (label.includes('ROI') || label.includes('投产')) data.roi = numValue;
              else if (label.includes('订单')) data.promotionOrders = numValue;
              else if (label.includes('交易额') || label.includes('GMV')) data.promotionRevenue = numValue;
              else if (label.includes('客单价')) data.averageOrderValue = numValue;
            }
          });

          if (Object.keys(data).length > 0) {
            result.push(data);
          }
        });

        return result.length > 0 ? result : null;
      });

      await randomSleep(300, 600);

      const results: PromotionStatsResultItem[] = [];

      if (statsData && Array.isArray(statsData)) {
        for (const data of statsData) {
          const statsId = `stats_${data.date || Date.now()}`;
          const item: PromotionStatsResultItem = {
            statsId,
            date: data.date as string | undefined,
            period: input.period || 'day',
            totalImpressions: data.totalImpressions as number | undefined,
            totalClicks: data.totalClicks as number | undefined,
            averageCtr: data.averageCtr as number | undefined,
            totalSpent: data.totalSpent as number | undefined,
            averageCpc: data.averageCpc as number | undefined,
            totalConversions: data.totalConversions as number | undefined,
            totalConversionCost: data.totalConversionCost as number | undefined,
            conversionRate: data.conversionRate as number | undefined,
            roi: data.roi as number | undefined,
            promotionOrders: data.promotionOrders as number | undefined,
            promotionRevenue: data.promotionRevenue as number | undefined,
            averageOrderValue: data.averageOrderValue as number | undefined,
            fetchedAt: new Date().toISOString(),
            platform: 'meituan',
          };

          // 合并 API 数据
          const raw = statsById.get(statsId);
          if (raw) mergeRawIntoStats(item, raw);

          results.push(item);
        }
      }

      // 如果没有从 DOM 拿到数据，尝试从 API 响应中构建
      if (results.length === 0 && statsById.size > 0) {
        for (const [id, raw] of statsById.entries()) {
          const item: PromotionStatsResultItem = {
            statsId: id,
            period: input.period || 'day',
            fetchedAt: new Date().toISOString(),
            platform: 'meituan',
          };
          mergeRawIntoStats(item, raw);
          results.push(item);
        }
      }

      this.logger.log(
        `[promotion-stats] collected=${results.length} period=${input.period || 'all'}`,
      );

      return results;
    } finally {
      page.off('response', onResponse);
    }
  }
}

// ===== 辅助函数 =====

function indexStatsById(payload: unknown, sink: Map<string, AnyObj>, depth = 0): void {
  if (!payload || depth > 6) return;
  if (Array.isArray(payload)) {
    for (const v of payload) indexStatsById(v, sink, depth + 1);
    return;
  }
  if (typeof payload !== 'object') return;
  const obj = payload as AnyObj;

  // 查找统计 ID（通常是日期）
  const statsId =
    typeof obj.statsId === 'string' ? obj.statsId :
    typeof obj.stats_id === 'string' ? obj.stats_id :
    typeof obj.date === 'string' ? `stats_${obj.date}` :
    typeof obj.reportDate === 'string' ? `stats_${obj.reportDate}` : undefined;

  if (statsId) {
    sink.set(statsId, obj);
  }

  // 递归搜索
  for (const key of Object.keys(obj)) {
    const v = obj[key];
    if (v && typeof v === 'object') indexStatsById(v, sink, depth + 1);
  }
}

function mergeRawIntoStats(item: PromotionStatsResultItem, raw: AnyObj): void {
  // 补充日期
  if (!item.date) {
    item.date = (raw.date ?? raw.reportDate ?? raw.report_date ?? raw.statsDate) as string | undefined;
  }

  // 补充各项指标
  const mappings: Array<[string, (val: any) => void]> = [
    ['totalImpressions', (v: any) => { if (!item.totalImpressions) item.totalImpressions = toNumber(v); }],
    ['totalClicks', (v: any) => { if (!item.totalClicks) item.totalClicks = toNumber(v); }],
    ['averageCtr', (v: any) => { if (!item.averageCtr) item.averageCtr = toNumber(v); }],
    ['totalSpent', (v: any) => { if (!item.totalSpent) item.totalSpent = toNumber(v); }],
    ['averageCpc', (v: any) => { if (!item.averageCpc) item.averageCpc = toNumber(v); }],
    ['totalConversions', (v: any) => { if (!item.totalConversions) item.totalConversions = toNumber(v); }],
    ['totalConversionCost', (v: any) => { if (!item.totalConversionCost) item.totalConversionCost = toNumber(v); }],
    ['conversionRate', (v: any) => { if (!item.conversionRate) item.conversionRate = toNumber(v); }],
    ['roi', (v: any) => { if (!item.roi) item.roi = toNumber(v); }],
    ['promotionOrders', (v: any) => { if (!item.promotionOrders) item.promotionOrders = toNumber(v); }],
    ['promotionRevenue', (v: any) => { if (!item.promotionRevenue) item.promotionRevenue = toNumber(v); }],
    ['averageOrderValue', (v: any) => { if (!item.averageOrderValue) item.averageOrderValue = toNumber(v); }],
    ['promotedProducts', (v: any) => { if (!item.promotedProducts) item.promotedProducts = toNumber(v); }],
  ];

  for (const [field, setter] of mappings) {
    const value = raw[field] ?? raw[snakeToCamel(field)] ?? raw[camelToSnake(field)];
    if (value !== undefined) setter(value);
  }

  // 补充商品和地域信息
  if (!item.topProductId) {
    item.topProductId = (raw.topProductId ?? raw.top_product_id ?? raw.bestProductId) as string | undefined;
  }
  if (!item.topProductName) {
    item.topProductName = (raw.topProductName ?? raw.top_product_name ?? raw.bestProductName) as string | undefined;
  }
  if (!item.bestPerformingCity) {
    item.bestPerformingCity = (raw.bestCity ?? raw.best_performing_city ?? raw.topCity) as string | undefined;
  }

  // 补充时段和城市列表
  if (!item.peakHours && Array.isArray(raw.peakHours ?? raw.peak_hours)) {
    item.peakHours = (raw.peakHours ?? raw.peak_hours) as string[];
  }
  if (!item.topCities && Array.isArray(raw.topCities ?? raw.top_cities)) {
    item.topCities = (raw.topCities ?? raw.top_cities) as string[];
  }
}

function toNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}
