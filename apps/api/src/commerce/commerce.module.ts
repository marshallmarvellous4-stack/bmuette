import { Module } from '@nestjs/common';
import { AdminGuard } from '../admin/admin.guard';
import { AuthGuard } from '../common/auth.guard';
import { MarketModule } from '../market/market.module';
import { OrdersModule } from '../orders/orders.module';
import { CartService } from './cart.service';
import { CommerceController } from './commerce.controller';
import { DiscountsService } from './discounts.service';
import { PayoutsService } from './payouts.service';
import { RefundsService } from './refunds.service';
import { ReviewsService } from './reviews.service';
import { VariantsService } from './variants.service';

@Module({
  imports: [OrdersModule, MarketModule],
  controllers: [CommerceController],
  providers: [CartService, DiscountsService, VariantsService, RefundsService, ReviewsService, PayoutsService, AuthGuard, AdminGuard],
})
export class CommerceModule {}
