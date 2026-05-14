import { Injectable, Logger } from '@nestjs/common';
import type { Page, Response } from 'playwright-core';
import { randomSleep, scrollPage } from '../../common/utils/humanize.util';
import type { IScrapeStrategy, ScrapeContext } from './strategy.interface';

type AnyObj = Record<string, unknown>;

export interface PromotionCampaignsInput {
  status?: string;
  campaignType?: string;
  limit?: number;
}

export interface PromotionCampaignResultItem {
  campaignId: string;
  campaignName: string;
  campaignType?: string;
  status?: string;
  budget?: number;
  spent?: number;
  startTime?: string;
  endTime?: string;
  impressions?: number;
  clicks?: number;
  ctr?: number;
  cpc?: number;
  conversions?: number;
  costPerConversion?: number;
  productIds?: string[];
  fetchedAt: string;
  platform: 'meituan';
}

// 美团推广通 API 特征
const PROMOTION_API_PATTERN = /(promotion\/campaign|api\/promotion|advert\/list|guangguang)/i;

@Injectable()
export class PromotionCampaignsStrategy implements IScrapeStrategy<PromotionCampaignsInput, PromotionCampaignResultItem[]> {
  readonly name = 'promotion-campaigns';
  private readonly logger = new Logger(PromotionCampaignsStrategy.name);

  async run(page: Page, input: PromotionCampaignsInput, _ctx: ScrapeContext): Promise<PromotionCampaignResultItem[]> {
    const url = 'https://ecom.meituan.com/meishi/promotion';

    // 拦截推广 API 响应
    const campaignsById = new Map<string, AnyObj>();
    const onResponse = (resp: Response): void => {
      const u = resp.url();
      if (!PROMOTION_API_PATTERN.test(u)) return;
      const ct = resp.headers()['content-type'] ?? '';
      if (!ct.includes('json')) return;
      void resp
        .json()
        .then((json) => indexCampaignById(json, campaignsById))
        .catch(() => undefined);
    };
    page.on('response', onResponse);

    const targetLimit = input.limit ?? 50;

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle').catch(() => undefined);
      await randomSleep(1000, 2000);

      // 等待推广列表加载
      await page.waitForSelector('.campaign-list, [class*="campaign-item"], .promotion-table', { timeout: 10000 }).catch(() => {
        this.logger.warn('推广列表元素未找到，尝试等待');
      });
      await randomSleep(500, 1000);

      const collected = new Map<string, PromotionCampaignResultItem>();
      let stagnant = 0;
      const maxRounds = 60;

      for (let round = 0; round < maxRounds && collected.size < targetLimit; round++) {
        const batch = await page.$$eval(
          '.campaign-list > div, [class*="campaign-item"], tr.promotion-row, .promotion-table tbody tr',
          (nodes) =>
            nodes.slice(0, 200).map((el) => {
              // 提取活动 ID
              const campaignIdEl = el.querySelector('.campaign-id, [class*="campaign-id"]') as HTMLElement | null;
              const campaignIdText = campaignIdEl?.innerText ?? '';
              const campaignIdMatch = campaignIdText.match(/(\d+)/);
              const campaignId = campaignIdMatch?.[1] ?? '';

              // 提取活动名称
              const nameEl = el.querySelector('.campaign-name, .name, .title') as HTMLElement | null;
              const campaignName = nameEl?.innerText?.trim() ?? 'Unknown';

              // 提取状态
              const statusEl = el.querySelector('.status, .campaign-status') as HTMLElement | null;
              const status = statusEl?.innerText?.trim();

              // 提取预算
              const budgetEl = el.querySelector('.budget, [class*="budget"]') as HTMLElement | null;
              const budgetText = budgetEl?.innerText ?? '';
              const budgetMatch = budgetText.match(/([\d.]+)/);
              const budget = budgetMatch ? parseFloat(budgetMatch[1]) : undefined;

              // 提取消耗
              const spentEl = el.querySelector('.spent, [class*="spent"], .cost') as HTMLElement | null;
              const spentText = spentEl?.innerText ?? '';
              const spentMatch = spentText.match(/([\d.]+)/);
              const spent = spentMatch ? parseFloat(spentMatch[1]) : undefined;

              // 提取展示/点击数据
              const impressionsEl = el.querySelector('.impressions, [class*="impression"]') as HTMLElement | null;
              const impressionsText = impressionsEl?.innerText ?? '';
              const impressionsMatch = impressionsText.match(/([\d,]+)/);
              const impressions = impressionsMatch ? parseInt(impressionsMatch[1].replace(/,/g, ''), 10) : undefined;

              const clicksEl = el.querySelector('.clicks, [class*="click"]') as HTMLElement | null;
              const clicksText = clicksEl?.innerText ?? '';
              const clicksMatch = clicksText.match(/([\d,]+)/);
              const clicks = clicksMatch ? parseInt(clicksMatch[1].replace(/,/g, ''), 10) : undefined;

              // 提取 CTR
              const ctrEl = el.querySelector('.ctr, [class*="ctr"]') as HTMLElement | null;
              const ctrText = ctrEl?.innerText ?? '';
              const ctrMatch = ctrText.match(/([\d.]+)/);
              const ctr = ctrMatch ? parseFloat(ctrMatch[1]) : undefined;

              // 提取 CPC
              const cpcEl = el.querySelector('.cpc, [class*="cpc"]') as HTMLElement | null;
              const cpcText = cpcEl?.innerText ?? '';
              const cpcMatch = cpcText.match(/([\d.]+)/);
              const cpc = cpcMatch ? parseFloat(cpcMatch[1]) : undefined;

              return {
                campaignId,
                campaignName,
                status,
                budget,
                spent,
                impressions,
                clicks,
                ctr,
                cpc,
              };
            }),
        );

        const prev = collected.size;
        for (const b of batch) {
          if (!b.campaignId || collected.has(b.campaignId)) continue;
          collected.set(b.campaignId, {
            campaignId: b.campaignId,
            campaignName: b.campaignName,
            status: b.status,
            budget: b.budget,
            spent: b.spent,
            impressions: b.impressions,
            clicks: b.clicks,
            ctr: b.ctr,
            cpc: b.cpc,
            fetchedAt: new Date().toISOString(),
            platform: 'meituan',
          });
          if (collected.size >= targetLimit) break;
        }

        if (collected.size === prev) {
          stagnant += 1;
          if (stagnant >= 3) break;
        } else {
          stagnant = 0;
        }

        await scrollPage(page, { steps: 1, stepDelayMs: [800, 1500] });
      }

      // 等待 API 响应 flush
      await randomSleep(300, 600);

      // 合并 API 数据补充字段
      const enriched: PromotionCampaignResultItem[] = [];
      for (const item of collected.values()) {
        const raw = campaignsById.get(item.campaignId);
        if (raw) mergeRawIntoCampaign(item, raw);
        enriched.push(item);
      }

      // 应用过滤
      const filtered = applyFilters(enriched, input);
      this.logger.log(
        `[promotion-campaigns] collected=${enriched.length} filtered=${filtered.length} target=${targetLimit}`,
      );

      return filtered.slice(0, targetLimit);
    } finally {
      page.off('response', onResponse);
    }
  }
}

// ===== 辅助函数 =====

function indexCampaignById(payload: unknown, sink: Map<string, AnyObj>, depth = 0): void {
  if (!payload || depth > 6) return;
  if (Array.isArray(payload)) {
    for (const v of payload) indexCampaignById(v, sink, depth + 1);
    return;
  }
  if (typeof payload !== 'object') return;
  const obj = payload as AnyObj;

  // 查找活动 ID
  const campaignId =
    typeof obj.campaignId === 'string' ? obj.campaignId :
    typeof obj.campaign_id === 'string' ? obj.campaign_id :
    typeof obj.id === 'string' && /^\d+$/.test(obj.id) ? obj.id : undefined;

  if (campaignId) {
    sink.set(campaignId, obj);
  }

  // 递归搜索
  for (const key of Object.keys(obj)) {
    const v = obj[key];
    if (v && typeof v === 'object') indexCampaignById(v, sink, depth + 1);
  }
}

function mergeRawIntoCampaign(item: PromotionCampaignResultItem, raw: AnyObj): void {
  // 补充活动类型
  if (!item.campaignType) {
    item.campaignType = (raw.campaignType ?? raw.campaign_type ?? raw.type) as string | undefined;
  }

  // 补充时间
  if (!item.startTime) {
    const start = raw.startTime ?? raw.start_time ?? raw.startDate ?? raw.start_date;
    if (start) {
      item.startTime = typeof start === 'number' ? new Date(start).toISOString() : String(start);
    }
  }
  if (!item.endTime) {
    const end = raw.endTime ?? raw.end_time ?? raw.endDate ?? raw.end_date;
    if (end) {
      item.endTime = typeof end === 'number' ? new Date(end).toISOString() : String(end);
    }
  }

  // 补充转化数据
  if (!item.conversions) {
    item.conversions = toNumber(raw.conversions ?? raw.conversion_count ?? raw.convertCount);
  }
  if (!item.costPerConversion) {
    item.costPerConversion = toNumber(raw.costPerConversion ?? raw.cost_per_conversion ?? raw.cpa);
  }

  // 补充关联商品
  if (!item.productIds) {
    const products = raw.productIds ?? raw.product_ids ?? raw.products;
    if (Array.isArray(products)) {
      item.productIds = products.map((p: any) => typeof p === 'string' ? p : String(p.productId ?? p.product_id ?? p.id)).filter(Boolean);
    }
  }
}

function applyFilters(items: PromotionCampaignResultItem[], input: PromotionCampaignsInput): PromotionCampaignResultItem[] {
  const status = input.status?.toLowerCase();
  const campaignType = input.campaignType?.toLowerCase();

  return items.filter((it) => {
    // 状态过滤
    if (status && it.status) {
      if (!it.status.toLowerCase().includes(status)) return false;
    }
    // 类型过滤
    if (campaignType && it.campaignType) {
      if (!it.campaignType.toLowerCase().includes(campaignType)) return false;
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
