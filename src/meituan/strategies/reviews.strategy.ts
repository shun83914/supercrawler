import { Injectable, Logger } from '@nestjs/common';
import type { Page, Response } from 'playwright-core';
import { randomSleep, scrollPage } from '../../common/utils/humanize.util';
import type { IScrapeStrategy, ScrapeContext } from './strategy.interface';

type AnyObj = Record<string, unknown>;

export interface ReviewsInput {
  productId: string;
  minRating?: number;
  limit?: number;
}

export interface ReviewResultItem {
  reviewId: string;
  orderId?: string;
  productId?: string;
  productName?: string;
  rating?: number;
  content?: string;
  images?: string[];
  userNickname?: string;
  reviewTime?: string;
  merchantReply?: string;
  merchantReplyTime?: string;
  fetchedAt: string;
  platform: 'meituan';
}

// 美团评价 API 特征
const REVIEW_API_PATTERN = /(review\/list|comment\/list|api\/review|api\/comment|evaluate)/i;

@Injectable()
export class ReviewsStrategy implements IScrapeStrategy<ReviewsInput, ReviewResultItem[]> {
  readonly name = 'reviews';
  private readonly logger = new Logger(ReviewsStrategy.name);

  async run(page: Page, input: ReviewsInput, _ctx: ScrapeContext): Promise<ReviewResultItem[]> {
    const url = `https://ecom.meituan.com/meishi/product/${input.productId}`;

    // 拦截评价 API 响应
    const reviewsByReviewId = new Map<string, AnyObj>();
    const onResponse = (resp: Response): void => {
      const u = resp.url();
      if (!REVIEW_API_PATTERN.test(u)) return;
      const ct = resp.headers()['content-type'] ?? '';
      if (!ct.includes('json')) return;
      void resp
        .json()
        .then((json) => indexReviewById(json, reviewsByReviewId))
        .catch(() => undefined);
    };
    page.on('response', onResponse);

    const targetLimit = input.limit ?? 50;

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle').catch(() => undefined);
      await randomSleep(1000, 2000);

      // 切换到评价标签页
      await page.click('.review-tab, .comment-tab, [class*="review-tab"], [class*="comment-tab"]').catch(async () => {
        this.logger.warn('评价标签页按钮未找到，尝试继续');
      });
      await randomSleep(800, 1500);

      // 等待评价列表加载
      await page.waitForSelector('.review-list, .comment-list, [class*="review-item"], [class*="comment-item"]', { timeout: 10000 }).catch(() => {
        this.logger.warn('评价列表元素未找到，尝试等待');
      });
      await randomSleep(500, 1000);

      const collected = new Map<string, ReviewResultItem>();
      let stagnant = 0;
      const maxRounds = 60;

      for (let round = 0; round < maxRounds && collected.size < targetLimit; round++) {
        const batch = await page.$$eval(
          '.review-list > div, .comment-list > div, [class*="review-item"], [class*="comment-item"]',
          (nodes) =>
            nodes.slice(0, 200).map((el) => {
              // 提取评价 ID
              const reviewIdEl = el.querySelector('.review-id, [class*="review-id"]') as HTMLElement | null;
              const reviewIdText = reviewIdEl?.innerText ?? '';
              const reviewIdMatch = reviewIdText.match(/(\d+)/);
              const reviewId = reviewIdMatch?.[1] ?? `rev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

              // 提取评分
              const ratingEl = el.querySelector('.rating, .stars, .score, [class*="rating"]') as HTMLElement | null;
              const ratingText = ratingEl?.innerText ?? '';
              const ratingMatch = ratingText.match(/([\d.]+)/);
              const rating = ratingMatch ? parseFloat(ratingMatch[1]) : undefined;

              // 提取内容
              const contentEl = el.querySelector('.content, .review-content, .comment-content, .text') as HTMLElement | null;
              const content = contentEl?.innerText?.trim();

              // 提取用户昵称
              const userEl = el.querySelector('.user-name, .nickname, .author') as HTMLElement | null;
              const userNickname = userEl?.innerText?.trim();

              // 提取时间
              const timeEl = el.querySelector('.time, .review-time, .comment-time') as HTMLElement | null;
              const reviewTime = timeEl?.innerText?.trim();

              // 提取图片
              const imgEls = el.querySelectorAll('.images img, .review-images img, [class*="image"] img');
              const images = Array.from(imgEls).map((img) => (img as HTMLImageElement).src).filter(Boolean);

              // 提取商家回复
              const replyEl = el.querySelector('.merchant-reply, .reply, .response') as HTMLElement | null;
              const merchantReply = replyEl?.innerText?.trim();

              return {
                reviewId,
                rating,
                content,
                userNickname,
                reviewTime,
                images,
                merchantReply,
              };
            }),
        );

        const prev = collected.size;
        for (const b of batch) {
          if (collected.has(b.reviewId)) continue;
          collected.set(b.reviewId, {
            reviewId: b.reviewId,
            productId: input.productId,
            rating: b.rating,
            content: b.content,
            userNickname: b.userNickname,
            reviewTime: b.reviewTime,
            images: b.images,
            merchantReply: b.merchantReply,
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
      const enriched: ReviewResultItem[] = [];
      for (const item of collected.values()) {
        const raw = reviewsByReviewId.get(item.reviewId);
        if (raw) mergeRawIntoReview(item, raw);
        enriched.push(item);
      }

      // 应用评分过滤
      const filtered = applyFilters(enriched, input);
      this.logger.log(
        `[reviews:productId=${input.productId}] collected=${enriched.length} filtered=${filtered.length} target=${targetLimit}`,
      );

      return filtered.slice(0, targetLimit);
    } finally {
      page.off('response', onResponse);
    }
  }
}

// ===== 辅助函数 =====

function indexReviewById(payload: unknown, sink: Map<string, AnyObj>, depth = 0): void {
  if (!payload || depth > 6) return;
  if (Array.isArray(payload)) {
    for (const v of payload) indexReviewById(v, sink, depth + 1);
    return;
  }
  if (typeof payload !== 'object') return;
  const obj = payload as AnyObj;

  // 查找评价 ID
  const reviewId =
    typeof obj.reviewId === 'string' ? obj.reviewId :
    typeof obj.review_id === 'string' ? obj.review_id :
    typeof obj.commentId === 'string' ? obj.commentId :
    typeof obj.comment_id === 'string' ? obj.comment_id :
    typeof obj.id === 'string' && /^\d+$/.test(obj.id) ? obj.id : undefined;

  if (reviewId) {
    sink.set(reviewId, obj);
  }

  // 递归搜索
  for (const key of Object.keys(obj)) {
    const v = obj[key];
    if (v && typeof v === 'object') indexReviewById(v, sink, depth + 1);
  }
}

function mergeRawIntoReview(item: ReviewResultItem, raw: AnyObj): void {
  // 补充订单 ID
  if (!item.orderId) {
    item.orderId = (raw.orderId ?? raw.order_id) as string | undefined;
  }

  // 补充商品名称
  if (!item.productName) {
    item.productName = (raw.productName ?? raw.product_name ?? raw.itemName ?? raw.item_name) as string | undefined;
  }

  // 补充评分
  if (!item.rating) {
    const rating = toNumber(raw.rating ?? raw.score ?? raw.star ?? raw.stars);
    if (rating !== undefined) item.rating = rating;
  }

  // 补充商家回复时间
  if (item.merchantReply && !item.merchantReplyTime) {
    const replyTime = raw.merchantReplyTime ?? raw.merchant_reply_time ?? raw.replyTime ?? raw.reply_time;
    if (replyTime) {
      item.merchantReplyTime = typeof replyTime === 'number' ? new Date(replyTime).toISOString() : String(replyTime);
    }
  }
}

function applyFilters(items: ReviewResultItem[], input: ReviewsInput): ReviewResultItem[] {
  const minRating = input.minRating;

  if (!minRating) return items;

  return items.filter((it) => {
    if (it.rating === undefined || it.rating < minRating) return false;
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
