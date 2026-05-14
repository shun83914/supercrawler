import { Injectable, Logger } from '@nestjs/common';
import type { Page, Response } from 'playwright-core';
import { randomSleep, scrollPage } from '../../common/utils/humanize.util';
import type { IScrapeStrategy, ScrapeContext } from './strategy.interface';

type AnyObj = Record<string, unknown>;

export interface OrdersInput {
  startDate?: string;
  endDate?: string;
  status?: string;
  limit?: number;
}

export interface OrderResultItem {
  orderId: string;
  orderNo?: string;
  status?: string;
  amount?: number;
  payAmount?: number;
  productName?: string;
  quantity?: number;
  orderTime?: string;
  payTime?: string;
  userNickname?: string;
  userPhone?: string;
  address?: string;
  fetchedAt: string;
  platform: 'meituan';
}

// 美团经营宝订单 API 特征
const ORDER_API_PATTERN = /(order\/list|api\/order|ecom\/order)/i;

@Injectable()
export class OrdersStrategy implements IScrapeStrategy<OrdersInput, OrderResultItem[]> {
  readonly name = 'orders';
  private readonly logger = new Logger(OrdersStrategy.name);

  async run(page: Page, input: OrdersInput, _ctx: ScrapeContext): Promise<OrderResultItem[]> {
    const url = 'https://ecom.meituan.com/meishi';

    // 拦截订单 API 响应
    const ordersByOrderId = new Map<string, AnyObj>();
    const onResponse = (resp: Response): void => {
      const u = resp.url();
      if (!ORDER_API_PATTERN.test(u)) return;
      const ct = resp.headers()['content-type'] ?? '';
      if (!ct.includes('json')) return;
      void resp
        .json()
        .then((json) => indexOrderById(json, ordersByOrderId))
        .catch(() => undefined);
    };
    page.on('response', onResponse);

    const targetLimit = input.limit ?? 50;

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle').catch(() => undefined);
      await randomSleep(1000, 2000);

      // 等待订单列表加载
      await page.waitForSelector('.order-list, [class*="order-item"]', { timeout: 10000 }).catch(() => {
        this.logger.warn('订单列表元素未找到，尝试等待');
      });
      await randomSleep(500, 1000);

      const collected = new Map<string, OrderResultItem>();
      let stagnant = 0;
      const maxRounds = 60;

      for (let round = 0; round < maxRounds && collected.size < targetLimit; round++) {
        const batch = await page.$$eval(
          '.order-list > div, [class*="order-item"], tr.order-row',
          (nodes) =>
            nodes.slice(0, 200).map((el) => {
              // 提取订单号
              const orderIdEl = el.querySelector('.order-id, [class*="order-id"], .order-no') as HTMLElement | null;
              const orderIdText = orderIdEl?.innerText ?? '';
              const orderIdMatch = orderIdText.match(/(\d+)/);
              const orderId = orderIdMatch?.[1] ?? '';

              // 提取商品名称
              const productEl = el.querySelector('.product-name, [class*="product"], .item-name') as HTMLElement | null;
              const productName = productEl?.innerText?.trim();

              // 提取金额
              const amountEl = el.querySelector('.amount, .price, [class*="amount"]') as HTMLElement | null;
              const amountText = amountEl?.innerText ?? '';
              const amountMatch = amountText.match(/([\d.]+)/);
              const amount = amountMatch ? parseFloat(amountMatch[1]) : undefined;

              // 提取状态
              const statusEl = el.querySelector('.status, .order-status, [class*="status"]') as HTMLElement | null;
              const status = statusEl?.innerText?.trim();

              // 提取时间
              const timeEl = el.querySelector('.order-time, .create-time, [class*="time"]') as HTMLElement | null;
              const orderTime = timeEl?.innerText?.trim();

              // 提取用户信息
              const userEl = el.querySelector('.user-info, .customer-name, [class*="user"]') as HTMLElement | null;
              const userNickname = userEl?.innerText?.trim();

              return {
                orderId,
                productName,
                amount,
                status,
                orderTime,
                userNickname,
              };
            }),
        );

        const prev = collected.size;
        for (const b of batch) {
          if (!b.orderId || collected.has(b.orderId)) continue;
          collected.set(b.orderId, {
            orderId: b.orderId,
            productName: b.productName,
            amount: b.amount,
            status: b.status,
            orderTime: b.orderTime,
            userNickname: b.userNickname,
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
      const enriched: OrderResultItem[] = [];
      for (const item of collected.values()) {
        const raw = ordersByOrderId.get(item.orderId);
        if (raw) mergeRawIntoOrder(item, raw);
        enriched.push(item);
      }

      // 应用日期过滤
      const filtered = applyFilters(enriched, input);
      this.logger.log(
        `[orders] collected=${enriched.length} filtered=${filtered.length} target=${targetLimit}`,
      );

      return filtered.slice(0, targetLimit);
    } finally {
      page.off('response', onResponse);
    }
  }
}

// ===== 辅助函数 =====

function indexOrderById(payload: unknown, sink: Map<string, AnyObj>, depth = 0): void {
  if (!payload || depth > 6) return;
  if (Array.isArray(payload)) {
    for (const v of payload) indexOrderById(v, sink, depth + 1);
    return;
  }
  if (typeof payload !== 'object') return;
  const obj = payload as AnyObj;

  // 查找订单 ID
  const orderId =
    typeof obj.orderId === 'string' ? obj.orderId :
    typeof obj.order_id === 'string' ? obj.order_id :
    typeof obj.id === 'string' && /^\d{10,}$/.test(obj.id) ? obj.id : undefined;

  if (orderId) {
    sink.set(orderId, obj);
  }

  // 递归搜索
  for (const key of Object.keys(obj)) {
    const v = obj[key];
    if (v && typeof v === 'object') indexOrderById(v, sink, depth + 1);
  }
}

function mergeRawIntoOrder(item: OrderResultItem, raw: AnyObj): void {
  // 补充订单号
  if (!item.orderNo) {
    item.orderNo = (raw.orderNo as string | undefined) ?? (raw.order_no as string | undefined);
  }

  // 补充支付金额
  if (!item.payAmount) {
    const payAmt = toNumber(raw.payAmount ?? raw.pay_amount ?? raw.amount);
    if (payAmt !== undefined) item.payAmount = payAmt;
  }

  // 补充数量
  if (!item.quantity) {
    item.quantity = toNumber(raw.quantity ?? raw.count ?? raw.num) ?? undefined;
  }

  // 补充支付时间
  if (!item.payTime) {
    const payTime = raw.payTime ?? raw.pay_time ?? raw.paymentTime ?? raw.payment_time;
    if (payTime) {
      item.payTime = typeof payTime === 'number' ? new Date(payTime).toISOString() : String(payTime);
    }
  }

  // 补充用户电话
  if (!item.userPhone) {
    item.userPhone = (raw.userPhone as string | undefined) ?? (raw.user_phone as string | undefined) ?? (raw.phone as string | undefined);
  }

  // 补充地址
  if (!item.address) {
    item.address = (raw.address as string | undefined) ?? (raw.userAddress as string | undefined) ?? (raw.user_address as string | undefined);
  }
}

function applyFilters(items: OrderResultItem[], input: OrdersInput): OrderResultItem[] {
  const startDate = input.startDate ? Date.parse(input.startDate) : undefined;
  const endDate = input.endDate ? Date.parse(input.endDate) : undefined;
  const status = input.status?.toLowerCase();

  return items.filter((it) => {
    // 日期过滤
    if (startDate && it.orderTime) {
      const orderTs = Date.parse(it.orderTime);
      if (Number.isNaN(orderTs) || orderTs < startDate) return false;
    }
    if (endDate && it.orderTime) {
      const orderTs = Date.parse(it.orderTime);
      if (Number.isNaN(orderTs) || orderTs > endDate) return false;
    }

    // 状态过滤
    if (status && it.status) {
      if (!it.status.toLowerCase().includes(status)) return false;
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
