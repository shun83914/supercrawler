/**
 * 美团推广通活动实体
 */
export interface MeituanPromotionCampaignEntity {
  /** 活动 ID */
  campaignId: string;
  /** 活动名称 */
  campaignName: string;
  /** 活动类型：推广通/其他 */
  campaignType?: string;
  /** 活动状态：running/paused/expired */
  status?: string;
  /** 预算（元） */
  budget?: number;
  /** 已消耗金额（元） */
  spent?: number;
  /** 开始时间 */
  startTime?: string;
  /** 结束时间 */
  endTime?: string;
  /** 展示次数 */
  impressions?: number;
  /** 点击次数 */
  clicks?: number;
  /** 点击率（%） */
  ctr?: number;
  /** 平均点击成本（元） */
  cpc?: number;
  /** 转化次数 */
  conversions?: number;
  /** 转化成本（元） */
  costPerConversion?: number;
  /** 关联商品 ID */
  productIds?: string[];
  /** 数据抓取时间 */
  fetchedAt: string;
  /** 平台标识 */
  platform: 'meituan';
}
