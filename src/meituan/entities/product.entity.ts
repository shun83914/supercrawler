/**
 * 美团经营宝商品实体
 */
export interface MeituanProductEntity {
  /** 商品 ID */
  productId: string;
  /** 商品名称 */
  productName: string;
  /** 商品分类 */
  category?: string;
  /** 价格（元） */
  price?: number;
  /** 原价（元） */
  originalPrice?: number;
  /** 月销量 */
  monthlySales?: number;
  /** 总销量 */
  totalSales?: number;
  /** 评分 */
  rating?: number;
  /** 评价数 */
  reviewCount?: number;
  /** 商品状态 */
  status?: string;
  /** 商品图片 URL */
  imageUrl?: string;
  /** 抓取时间 */
  fetchedAt: string;
  /** 数据来源 */
  platform: 'meituan';
}
