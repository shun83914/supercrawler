/**
 * 美团经营宝订单实体
 */
export interface MeituanOrderEntity {
  /** 订单 ID */
  orderId: string;
  /** 订单号 */
  orderNo?: string;
  /** 订单状态 */
  status?: string;
  /** 订单金额（元） */
  amount?: number;
  /** 实际支付金额（元） */
  payAmount?: number;
  /** 商品名称 */
  productName?: string;
  /** 商品数量 */
  quantity?: number;
  /** 下单时间 */
  orderTime?: string;
  /** 支付时间 */
  payTime?: string;
  /** 用户昵称 */
  userNickname?: string;
  /** 用户手机号（脱敏） */
  userPhone?: string;
  /** 配送地址 */
  address?: string;
  /** 抓取时间 */
  fetchedAt: string;
  /** 数据来源 */
  platform: 'meituan';
}
