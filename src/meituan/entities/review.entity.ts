/**
 * 美团经营宝评价实体
 */
export interface MeituanReviewEntity {
  /** 评价 ID */
  reviewId: string;
  /** 订单 ID */
  orderId?: string;
  /** 商品 ID */
  productId?: string;
  /** 商品名称 */
  productName?: string;
  /** 评分（1-5） */
  rating?: number;
  /** 评价内容 */
  content?: string;
  /** 评价图片 URLs */
  images?: string[];
  /** 用户昵称 */
  userNickname?: string;
  /** 评价时间 */
  reviewTime?: string;
  /** 商家回复 */
  merchantReply?: string;
  /** 商家回复时间 */
  merchantReplyTime?: string;
  /** 抓取时间 */
  fetchedAt: string;
  /** 数据来源 */
  platform: 'meituan';
}
