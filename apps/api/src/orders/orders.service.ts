import { Notifications } from '../notifications/notifications.service';
import { BadGatewayException, BadRequestException, Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ENV, Env } from '../config/env';
import { requireTrading } from '../common/gates';
import { Db, Tx } from '../db/db.service';
import { FlutterwaveGateway, StripeGateway } from '../payments/gateways';
import { providerFor } from '../payments/currencies';
import { allocate, canRequestRefund } from './rules';

export type Shipping = { name: string; phone: string; line1: string; line2?: string; city: string; state?: string; postalCode?: string; country: string };
export type Line = { productId: string; variantId?: string | null; qty: number };

const toItem = (i: any, order: any, windowDays: number) => ({
  id: i.id, productId: i.product_id, title: i.title, variantLabel: i.variant_label ?? null,
  unitPriceMinor: Number(i.unit_price_minor), qty: i.qty, discountMinor: Number(i.discount_minor ?? 0), fulfilment: i.fulfilment,
  carrier: i.carrier ?? null, trackingNumber: i.tracking_number ?? null, trackingUrl: i.tracking_url ?? null,
  shippedAt: i.shipped_at ?? null, deliveredAt: i.delivered_at ?? null, refundedMinor: Number(i.refunded_minor ?? 0),
  refundStatus: i.refund_status ?? null, thumbUrl: i.thumb ?? null, reviewed: !!i.review_id,
  canRefund: canRequestRefund(i, order, windowDays),
  canReview: (order.status === 'paid' || order.status === 'refunded') && !i.review_id,
});

const ITEM_SQL = `
  select i.*,
         (select status from refund_requests r where r.order_item_id = i.id order by created_at desc limit 1) as refund_status,
         (select id from reviews v where v.order_item_id = i.id) as review_id,
         (select coalesce(m.thumb_url, m.url) from product_media pm join media_assets m on m.id = pm.media_id where pm.product_id = i.product_id order by pm.position limit 1) as thumb
    from order_items i`;

@Injectable()
export class OrdersService implements OnModuleInit, OnModuleDestroy {
  private log = new Logger('Orders');
  private timer?: NodeJS.Timeout;
  constructor(private db: Db, private stripe: StripeGateway, private flw: FlutterwaveGateway, @Inject(ENV) private env: Env, private notes: Notifications) {}

  onModuleInit() {
    // Unpaid orders hold stock. Release it after an hour.
    this.timer = setInterval(() => this.expireStale().catch((e) => this.log.error(e)), 10 * 60_000);
    this.timer.unref();
  }
  onModuleDestroy() { clearInterval(this.timer); }

  private shape(o: any, items: any[]) {
    return {
      id: o.id, status: o.status, currency: o.currency, subtotalMinor: Number(o.subtotal_minor), discountMinor: Number(o.discount_minor ?? 0),
      feeMinor: Number(o.fee_minor), totalMinor: Number(o.total_minor),
      provider: o.provider, shipping: o.shipping, createdAt: o.created_at, paidAt: o.paid_at,
      items: items.map((i) => toItem(i, o, this.env.RETURN_WINDOW_DAYS)),
    };
  }

  // ---------- pricing (shared by quote and create) ----------
  /** Work out exactly what these lines cost, with stock checks and an optional discount code. Writes nothing. */
  async price(userId: string, input: Line[], code?: string | null) {
    const merged = new Map<string, Line>();
    for (const l of input) {
      const k = `${l.productId}:${l.variantId ?? ''}`;
      const cur = merged.get(k);
      merged.set(k, { productId: l.productId, variantId: l.variantId ?? null, qty: (cur?.qty ?? 0) + l.qty });
    }
    const lines = [...merged.values()];
    if (!lines.length) throw new BadRequestException('Nothing to buy');
    const pids = [...new Set(lines.map((l) => l.productId))];
    const products = await this.db.query(
      `select p.id, p.title, p.kind, p.price_minor, p.currency, p.stock, p.merchant_id
         from products p join users u on u.id = p.merchant_id
        where p.id = any($1::uuid[]) and p.status = 'active' and u.deleted_at is null`, [pids]);
    if (products.length !== pids.length) throw new BadRequestException('One of these products is no longer available');
    if (products.some((p) => p.merchant_id === userId)) throw new BadRequestException('You cannot buy your own product');
    const variants = await this.db.query(`select * from product_variants where product_id = any($1::uuid[]) and active`, [pids]);
    const pById = new Map(products.map((p) => [p.id, p]));

    const resolved = lines.map((l) => {
      const p = pById.get(l.productId)!;
      const pv = variants.filter((v) => v.product_id === p.id);
      let v: any = null;
      if (pv.length) {
        if (!l.variantId) throw new BadRequestException(`Choose an option for "${p.title}"`);
        v = pv.find((x) => x.id === l.variantId);
        if (!v) throw new BadRequestException(`That option of "${p.title}" is no longer available`);
      } else if (l.variantId) throw new BadRequestException(`"${p.title}" has no options`);
      const stock = v ? v.stock : p.stock;
      if (stock !== null && stock < l.qty) throw new BadRequestException(`"${p.title}${v ? ` (${v.label})` : ''}" is ${stock === 0 ? 'out of stock' : `limited to ${stock}`}`);
      const unit = Number(v?.price_minor ?? p.price_minor);
      return { p, v, qty: l.qty, unit, line: unit * l.qty };
    });
    const currencies = new Set(resolved.map((r) => r.p.currency));
    if (currencies.size !== 1) throw new BadRequestException('Items in one order must use the same currency. Check out separately.');
    const currency = [...currencies][0] as string;
    const subtotal = resolved.reduce((s, r) => s + r.line, 0);

    // Discount codes belong to one shop and only reduce that shop's items.
    let codeRow: any = null;
    let discounts = resolved.map(() => 0);
    if (code && code.trim()) {
      const c = await this.db.one(
        `select d.* from discount_codes d where upper(d.code) = upper($1) and d.active and d.merchant_id = any($2::uuid[])`,
        [code.trim(), [...new Set(resolved.map((r) => r.p.merchant_id))]]);
      const bad = (m: string) => new BadRequestException(m);
      if (!c) throw bad('That code does not work for these items');
      if (c.expires_at && new Date(c.expires_at) < new Date()) throw bad('That code has expired');
      if (c.max_uses !== null && c.used_count >= c.max_uses) throw bad('That code has been used up');
      if (c.kind === 'fixed' && c.currency !== currency) throw bad(`That code is only for ${c.currency} orders`);
      const used = await this.db.one(`select 1 from orders where buyer_id = $1 and discount_code_id = $2 and status in ('pending','paid') limit 1`, [userId, c.id]);
      if (used) throw bad('You have already used that code');
      const eligible = resolved.map((r) => r.p.merchant_id === c.merchant_id);
      const base = resolved.reduce((s, r, i) => s + (eligible[i] ? r.line : 0), 0);
      if (base < Number(c.min_subtotal_minor)) throw bad(`Spend at least ${(Number(c.min_subtotal_minor) / 100).toLocaleString()} ${currency} in this shop to use that code`);
      const amount = c.kind === 'percent' ? Math.floor((base * Number(c.value)) / 100) : Math.min(Number(c.value), base);
      discounts = allocate(amount, resolved.map((r, i) => (eligible[i] ? r.line : 0)));
      codeRow = c;
    }
    const discount = discounts.reduce((a, b) => a + b, 0);
    const out = resolved.map((r, i) => {
      const net = r.line - discounts[i];
      return { ...r, discount: discounts[i], fee: Math.floor((net * this.env.PLATFORM_FEE_BPS) / 10_000) };
    });
    return { lines: out, currency, subtotal, discount, total: subtotal - discount, fee: out.reduce((s, r) => s + r.fee, 0), codeRow, needsShipping: resolved.some((r) => r.p.kind === 'physical' || r.p.kind === 'food') };
  }

  async quote(userId: string, input: { items: Line[]; code?: string | null }) {
    const q = await this.price(userId, input.items, input.code);
    return { currency: q.currency, subtotalMinor: q.subtotal, discountMinor: q.discount, totalMinor: q.total, code: q.codeRow?.code ?? null, needsShipping: q.needsShipping };
  }

  async create(userId: string, input: { items: Line[]; shipping?: Shipping; code?: string | null }) {
    await requireTrading(this.db, userId, 'buy');
    const q = await this.price(userId, input.items, input.code);
    if (q.needsShipping && !input.shipping) throw new BadRequestException('A delivery address is required');
    if (q.total <= 0) throw new BadRequestException('Nothing to pay');

    const provider = providerFor(q.currency);
    if (provider === 'stripe' ? !this.stripe.configured : !this.flw.configured) {
      throw new ServiceUnavailableException(`Payments in ${q.currency} are not switched on yet`);
    }
    const buyer = await this.db.one(`select email, display_name from users where id = $1`, [userId]);

    const orderId = await this.db.tx(async (tx) => {
      for (const r of q.lines) {
        // The stock check and the decrement are one statement, so two buyers cannot both take the last item.
        const res = r.v
          ? await tx.query(`update product_variants set stock = stock - $2 where id = $1 and (stock is null or stock >= $2) returning id`, [r.v.id, r.qty])
          : await tx.query(`update products set stock = stock - $2 where id = $1 and (stock is null or stock >= $2) returning id`, [r.p.id, r.qty]);
        if (!res.length) throw new BadRequestException(`"${r.p.title}" is out of stock`);
      }
      if (q.codeRow) {
        const c = await tx.query(`update discount_codes set used_count = used_count + 1 where id = $1 and active and (max_uses is null or used_count < max_uses) returning id`, [q.codeRow.id]);
        if (!c.length) throw new BadRequestException('That code has been used up');
      }
      const [o] = await tx.query(
        `insert into orders (buyer_id, currency, subtotal_minor, discount_minor, discount_code_id, fee_minor, total_minor, provider, shipping)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
        [userId, q.currency, q.subtotal, q.discount, q.codeRow?.id ?? null, q.fee, q.total, provider, input.shipping ? JSON.stringify(input.shipping) : null]);
      for (const r of q.lines) {
        await tx.query(
          `insert into order_items (order_id, product_id, merchant_id, title, unit_price_minor, qty, variant_id, variant_label, discount_minor, fee_minor)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [o.id, r.p.id, r.p.merchant_id, r.p.title, r.unit, r.qty, r.v?.id ?? null, r.v?.label ?? null, r.discount, r.fee]);
      }
      await tx.query(`insert into order_events (order_id, kind) values ($1,'placed')`, [o.id]);
      return o.id as string;
    });

    try {
      const gateway = provider === 'stripe' ? this.stripe : this.flw;
      const checkout = await gateway.createCheckout({
        id: orderId, currency: q.currency, totalMinor: q.total, discountMinor: q.discount, buyerEmail: buyer!.email, buyerName: buyer!.display_name,
        items: q.lines.map((r) => ({ title: r.v ? `${r.p.title} (${r.v.label})` : r.p.title, qty: r.qty, unitMinor: r.unit })),
      });
      await this.db.query(`update orders set provider_ref = $2 where id = $1`, [orderId, checkout.providerRef]);
      return { order: await this.get(userId, orderId), checkout: { provider: checkout.provider, url: checkout.url } };
    } catch (e) {
      await this.release(orderId, 'cancelled');
      if (e instanceof ServiceUnavailableException) throw e;
      this.log.error(`checkout failed for ${orderId}: ${(e as Error).message}`);
      throw new BadGatewayException('The payment provider did not respond. Please try again.');
    }
  }

  // ---------- reading ----------
  async get(userId: string, id: string) {
    const o = await this.db.one(`select * from orders where id = $1 and buyer_id = $2`, [id, userId]);
    if (!o) throw new NotFoundException('Order not found');
    const items = await this.db.query(`${ITEM_SQL} where i.order_id = $1`, [id]);
    const events = await this.db.query(`select id, item_id, kind, note, created_at from order_events where order_id = $1 order by id`, [id]);
    return { ...this.shape(o, items), timeline: events.map((e) => ({ id: Number(e.id), itemId: e.item_id, kind: e.kind, note: e.note, at: e.created_at })) };
  }

  async list(userId: string) {
    const orders = await this.db.query(`select * from orders where buyer_id = $1 and status <> 'cancelled' order by created_at desc limit 50`, [userId]);
    const items = orders.length ? await this.db.query(`${ITEM_SQL} where i.order_id = any($1::uuid[])`, [orders.map((o) => o.id)]) : [];
    return { items: orders.map((o) => this.shape(o, items.filter((i) => i.order_id === o.id))) };
  }

  async forMerchant(merchantId: string) {
    const rows = await this.db.query(
      `select i.*, o.created_at, o.paid_at, o.shipping, o.currency, u.display_name as buyer_name,
              (select status from refund_requests r where r.order_item_id = i.id order by created_at desc limit 1) as refund_status
         from order_items i join orders o on o.id = i.order_id join users u on u.id = o.buyer_id
        where i.merchant_id = $1 and o.status in ('paid','refunded') order by o.paid_at desc limit 100`, [merchantId]);
    return {
      items: rows.map((r) => ({
        id: r.id, orderId: r.order_id, title: r.title, variantLabel: r.variant_label, qty: r.qty, unitPriceMinor: Number(r.unit_price_minor), discountMinor: Number(r.discount_minor),
        currency: r.currency, fulfilment: r.fulfilment, paidAt: r.paid_at, buyerName: r.buyer_name, shipping: r.shipping,
        carrier: r.carrier, trackingNumber: r.tracking_number, trackingUrl: r.tracking_url, refundStatus: r.refund_status, refundedMinor: Number(r.refunded_minor),
      })),
    };
  }

  // ---------- tracking ----------
  async setFulfilment(merchantId: string, itemId: string, input: { status: 'shipped' | 'delivered'; carrier?: string; trackingNumber?: string; trackingUrl?: string; note?: string }) {
    const row = await this.db.one<{ id: string; order_id: string; title: string }>(
      `update order_items i set fulfilment = $3,
              carrier = coalesce($4, carrier), tracking_number = coalesce($5, tracking_number), tracking_url = coalesce($6, tracking_url),
              shipped_at = case when $3 = 'shipped' then coalesce(shipped_at, now()) else shipped_at end,
              delivered_at = case when $3 = 'delivered' then coalesce(delivered_at, now()) else delivered_at end
        from orders o where i.id = $1 and i.merchant_id = $2 and o.id = i.order_id and o.status = 'paid' and i.fulfilment <> 'cancelled'
          and not (i.fulfilment = 'delivered' and $3 = 'shipped')
        returning i.id, i.order_id, i.title`,
      [itemId, merchantId, input.status, input.carrier ?? null, input.trackingNumber ?? null, input.trackingUrl ?? null]);
    if (!row) throw new NotFoundException('Order item not found');
    await this.db.query(`insert into order_events (order_id, item_id, kind, note) values ($1,$2,$3,$4)`, [row.order_id, row.id, input.status, input.note ?? null]);
    await this.tellBuyer(row.order_id, merchantId, input.status === 'shipped' ? 'Your order has shipped' : 'Your order was delivered', row.title);
    return { ok: true };
  }

  /** The buyer says it arrived. */
  async confirmReceived(userId: string, itemId: string) {
    const row = await this.db.one<{ id: string; order_id: string; title: string; merchant_id: string }>(
      `update order_items i set fulfilment = 'delivered', delivered_at = coalesce(delivered_at, now())
        from orders o where i.id = $1 and o.id = i.order_id and o.buyer_id = $2 and o.status = 'paid' and i.fulfilment in ('pending','shipped')
        returning i.id, i.order_id, i.title, i.merchant_id`, [itemId, userId]);
    if (!row) throw new NotFoundException('Order item not found');
    await this.db.query(`insert into order_events (order_id, item_id, kind, note) values ($1,$2,'delivered','Confirmed by buyer')`, [row.order_id, row.id]);
    return { ok: true };
  }

  private async tellBuyer(orderId: string, actorId: string, title: string, body: string) {
    const o = await this.db.one<{ buyer_id: string }>(`select buyer_id from orders where id = $1`, [orderId]);
    if (o) await this.notes.notify({ userId: o.buyer_id, actorId, type: 'order_update', orderId, title, body });
  }

  // ---------- called by webhooks ----------
  async markPaid(orderId: string, expect: { totalMinor: number; currency: string }): Promise<boolean> {
    const done = await this.markPaidTx(orderId, expect);
    if (done) {
      const o = await this.db.one<{ buyer_id: string }>(`select buyer_id from orders where id = $1`, [orderId]);
      if (o) await this.notes.notify({ userId: o.buyer_id, type: 'order_paid', orderId, title: 'Payment received', body: 'Your order is confirmed.' });
      const items = await this.db.query<{ merchant_id: string; title: string; qty: number }>(`select merchant_id, title, qty from order_items where order_id = $1`, [orderId]);
      for (const i of items) await this.notes.notify({ userId: i.merchant_id, actorId: o?.buyer_id, type: 'sale', orderId, title: 'You made a sale', body: `${i.qty} × ${i.title}` });
    }
    return done;
  }

  private async markPaidTx(orderId: string, expect: { totalMinor: number; currency: string }): Promise<boolean> {
    return this.db.tx(async (tx) => {
      const o = (await tx.query(`select * from orders where id = $1 for update`, [orderId]))[0];
      if (!o) throw new NotFoundException('Order not found');
      if (o.status === 'paid') return false; // already handled: webhooks repeat
      if (Number(o.total_minor) !== expect.totalMinor || o.currency !== expect.currency) {
        this.log.error(`Amount mismatch on order ${orderId}: expected ${o.total_minor} ${o.currency}, got ${expect.totalMinor} ${expect.currency}`);
        throw new BadRequestException('Amount mismatch');
      }
      if (o.status !== 'pending') {
        // Paid after we gave up on it. The money is real, so take the order if the stock is still there.
        const items = await tx.query(`select product_id, variant_id, qty from order_items where order_id = $1`, [orderId]);
        for (const i of items) {
          const ok = i.variant_id
            ? await tx.query(`update product_variants set stock = stock - $2 where id = $1 and (stock is null or stock >= $2) returning id`, [i.variant_id, i.qty])
            : await tx.query(`update products set stock = stock - $2 where id = $1 and (stock is null or stock >= $2) returning id`, [i.product_id, i.qty]);
          if (!ok.length) {
            this.log.error(`LATE PAYMENT, NO STOCK: order ${orderId} needs a manual refund`);
            await tx.query(`update orders set status = 'refunded' where id = $1`, [orderId]);
            return false;
          }
        }
      }
      await tx.query(`update orders set status = 'paid', paid_at = now() where id = $1`, [orderId]);
      await tx.query(`update products p set sold_count = sold_count + i.qty from order_items i where i.order_id = $1 and i.product_id = p.id`, [orderId]);
      await tx.query(`insert into order_events (order_id, kind) values ($1,'paid')`, [orderId]);
      // Money for the shops. Sales are held a few days (the returns window starts) before they can be paid out.
      const items = await tx.query(`select id, merchant_id, unit_price_minor, qty, discount_minor, fee_minor from order_items where order_id = $1`, [orderId]);
      for (const i of items) {
        const net = Number(i.unit_price_minor) * i.qty - Number(i.discount_minor);
        await tx.query(
          `insert into merchant_ledger (merchant_id, currency, kind, amount_minor, order_item_id, available_at) values ($1,$2,'sale',$3,$4, now() + make_interval(days => $5))`,
          [i.merchant_id, o.currency, net, i.id, this.env.PAYOUT_HOLD_DAYS]);
        if (Number(i.fee_minor) > 0) {
          await tx.query(
            `insert into merchant_ledger (merchant_id, currency, kind, amount_minor, order_item_id, available_at) values ($1,$2,'fee',$3,$4, now() + make_interval(days => $5))`,
            [i.merchant_id, o.currency, -Number(i.fee_minor), i.id, this.env.PAYOUT_HOLD_DAYS]);
        }
      }
      // What was bought leaves the cart.
      await tx.query(
        `delete from cart_items c using order_items i
          where i.order_id = $1 and c.user_id = $2 and c.product_id = i.product_id and c.variant_id is not distinct from i.variant_id`, [orderId, o.buyer_id]);
      return true;
    });
  }

  async release(orderId: string, status: 'failed' | 'cancelled') {
    await this.db.tx(async (tx) => {
      const o = await tx.query(`update orders set status = $2 where id = $1 and status = 'pending' returning id, discount_code_id`, [orderId, status]);
      if (o.length) {
        await this.restoreStock(tx, orderId);
        if (o[0].discount_code_id) await tx.query(`update discount_codes set used_count = greatest(used_count - 1, 0) where id = $1`, [o[0].discount_code_id]);
        await tx.query(`insert into order_events (order_id, kind) values ($1,$2)`, [orderId, status]);
      }
    });
  }

  private async restoreStock(tx: Tx, orderId: string) {
    await tx.query(`update products p set stock = stock + i.qty from order_items i where i.order_id = $1 and i.variant_id is null and i.product_id = p.id and p.stock is not null`, [orderId]);
    await tx.query(`update product_variants v set stock = stock + i.qty from order_items i where i.order_id = $1 and i.variant_id = v.id and v.stock is not null`, [orderId]);
  }

  async expireStale() {
    const stale = await this.db.query(`select id from orders where status = 'pending' and created_at < now() - interval '60 minutes'`);
    for (const o of stale) await this.release(o.id, 'cancelled');
    if (stale.length) this.log.log(`Released ${stale.length} unpaid orders`);
  }

  async byProviderRef(provider: string, ref: string) {
    return this.db.one(`select id, total_minor, currency, status from orders where provider = $1 and provider_ref = $2`, [provider, ref]);
  }
}
