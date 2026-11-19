import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { OrdersModule } from '../orders/orders.module';
import { WebhooksController } from './webhooks.controller';

@Module({ imports: [OrdersModule, MediaModule], controllers: [WebhooksController] })
export class WebhooksModule {}
