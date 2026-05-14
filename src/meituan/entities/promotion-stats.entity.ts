/**
 * 美团推广数据统计实体
 */
export interface MeituanPromotionStatsEntity {
  /** 统计 ID（日期维度） */
  statsId: string;
  /** 统计日期 */
  date?: string;
  /** 统计周期：day/week/month/custom */
  period?: string;
  
  // ===== 推广概览 =====
  /** 总展示次数 */
  totalImpressions?: number;
  /** 总点击次数 */
  totalClicks?: number;
  /** 总点击率（%） */
  averageCtr?: number;
  /** 总消耗金额（元） */
  totalSpent?: number;
  /** 平均点击成本（元） */
  averageCpc?: number;
  
  // ===== 转化数据 =====
  /** 总转化次数 */
  totalConversions?: number;
  /** 总转化成本（元） */
  totalConversionCost?: number;
  /** 转化率（%） */
  conversionRate?: number;
  /** ROI（投入产出比） */
  roi?: number;
  
  // ===== 订单相关 =====
  /** 推广带来订单数 */
  promotionOrders?: number;
  /** 推广带来交易额（元） */
  promotionRevenue?: number;
  /** 客单价（元） */
  averageOrderValue?: number;
  
  // ===== 商品表现 =====
  /** 推广商品数 */
  promotedProducts?: number;
  /** 最佳表现商品 ID */
  topProductId?: string;
  /** 最佳表现商品名称 */
  topProductName?: string;
  
  // ===== 时间段分析 =====
  /** 高峰时段（如 "12:00-14:00"） */
  peakHours?: string[];
  /** 低峰时段 */
  offPeakHours?: string[];
  
  // ===== 地域分析 =====
  /** 主要投放城市 */
  topCities?: string[];
  /** 最佳表现城市 */
  bestPerformingCity?: string;
  
  /** 数据抓取时间 */
  fetchedAt: string;
  /** 平台标识 */
  platform: 'meituan';
}
