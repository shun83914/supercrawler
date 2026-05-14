import { Injectable, Logger } from '@nestjs/common';
import type { Page, Response } from 'playwright-core';
import { randomSleep, scrollPage } from '../../common/utils/humanize.util';
import type { IScrapeStrategy, ScrapeContext } from './strategy.interface';

type AnyObj = Record<string, unknown>;

export interface ProductsInput {
  category?: string;
  keyword?: string;
  limit?: number;
}

export interface ProductResultItem {
  productId: string;
  productName: string;
  category?: string;
  price?: number;
  originalPrice?: number;
  monthlySales?: number;
  totalSales?: number;
  rating?: number;
  reviewCount?: number;
  status?: string;
  imageUrl?: string;
  fetchedAt: string;
  platform: 'meituan';
}

// 美团商品 API 特征
const PRODUCT_API_PATTERN = /(product\/list|api\/product|goods\/list|item\/detail)/i;

@Injectable()
export class ProductsStrategy implements IScrapeStrategy<ProductsInput, ProductResultItem[]> {
  readonly name = 'products';
  private readonly logger = new Logger(ProductsStrategy.name);

  async run(page: Page, input: ProductsInput, _ctx: ScrapeContext): Promise<ProductResultItem[]> {
    const baseUrl = 'https://ecom.meituan.com/meishi';
    const url = input.category
      ? `${baseUrl}?category=${encodeURIComponent(input.category)}`
      : baseUrl;

    // 拦截商品 API 响应
    const productsByProductId = new Map<string, AnyObj>();
    const onResponse = (resp: Response): void => {
      const u = resp.url();
      if (!PRODUCT_API_PATTERN.test(u)) return;
      const ct = resp.headers()['content-type'] ?? '';
      if (!ct.includes('json')) return;
      void resp
        .json()
        .then((json) => indexProductById(json, productsByProductId))
        .catch(() => undefined);
    };
    page.on('response', onResponse);

    const targetLimit = input.limit ?? 50;

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle').catch(() => undefined);
      await randomSleep(1000, 2000);

      // 等待商品列表加载
      await page.waitForSelector('.product-list, [class*="product-item"], .goods-list', { timeout: 10000 }).catch(() => {
        this.logger.warn('商品列表元素未找到，尝试等待');
      });
      await randomSleep(500, 1000);

      const collected = new Map<string, ProductResultItem>();
      let stagnant = 0;
      const maxRounds = 60;

      for (let round = 0; round < maxRounds && collected.size < targetLimit; round++) {
        const batch = await page.$$eval(
          '.product-list > div, [class*="product-item"], .goods-item, tr.product-row',
          (nodes) =>
            nodes.slice(0, 200).map((el) => {
              // 提取商品 ID
              const productIdEl = el.querySelector('.product-id, [class*="product-id"]') as HTMLElement | null;
              const productIdText = productIdEl?.innerText ?? '';
              const productIdMatch = productIdText.match(/(\d+)/);
              const productId = productIdMatch?.[1] ?? '';

              // 如果 DOM 中没有 ID，尝试从链接中提取
              if (!productId) {
                const linkEl = el.querySelector('a[href*="/product/"], a[href*="/item/"]') as HTMLAnchorElement | null;
                const href = linkEl?.getAttribute('href') ?? '';
                const hrefMatch = href.match(/\/product\/(\d+)|\/item\/(\d+)/);
                const idFromHref = hrefMatch?.[1] ?? hrefMatch?.[2] ?? '';
                if (idFromHref) {
                  (el as any)._productId = idFromHref;
                }
              }

              // 提取商品名称
              const nameEl = el.querySelector('.product-name, .item-name, .title, .name') as HTMLElement | null;
              const productName = nameEl?.innerText?.trim() ?? 'Unknown';

              // 提取价格
              const priceEl = el.querySelector('.price, .current-price, [class*="price"]') as HTMLElement | null;
              const priceText = priceEl?.innerText ?? '';
              const priceMatch = priceText.match(/¥\s*([\d.]+)/);
              const price = priceMatch ? parseFloat(priceMatch[1]) : undefined;

              // 提取原价
              const originalPriceEl = el.querySelector('.original-price, [class*="original"]') as HTMLElement | null;
              const originalPriceText = originalPriceEl?.innerText ?? '';
              const originalPriceMatch = originalPriceText.match(/¥\s*([\d.]+)/);
              const originalPrice = originalPriceMatch ? parseFloat(originalPriceMatch[1]) : undefined;

              // 提取月销量
              const monthlySalesEl = el.querySelector('.monthly-sales, .month-sale, [class*="monthly"]') as HTMLElement | null;
              const monthlySalesText = monthlySalesEl?.innerText ?? '';
              const monthlySalesMatch = monthlySalesText.match(/(\d+)/);
              const monthlySales = monthlySalesMatch ? parseInt(monthlySalesMatch[1], 10) : undefined;

              // 提取评分
              const ratingEl = el.querySelector('.rating, .score, .stars') as HTMLElement | null;
              const ratingText = ratingEl?.innerText ?? '';
              const ratingMatch = ratingText.match(/([\d.]+)/);
              const rating = ratingMatch ? parseFloat(ratingMatch[1]) : undefined;

              // 提取图片
              const imgEl = el.querySelector('img') as HTMLImageElement | null;
              const imageUrl = imgEl?.src;

              // 提取状态
              const statusEl = el.querySelector('.status, .product-status') as HTMLElement | null;
              const status = statusEl?.innerText?.trim();

              const finalProductId = (el as any)._productId || productId;

              return {
                productId: finalProductId,
                productName,
                price,
                originalPrice,
                monthlySales,
                rating,
                imageUrl,
                status,
              };
            }),
        );

        const prev = collected.size;
        for (const b of batch) {
          if (!b.productId || collected.has(b.productId)) continue;
          collected.set(b.productId, {
            productId: b.productId,
            productName: b.productName,
            price: b.price,
            originalPrice: b.originalPrice,
            monthlySales: b.monthlySales,
            rating: b.rating,
            imageUrl: b.imageUrl,
            status: b.status,
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
      const enriched: ProductResultItem[] = [];
      for (const item of collected.values()) {
        const raw = productsByProductId.get(item.productId);
        if (raw) mergeRawIntoProduct(item, raw);
        enriched.push(item);
      }

      // 关键词过滤
      const filtered = applyFilters(enriched, input);
      this.logger.log(
        `[products] collected=${enriched.length} filtered=${filtered.length} target=${targetLimit}`,
      );

      return filtered.slice(0, targetLimit);
    } finally {
      page.off('response', onResponse);
    }
  }
}

// ===== 辅助函数 =====

function indexProductById(payload: unknown, sink: Map<string, AnyObj>, depth = 0): void {
  if (!payload || depth > 6) return;
  if (Array.isArray(payload)) {
    for (const v of payload) indexProductById(v, sink, depth + 1);
    return;
  }
  if (typeof payload !== 'object') return;
  const obj = payload as AnyObj;

  // 查找商品 ID
  const productId =
    typeof obj.productId === 'string' ? obj.productId :
    typeof obj.product_id === 'string' ? obj.product_id :
    typeof obj.goodsId === 'string' ? obj.goodsId :
    typeof obj.goods_id === 'string' ? obj.goods_id :
    typeof obj.id === 'string' && /^\d+$/.test(obj.id) ? obj.id : undefined;

  if (productId) {
    sink.set(productId, obj);
  }

  // 递归搜索
  for (const key of Object.keys(obj)) {
    const v = obj[key];
    if (v && typeof v === 'object') indexProductById(v, sink, depth + 1);
  }
}

function mergeRawIntoProduct(item: ProductResultItem, raw: AnyObj): void {
  // 补充分类
  if (!item.category) {
    item.category = (raw.category ?? raw.categoryName ?? raw.category_name) as string | undefined;
  }

  // 补充总销量
  if (!item.totalSales) {
    item.totalSales = toNumber(raw.totalSales ?? raw.total_sales ?? raw.sales ?? raw.saleCount);
  }

  // 补充评价数
  if (!item.reviewCount) {
    item.reviewCount = toNumber(raw.reviewCount ?? raw.review_count ?? raw.commentCount ?? raw.comment_count);
  }
}

function applyFilters(items: ProductResultItem[], input: ProductsInput): ProductResultItem[] {
  const keyword = input.keyword?.toLowerCase();

  if (!keyword) return items;

  return items.filter((it) => {
    if (it.productName?.toLowerCase().includes(keyword)) return true;
    if (it.category?.toLowerCase().includes(keyword)) return true;
    return false;
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
