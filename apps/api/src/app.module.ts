import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { AdminModule } from './admin/admin.module';
import { ChatModule } from './chat/chat.module';
import { CacheModule } from './cache/cache.service';
import { EnvModule } from './config/env';
import { DbModule } from './db/db.service';
import { FeedModule } from './feed/feed.module';
import { HealthController } from './health/health.controller';
import { LegalModule } from './legal/legal.controller';
import { MailModule } from './mail/mail.service';
import { HubModule } from './chat/hub.module';
import { NotificationsModule } from './notifications/notifications.module';
import { GiftsModule } from './gifts/gifts.module';
import { MarketModule } from './market/market.module';
import { MediaModule } from './media/media.module';
import { CommerceModule } from './commerce/commerce.module';
import { OrdersModule } from './orders/orders.module';
import { PostsModule } from './posts/posts.module';
import { SoundsModule } from './sounds/sounds.module';
import { SearchModule } from './search/search.module';
import { UsersModule } from './users/users.module';
import { WebhooksModule } from './webhooks/webhooks.module';

@Module({
  imports: [
    EnvModule, DbModule, CacheModule, MailModule, LegalModule, HubModule, NotificationsModule, GiftsModule, CommerceModule,
    // 120 requests a minute per IP across the API. Sign-in routes are stricter (see AuthController).
    ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 120 }], skipIf: () => process.env.NODE_ENV === 'test' }),
    AuthModule, UsersModule, MediaModule, PostsModule, FeedModule, MarketModule, SearchModule, SoundsModule, OrdersModule, WebhooksModule, ChatModule, AdminModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
