import { Module } from '@nestjs/common';
import { AuthGuard } from '../common/auth.guard';
import { FlutterwaveGateway, StripeGateway } from '../payments/gateways';
import { PostsModule } from '../posts/posts.module';
import { GiftsController } from './gifts.controller';
import { GiftsService } from './gifts.service';
import { WalletService } from './wallet.service';

@Module({ imports: [PostsModule], controllers: [GiftsController], providers: [GiftsService, WalletService, AuthGuard, StripeGateway, FlutterwaveGateway], exports: [WalletService] })
export class GiftsModule {}
