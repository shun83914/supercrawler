import { Module } from '@nestjs/common';
import { MeituanController } from './meituan.controller';
import { MeituanService } from './meituan.service';
import { OrdersStrategy } from './strategies/orders.strategy';
import { ProductsStrategy } from './strategies/products.strategy';
import { ReviewsStrategy } from './strategies/reviews.strategy';
import { PromotionCampaignsStrategy } from './strategies/promotion-campaigns.strategy';
import { PromotionStatsStrategy } from './strategies/promotion-stats.strategy';

@Module({
  controllers: [MeituanController],
  providers: [
    MeituanService,
    OrdersStrategy,
    ProductsStrategy,
    ReviewsStrategy,
    PromotionCampaignsStrategy,
    PromotionStatsStrategy,
  ],
  exports: [MeituanService],
})
export class MeituanModule {}
