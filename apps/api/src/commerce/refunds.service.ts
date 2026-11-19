import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ENV, Env } from '../config/env';
import { Db } from '../db/db.service';
import { Notifications } from '../notifications/notifications.service';
import { FlutterwaveGateway, StripeGateway } from '../payments/gateways';
import { canRequestRefund } from '../orders/rules';

const shape = (r: any) => ({
  id: r.id, orderItemId: r.order_item_id, orderId: r.order_id, title: r.title, variantLabel: r.variant_label ?? null, reason: r.reason, details: r.details,
  amountMinor: Number(r.amount_minor), currency: r.currency, status: r.status, response: r.response, error: r.refund_error,
  buyerName: r.buyer_name ?? null, shopName: r.shop_name ?? null, createdAt: r.created_at, decidedAt: r.decided_at,
});

const SELECT = `select r.*, i.order_id, i.title, i.variant_label, o.currency, u.display_name as buyer_name, m.shop_name
                  from refund_requests r join order_items i on i.id = r.order_item_id join orders o on o.id = i.order_id
                  join users u on u.id = r.buyer_id join merchants m on m.user_id = r.merchant_id`;

@Injectable()
export class RefundsService {
  private log = new Logger('Refunds');
  constructor(private db: Db, private stripe: StripeGateway, private flw: FlutterwaveGateway, private notes: Notifications, @Inject(ENV) private env: Env) {}

  async request(buyerId: string, itemId: string, input: { reason: string; details?: string }) {
    const row = await this.db.one<any>(
      `select i.*, o.status as o_status, o.paid_at, o.buyer_id,
              (select status from refund_requests r where r.order_item_id = i.id order by created_at desc limit 1) as refund_status
         from order_items i join orders o on o.id = i.order_id where i.id = $1 and o.buyer_id = $2`, [itemId, buyerId]);
    if (!row) throw new NotFoundException('Order item not found');
    if (!canRequestRefund(row, { status: row.o_status, paid_at: row.paid_at }, this.env.RETURN_WINDOW_DAYS)) {
      throw new BadRequestException('This item cannot be returned right now. Items can be returned within ' + this.env.RETURN_WINDOW_DAYS + ' days of delivery.');
    }
    const amount = Number(row.unit_price_minor) * row.qty - Number(row.discount_minor) - Number(row.refunded_minor);
    if (amount <= 0) throw new BadRequestException('Nothing left to refund');
    const [r] = await this.db.query(
      `insert into refund_requests (order_item_id, buyer_id, merchant_id, reason, details, amount_minor) values ($1,$2,$3,$4,$5,$6) returning id`,
      [itemId, buyerId, row.merchant_id, input.reason, input.details ?? null, amount]);
    await this.db.query(`insert into order_events (order_id, item_id, kind, note) values ($1,$2,'refund_requested',$3)`, [row.order_id, itemId, input.reason]);
    await this.notes.notify({ userId: row.merchant_id, actorId: buyerId, type: 'refund', orderId: row.order_id, title: 'Return requested', body: `${row.title}: ${input.reason}` });
    return this.one(r.id);
  }

  private async one(id: string) {
    const r = await this.db.one(`${SELECT} where r.id = $1`, [id]);
    if (!r) throw new NotFoundException('Request not found');
    return shape(r);
  }

  async forMerchant(merchantId: string) {
    return { items: (await this.db.query(`${SELECT} where r.merchant_id = $1 order by r.created_at desc limit 100`, [merchantId])).map(shape) };
  }

  async forAdmin(status?: string) {
    const rows = await this.db.query(`${SELECT} where ($1::text is null or r.status = $1) order by r.created_at desc limit 100`, [status ?? null]);
    return { items: rows.map(shape) };
  }

  /** The shop (or an admin) approves or turns down. Approving pays the buyer back through the payment provider. */
  async decide(actor: { id: string; admin: boolean }, id: string, decision: 'approve' | 'reject', response?: string) {
    const r = await this.db.one<any>(`select * from refund_requests where id = $1`, [id]);
    if (!r) throw new NotFoundException('Request not found');
    if (!actor.admin && r.merchant_id !== actor.id) throw new ForbiddenException();
    if (r.status !== 'requested' && !(r.status === 'approved' && decision === 'approve')) throw new BadRequestException('This request has already been decided');
    const item = await this.db.one<any>(`select order_id, title from order_items where id = $1`, [r.order_item_id]);
    if (decision === 'reject') {
      await this.db.query(`update refund_requests set status='rejected', response=$2, decided_by=$3, decided_at=now() where id=$1`, [id, response ?? null, actor.id]);
      await this.db.query(`insert into order_events (order_id, item_id, kind, note) values ($1,$2,'refund_rejected',$3)`, [item.order_id, r.order_item_id, response ?? null]);
      await this.notes.notify({ userId: r.buyer_id, type: 'refund', orderId: item.order_id, title: 'Return request declined', body: response || item.title });
      return this.one(id);
    }
    if (r.status === 'requested') {
      await this.db.query(`update refund_requests set status='approved', response=$2, decided_by=$3, decided_at=now() where id=$1`, [id, response ?? null, actor.id]);
      await this.db.query(`insert into order_events (order_id, item_id, kind, note) values ($1,$2,'refund_approved',$3)`, [item.order_id, r.order_item_id, response ?? null]);
    }
    await this.pay(id);
    return this.one(id);
  }

  /** Send the money back. If the provider fails the request stays "approved" with the error, and can be retried. */
  private async pay(id: string) {
    const r = await this.db.one<any>(
      `select r.*, o.id as order_id, o.provider, o.provider_ref, o.currency, i.fee_minor, i.qty, i.unit_price_minor, i.discount_minor, i.title
         from refund_requests r join order_items i on i.id = r.order_item_id join orders o on o.id = i.order_id where r.id = $1`, [id]);
    try {
      if (r.provider === 'stripe') await this.stripe.refund(r.provider_ref, Number(r.amount_minor));
      else await this.flw.refund(r.provider_ref, Number(r.amount_minor));
    } catch (e: any) {
      this.log.error(`refund ${id} failed: ${e?.message}`);
      await this.db.query(`update refund_requests set refund_error = $2 where id = $1`, [id, String(e?.message ?? e).slice(0, 300)]);
      return;
    }
    const full = Number(r.amount_minor) >= Number(r.unit_price_minor) * r.qty - Number(r.discount_minor);
    await this.db.tx(async (tx) => {
      await tx.query(`update refund_requests set status='refunded', refund_error=null where id=$1`, [id]);
      await tx.query(`update order_items set refunded_minor = refunded_minor + $2 where id = $1`, [r.order_item_id, r.amount_minor]);
      // Take it back from the shop in step with the original sale, so a held sale and its refund cancel out together.
      const sale = await tx.query(`select max(available_at) as at from merchant_ledger where order_item_id = $1 and kind = 'sale'`, [r.order_item_id]);
      const at = sale[0]?.at ?? new Date();
      await tx.query(`insert into merchant_ledger (merchant_id, currency, kind, amount_minor, order_item_id, available_at) values ($1,$2,'refund',$3,$4,$5)`,
        [r.merchant_id, r.currency, -Number(r.amount_minor), r.order_item_id, at]);
      if (full && Number(r.fee_minor) > 0) {
        await tx.query(`insert into merchant_ledger (merchant_id, currency, kind, amount_minor, order_item_id, available_at) values ($1,$2,'fee_refund',$3,$4,$5)`,
          [r.merchant_id, r.currency, Number(r.fee_minor), r.order_item_id, at]);
      }
      await tx.query(`insert into order_events (order_id, item_id, kind) values ($1,$2,'refunded')`, [r.order_id, r.order_item_id]);
      const left = await tx.query(`select 1 from order_items where order_id = $1 and refunded_minor < unit_price_minor * qty - discount_minor limit 1`, [r.order_id]);
      if (!left.length) await tx.query(`update orders set status = 'refunded' where id = $1`, [r.order_id]);
    });
    await this.notes.notify({ userId: r.buyer_id, type: 'refund', orderId: r.order_id, title: 'Refund sent', body: r.title });
  }
}
