import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { clampLimit, decodeCursor, encodeCursor } from '../common/cursor';
import { Db } from '../db/db.service';
import { Notifications } from '../notifications/notifications.service';

const shape = (r: any) => ({
  id: r.id, currency: r.currency, amountMinor: Number(r.amount_minor), status: r.status, destination: r.destination, reference: r.reference, note: r.note,
  createdAt: r.created_at, handledAt: r.handled_at, shopName: r.shop_name ?? undefined, merchantId: r.merchant_id,
});

@Injectable()
export class PayoutsService {
  constructor(private db: Db, private notes: Notifications) {}

  /** What a shop has earned, what BMUETTE kept, what is still being held, and what can be taken out now. */
  async balance(merchantId: string) {
    const rows = await this.db.query(
      `select currency,
              coalesce(sum(amount_minor) filter (where kind = 'sale'), 0)::int8 as earned,
              coalesce(-sum(amount_minor) filter (where kind = 'fee'), 0)::int8 + coalesce(sum(amount_minor) filter (where kind = 'fee_refund'), 0)::int8 * -1 as fees,
              coalesce(-sum(amount_minor) filter (where kind = 'refund'), 0)::int8 as refunds,
              coalesce(-sum(amount_minor) filter (where kind in ('payout','payout_reversal')), 0)::int8 as paid_out,
              coalesce(sum(amount_minor) filter (where available_at <= now()), 0)::int8 as available,
              coalesce(sum(amount_minor) filter (where available_at > now()), 0)::int8 as pending
         from merchant_ledger where merchant_id = $1 group by currency order by currency`, [merchantId]);
    const m = await this.db.one<any>(`select payout_details from users where id = $1`, [merchantId]);
    return {
      payoutDetails: m?.payout_details ?? null,
      balances: rows.map((r) => ({
        currency: r.currency, earnedMinor: Number(r.earned), feesMinor: Number(r.fees), refundsMinor: Number(r.refunds), paidOutMinor: Number(r.paid_out),
        availableMinor: Math.max(0, Number(r.available)), pendingMinor: Number(r.pending),
      })),
    };
  }

  async ledger(merchantId: string, cursor?: string, limitRaw?: unknown) {
    const limit = clampLimit(limitRaw, 30, 100);
    const cur = decodeCursor(cursor);
    const rows = await this.db.query(
      `select l.*, i.title from merchant_ledger l left join order_items i on i.id = l.order_item_id
        where l.merchant_id = $1 and ($2::timestamptz is null or (l.created_at, l.id) < ($2::timestamptz, $3::bigint))
        order by l.created_at desc, l.id desc limit $4`, [merchantId, cur?.t ?? null, cur?.id ?? null, limit + 1]);
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map((r) => ({ id: Number(r.id), kind: r.kind, currency: r.currency, amountMinor: Number(r.amount_minor), title: r.title, availableAt: r.available_at, createdAt: r.created_at })),
      nextCursor: rows.length > limit && last ? encodeCursor(last.created_at, String(last.id)) : null,
    };
  }

  async setDetails(merchantId: string, details: string) {
    await this.db.query(`update users set payout_details = $2 where id = $1`, [merchantId, details.trim() || null]);
    return { ok: true };
  }

  async request(merchantId: string, input: { currency: string; amountMinor?: number }) {
    const created = await this.db.tx(async (tx) => {
      const m = (await tx.query(`select payout_details, email_verified_at, is_adult, banned_at from users where id = $1 and deleted_at is null for update`, [merchantId]))[0];
      if (!m || m.banned_at) throw new BadRequestException('This account cannot take payouts');
      if (!m.email_verified_at) throw new BadRequestException('Verify your email before taking a payout');
      if (!m.is_adult) throw new BadRequestException('You must be 18 or over to take a payout');
      if (!m.payout_details) throw new BadRequestException('Add your bank details first');
      const [{ available }] = await tx.query(
        `select coalesce(sum(amount_minor) filter (where available_at <= now()), 0)::int8 as available from merchant_ledger where merchant_id = $1 and currency = $2`,
        [merchantId, input.currency]);
      const amount = input.amountMinor ?? Number(available);
      if (amount <= 0) throw new BadRequestException('Nothing is available to pay out yet');
      if (amount > Number(available)) throw new BadRequestException('That is more than you have available');
      const [p] = await tx.query(`insert into payout_requests (merchant_id, currency, amount_minor, destination) values ($1,$2,$3,$4) returning *`, [merchantId, input.currency, amount, m.payout_details]);
      await tx.query(`insert into merchant_ledger (merchant_id, currency, kind, amount_minor, payout_id, note) values ($1,$2,'payout',$3,$4,'Payout requested')`, [merchantId, input.currency, -amount, p.id]);
      return p;
    });
    return shape(created);
  }

  async mine(merchantId: string) {
    return { items: (await this.db.query(`select * from payout_requests where merchant_id = $1 order by created_at desc limit 50`, [merchantId])).map(shape) };
  }

  // ---------- admin ----------
  async forAdmin(status?: string) {
    const rows = await this.db.query(
      `select p.*, coalesce(m.shop_name, u.display_name) as shop_name from payout_requests p join users u on u.id = p.merchant_id left join merchants m on m.user_id = p.merchant_id where ($1::text is null or p.status = $1) order by p.created_at desc limit 100`, [status ?? null]);
    return { items: rows.map(shape) };
  }

  async markPaid(adminId: string, id: string, reference: string) {
    const r = await this.db.one<any>(`update payout_requests set status='paid', reference=$2, handled_by=$3, handled_at=now() where id=$1 and status='requested' returning *`, [id, reference, adminId]);
    if (!r) throw new NotFoundException('Payout not found or already handled');
    await this.db.query(`insert into admin_actions (admin_id, action, target_type, target_id, note) values ($1,'payout_paid','payout',$2,$3)`, [adminId, id, reference]);
    await this.notes.notify({ userId: r.merchant_id, type: 'payout', title: 'Payout sent', body: `${(Number(r.amount_minor) / 100).toLocaleString()} ${r.currency}` });
    return shape(r);
  }

  async reject(adminId: string, id: string, note: string) {
    const r = await this.db.tx(async (tx) => {
      const rows = await tx.query(`update payout_requests set status='rejected', note=$2, handled_by=$3, handled_at=now() where id=$1 and status='requested' returning *`, [id, note, adminId]);
      if (!rows.length) return null;
      const p = rows[0];
      await tx.query(`insert into merchant_ledger (merchant_id, currency, kind, amount_minor, payout_id, note) values ($1,$2,'payout_reversal',$3,$4,$5)`, [p.merchant_id, p.currency, p.amount_minor, p.id, note]);
      return p;
    });
    if (!r) throw new NotFoundException('Payout not found or already handled');
    await this.db.query(`insert into admin_actions (admin_id, action, target_type, target_id, note) values ($1,'payout_rejected','payout',$2,$3)`, [adminId, id, note]);
    await this.notes.notify({ userId: r.merchant_id, type: 'payout', title: 'Payout declined', body: note });
    return shape(r);
  }
}
