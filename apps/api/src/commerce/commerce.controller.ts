import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AdminGuard } from '../admin/admin.guard';
import { AuthGuard, MaybeUserId, OptionalAuthGuard, UserId } from '../common/auth.guard';
import { ZodPipe } from '../common/zod.pipe';
import { Db } from '../db/db.service';
import { CartService } from './cart.service';
import { DiscountsService } from './discounts.service';
import { PayoutsService } from './payouts.service';
import { RefundsService } from './refunds.service';
import { ReviewsService } from './reviews.service';
import { VariantsService } from './variants.service';

const uuid = z.string().uuid();
const shipping = z.object({
  name: z.string().min(2).max(100), phone: z.string().min(6).max(30), line1: z.string().min(3).max(200), line2: z.string().max(200).optional(),
  city: z.string().min(2).max(100), state: z.string().max(100).optional(), postalCode: z.string().max(20).optional(), country: z.string().length(2),
});
const cartAdd = z.object({ productId: uuid, variantId: uuid.nullish(), qty: z.number().int().min(1).max(20).default(1) });
const cartQty = z.object({ qty: z.number().int().min(1).max(20) });
const cartCheckout = z.object({ currency: z.string().length(3), code: z.string().trim().max(30).nullish(), shipping: shipping.optional() });
const variants = z.object({
  variants: z.array(z.object({
    id: uuid.optional(), label: z.string().trim().min(1).max(60), options: z.record(z.string(), z.string().max(40)).optional(),
    priceMinor: z.number().int().min(0).max(10_000_000_000).nullish(), stock: z.number().int().min(0).max(1_000_000).nullish(),
  })).max(60),
});
const discount = z.object({
  code: z.string().trim().regex(/^[A-Za-z0-9]{3,20}$/, '3 to 20 letters or numbers'),
  kind: z.enum(['percent', 'fixed']), value: z.number().int().min(1).max(10_000_000_000), currency: z.string().length(3).optional(),
  minSubtotalMinor: z.number().int().min(0).optional(), maxUses: z.number().int().min(1).nullish(), expiresAt: z.string().datetime().nullish(),
});
const discountPatch = z.object({ active: z.boolean().optional(), maxUses: z.number().int().min(1).nullable().optional(), expiresAt: z.string().datetime().nullable().optional() });
const refundReq = z.object({ reason: z.string().trim().min(3).max(100), details: z.string().trim().max(1000).optional() });
const decide = z.object({ decision: z.enum(['approve', 'reject']), response: z.string().trim().max(300).optional() });
const review = z.object({ orderItemId: uuid, rating: z.number().int().min(1).max(5), body: z.string().trim().max(1500).optional() });
const reply = z.object({ reply: z.string().trim().min(1).max(600) });
const payoutReq = z.object({ currency: z.string().length(3), amountMinor: z.number().int().min(1).optional() });
const details = z.object({ details: z.string().trim().max(500) });
const paid = z.object({ reference: z.string().trim().min(2).max(100) });
const rejectBody = z.object({ note: z.string().trim().min(3).max(300) });

@Controller()
export class CommerceController {
  constructor(
    private cart: CartService, private discounts: DiscountsService, private variants: VariantsService,
    private refunds: RefundsService, private reviews: ReviewsService, private payouts: PayoutsService, private db: Db,
  ) {}

  // ---- cart
  @Get('cart') @UseGuards(AuthGuard) getCart(@UserId() u: string) { return this.cart.get(u); }
  @Get('cart/count') @UseGuards(AuthGuard) cartCount(@UserId() u: string) { return this.cart.count(u); }
  @Post('cart/items') @UseGuards(AuthGuard) @HttpCode(200)
  addToCart(@UserId() u: string, @Body(new ZodPipe(cartAdd)) b: z.infer<typeof cartAdd>) { return this.cart.add(u, b); }
  @Patch('cart/items/:id') @UseGuards(AuthGuard)
  cartQty(@UserId() u: string, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(cartQty)) b: z.infer<typeof cartQty>) { return this.cart.setQty(u, id, b.qty); }
  @Delete('cart/items/:id') @UseGuards(AuthGuard) removeFromCart(@UserId() u: string, @Param('id', ParseUUIDPipe) id: string) { return this.cart.remove(u, id); }
  @Delete('cart') @UseGuards(AuthGuard) clearCart(@UserId() u: string) { return this.cart.clear(u); }
  @Post('cart/checkout') @UseGuards(AuthGuard)
  checkout(@UserId() u: string, @Body(new ZodPipe(cartCheckout)) b: z.infer<typeof cartCheckout>) { return this.cart.checkout(u, b); }

  // ---- shop tools
  @Put('products/:id/variants') @UseGuards(AuthGuard)
  setVariants(@UserId() u: string, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(variants)) b: z.infer<typeof variants>) { return this.variants.replace(u, id, b.variants); }
  @Get('merchant/discounts') @UseGuards(AuthGuard) listDiscounts(@UserId() u: string) { return this.discounts.list(u); }
  @Post('merchant/discounts') @UseGuards(AuthGuard)
  createDiscount(@UserId() u: string, @Body(new ZodPipe(discount)) b: z.infer<typeof discount>) { return this.discounts.create(u, b); }
  @Patch('merchant/discounts/:id') @UseGuards(AuthGuard)
  patchDiscount(@UserId() u: string, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(discountPatch)) b: z.infer<typeof discountPatch>) { return this.discounts.update(u, id, b); }
  @Delete('merchant/discounts/:id') @UseGuards(AuthGuard) @HttpCode(204)
  deleteDiscount(@UserId() u: string, @Param('id', ParseUUIDPipe) id: string) { return this.discounts.remove(u, id); }

  // ---- returns and refunds
  @Post('order-items/:id/refund') @UseGuards(AuthGuard)
  requestRefund(@UserId() u: string, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(refundReq)) b: z.infer<typeof refundReq>) { return this.refunds.request(u, id, b); }
  @Get('merchant/refunds') @UseGuards(AuthGuard) merchantRefunds(@UserId() u: string) { return this.refunds.forMerchant(u); }
  @Post('merchant/refunds/:id/decide') @UseGuards(AuthGuard) @HttpCode(200)
  merchantDecide(@UserId() u: string, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(decide)) b: z.infer<typeof decide>) { return this.refunds.decide({ id: u, admin: false }, id, b.decision, b.response); }

  // ---- reviews
  @Get('products/:id/reviews') @UseGuards(OptionalAuthGuard)
  listReviews(@Param('id', ParseUUIDPipe) id: string, @Query('cursor') c?: string, @Query('limit') l?: string) { return this.reviews.list(id, c, l); }
  @Post('products/:id/reviews') @UseGuards(AuthGuard)
  addReview(@UserId() u: string, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(review)) b: z.infer<typeof review>) { return this.reviews.create(u, id, b); }
  @Delete('reviews/:id') @UseGuards(AuthGuard) @HttpCode(204) deleteReview(@UserId() u: string, @Param('id', ParseUUIDPipe) id: string) { return this.reviews.remove(u, id); }
  @Patch('reviews/:id/reply') @UseGuards(AuthGuard)
  replyReview(@UserId() u: string, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(reply)) b: z.infer<typeof reply>) { return this.reviews.reply(u, id, b.reply); }

  // ---- payouts
  @Get('merchant/balance') @UseGuards(AuthGuard) balance(@UserId() u: string) { return this.payouts.balance(u); }
  @Get('merchant/ledger') @UseGuards(AuthGuard) ledger(@UserId() u: string, @Query('cursor') c?: string, @Query('limit') l?: string) { return this.payouts.ledger(u, c, l); }
  @Put('merchant/payout-details') @UseGuards(AuthGuard) setDetails(@UserId() u: string, @Body(new ZodPipe(details)) b: z.infer<typeof details>) { return this.payouts.setDetails(u, b.details); }
  @Get('merchant/payouts') @UseGuards(AuthGuard) myPayouts(@UserId() u: string) { return this.payouts.mine(u); }
  @Post('merchant/payouts') @UseGuards(AuthGuard)
  requestPayout(@UserId() u: string, @Body(new ZodPipe(payoutReq)) b: z.infer<typeof payoutReq>) { return this.payouts.request(u, b); }

  // ---- admin
  /** Money overview: what customers paid, what BMUETTE earned in fees, what shops are owed. */
  @Get('admin/api/commerce') @UseGuards(AdminGuard) async overview() {
    const sales = await this.db.query(`select currency, count(*)::int as orders, sum(total_minor)::bigint as gross, sum(fee_minor)::bigint as fees, sum(discount_minor)::bigint as discounts from orders where status = 'paid' group by currency`);
    const owed = await this.db.query(`select currency, sum(amount_minor)::bigint as owed from merchant_ledger group by currency`);
    const open = await this.db.one<any>(`select (select count(*) from refund_requests where status in ('requested','approved'))::int as refunds, (select count(*) from payout_requests where status = 'requested')::int as payouts`);
    return {
      currencies: sales.map((s) => ({ currency: s.currency, orders: s.orders, grossMinor: Number(s.gross), feesMinor: Number(s.fees), discountsMinor: Number(s.discounts), owedToShopsMinor: Number(owed.find((o) => o.currency === s.currency)?.owed ?? 0) })),
      openRefunds: open?.refunds ?? 0, openPayouts: open?.payouts ?? 0,
    };
  }
  @Get('admin/api/payouts') @UseGuards(AdminGuard) adminPayouts(@Query('status') s?: string) { return this.payouts.forAdmin(s); }
  @Post('admin/api/payouts/:id/paid') @UseGuards(AdminGuard) @HttpCode(200)
  adminPaid(@UserId() a: string, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(paid)) b: z.infer<typeof paid>) { return this.payouts.markPaid(a, id, b.reference); }
  @Post('admin/api/payouts/:id/reject') @UseGuards(AdminGuard) @HttpCode(200)
  adminReject(@UserId() a: string, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(rejectBody)) b: z.infer<typeof rejectBody>) { return this.payouts.reject(a, id, b.note); }
  @Get('admin/api/refunds') @UseGuards(AdminGuard) adminRefunds(@Query('status') s?: string) { return this.refunds.forAdmin(s); }
  @Post('admin/api/refunds/:id/decide') @UseGuards(AdminGuard) @HttpCode(200)
  async adminDecide(@UserId() a: string, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(decide)) b: z.infer<typeof decide>) {
    const r = await this.refunds.decide({ id: a, admin: true }, id, b.decision, b.response);
    await this.db.query(`insert into admin_actions (admin_id, action, target_type, target_id, note) values ($1,$2,'refund',$3,$4)`, [a, `refund_${b.decision}`, id, b.response ?? null]);
    return r;
  }
}
