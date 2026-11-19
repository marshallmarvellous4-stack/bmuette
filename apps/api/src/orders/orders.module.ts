import { Module } from '@nestjs/common';
import { FlutterwaveGateway, StripeGateway } from '../payments/gateways';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({ controllers: [OrdersController], providers: [OrdersService, StripeGateway, FlutterwaveGateway], exports: [OrdersService, StripeGateway, FlutterwaveGateway] })
export class OrdersModule {}
