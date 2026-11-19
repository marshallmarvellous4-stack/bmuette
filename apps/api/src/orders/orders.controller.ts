import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard, UserId } from '../common/auth.guard';
import { ZodPipe } from '../common/zod.pipe';
import { OrdersService } from './orders.service';

const create = z.object({
  items: z.array(z.object({ productId: z.string().uuid(), variantId: z.string().uuid().nullish(), qty: z.number().int().min(1).max(20) })).min(1).max(20),
  code: z.string().trim().max(30).nullish(),
  shipping: z.object({
    name: z.string().min(2).max(100), phone: z.string().min(6).max(30), line1: z.string().min(3).max(200), line2: z.string().max(200).optional(),
    city: z.string().min(2).max(100), state: z.string().max(100).optional(), postalCode: z.string().max(20).optional(), country: z.string().length(2),
  }).optional(),
});
const quote = z.object({ items: create.shape.items, code: create.shape.code });
const fulfil = z.object({
  status: z.enum(['shipped', 'delivered']),
  carrier: z.string().trim().max(60).optional(), trackingNumber: z.string().trim().max(80).optional(),
  trackingUrl: z.string().trim().url().max(300).optional(), note: z.string().trim().max(300).optional(),
});

@Controller()
@UseGuards(AuthGuard)
export class OrdersController {
  constructor(private orders: OrdersService) {}

  @Post('orders')
  create(@UserId() uid: string, @Body(new ZodPipe(create)) b: z.infer<typeof create>) { return this.orders.create(uid, b); }

  @Post('orders/quote') @HttpCode(200)
  quote(@UserId() uid: string, @Body(new ZodPipe(quote)) b: z.infer<typeof quote>) { return this.orders.quote(uid, b); }

  @Post('order-items/:id/received') @HttpCode(200)
  received(@UserId() uid: string, @Param('id', ParseUUIDPipe) id: string) { return this.orders.confirmReceived(uid, id); }

  @Get('orders')
  list(@UserId() uid: string) { return this.orders.list(uid); }

  @Get('orders/:id')
  get(@UserId() uid: string, @Param('id', ParseUUIDPipe) id: string) { return this.orders.get(uid, id); }

  @Get('merchant/orders')
  mine(@UserId() uid: string) { return this.orders.forMerchant(uid); }

  @Patch('merchant/order-items/:id')
  fulfil(@UserId() uid: string, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(fulfil)) b: z.infer<typeof fulfil>) { return this.orders.setFulfilment(uid, id, b); }
}
