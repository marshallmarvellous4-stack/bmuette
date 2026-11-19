import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard, MaybeUserId, OptionalAuthGuard, UserId } from '../common/auth.guard';
import { clampLimit } from '../common/cursor';
import { ZodPipe } from '../common/zod.pipe';
import { SUPPORTED_CURRENCIES } from '../payments/currencies';
import { MarketService, PRODUCT_KINDS } from './market.service';

const shopBody = z.object({
  shopName: z.string().trim().min(2).max(60),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{2,29}$/, '3 to 30 lowercase letters, numbers or dashes'),
  description: z.string().max(500).default(''),
  country: z.string().length(2),
});
const tags = z.array(z.string().min(1).max(30)).max(15).default([]);
const productBody = z.object({
  title: z.string().trim().min(2).max(120),
  description: z.string().max(4000).default(''),
  kind: z.enum(PRODUCT_KINDS),
  priceMinor: z.number().int().min(0).max(10_000_000_000),
  currency: z.enum(SUPPORTED_CURRENCIES),
  stock: z.number().int().min(0).max(1_000_000).nullable().default(null),
  category: z.string().trim().min(2).max(40).default('general'),
  tags,
  mediaIds: z.array(z.string().uuid()).min(1).max(10),
  postId: z.string().uuid().optional(),
});
const patchBody = z.object({
  title: z.string().trim().min(2).max(120).optional(),
  description: z.string().max(4000).optional(),
  priceMinor: z.number().int().min(0).max(10_000_000_000).optional(),
  stock: z.number().int().min(0).max(1_000_000).nullable().optional(),
  category: z.string().trim().min(2).max(40).optional(),
  tags: z.array(z.string().min(1).max(30)).max(15).optional(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
});

@Controller()
export class MarketController {
  constructor(private market: MarketService) {}

  @Post('merchants') @UseGuards(AuthGuard)
  open(@UserId() id: string, @Body(new ZodPipe(shopBody)) b: z.infer<typeof shopBody>) { return this.market.becomeMerchant(id, b); }

  @Get('shops/:slug') @UseGuards(OptionalAuthGuard)
  shop(@Param('slug') slug: string, @MaybeUserId() viewer?: string) { return this.market.shop(slug, viewer); }

  @Get('market') @UseGuards(OptionalAuthGuard)
  grid(@MaybeUserId() viewer?: string, @Query('cursor') cursor?: string, @Query('limit') limit?: string, @Query('category') category?: string, @Query('kind') kind?: string) {
    return this.market.grid(viewer, { cursor, limit: clampLimit(limit, 20, 40), category, kind: PRODUCT_KINDS.includes(kind as any) ? kind : undefined });
  }

  @Post('products') @UseGuards(AuthGuard)
  create(@UserId() id: string, @Body(new ZodPipe(productBody)) b: z.infer<typeof productBody>) { return this.market.create(id, b); }

  @Get('me/products') @UseGuards(AuthGuard)
  mine(@UserId() id: string) { return this.market.mine(id); }

  @Get('products/:id') @UseGuards(OptionalAuthGuard)
  get(@Param('id', ParseUUIDPipe) id: string, @MaybeUserId() viewer?: string) { return this.market.get(id, viewer); }

  @Patch('products/:id') @UseGuards(AuthGuard)
  patch(@UserId() uid: string, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(patchBody)) b: z.infer<typeof patchBody>) { return this.market.update(uid, id, b); }

  @Get('products/:id/similar') @UseGuards(OptionalAuthGuard)
  similar(@Param('id', ParseUUIDPipe) id: string, @MaybeUserId() viewer?: string) { return this.market.similar(id, viewer); }

  @Post('products/:id/save') @UseGuards(AuthGuard) @HttpCode(200)
  save(@UserId() uid: string, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(z.object({ collectionId: z.string().uuid().optional() }).default({}))) b: { collectionId?: string }) { return this.market.saveProduct(uid, id, true, b.collectionId); }

  @Delete('products/:id/save') @UseGuards(AuthGuard)
  unsave(@UserId() uid: string, @Param('id', ParseUUIDPipe) id: string) { return this.market.saveProduct(uid, id, false); }
}
