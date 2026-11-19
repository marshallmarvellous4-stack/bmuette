import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Db } from '../db/db.service';

export type DiscountInput = { code: string; kind: 'percent' | 'fixed'; value: number; currency?: string; minSubtotalMinor?: number; maxUses?: number | null; expiresAt?: string | null };

const shape = (r: any) => ({
  id: r.id, code: r.code, kind: r.kind, value: Number(r.value), currency: r.currency, minSubtotalMinor: Number(r.min_subtotal_minor),
  maxUses: r.max_uses, usedCount: r.used_count, expiresAt: r.expires_at, active: r.active, createdAt: r.created_at,
});

@Injectable()
export class DiscountsService {
  constructor(private db: Db) {}

  private async requireMerchant(id: string) {
    if (!(await this.db.one(`select 1 from merchants where user_id = $1`, [id]))) throw new BadRequestException('Open a shop first');
  }

  async list(merchantId: string) {
    return { items: (await this.db.query(`select * from discount_codes where merchant_id = $1 order by created_at desc limit 100`, [merchantId])).map(shape) };
  }

  async create(merchantId: string, i: DiscountInput) {
    await this.requireMerchant(merchantId);
    if (i.kind === 'percent' && (i.value < 1 || i.value > 90)) throw new BadRequestException('A percentage must be between 1 and 90');
    if (i.kind === 'fixed' && !i.currency) throw new BadRequestException('A fixed discount needs a currency');
    try {
      const [r] = await this.db.query(
        `insert into discount_codes (merchant_id, code, kind, value, currency, min_subtotal_minor, max_uses, expires_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
        [merchantId, i.code.toUpperCase(), i.kind, i.value, i.kind === 'fixed' ? i.currency : null, i.minSubtotalMinor ?? 0, i.maxUses ?? null, i.expiresAt ?? null]);
      return shape(r);
    } catch (e: any) {
      if (e.code === '23505') throw new ConflictException('You already have a code with that name');
      throw e;
    }
  }

  async update(merchantId: string, id: string, p: { active?: boolean; maxUses?: number | null; expiresAt?: string | null }) {
    const r = await this.db.query(
      `update discount_codes set active = coalesce($3, active),
              max_uses = case when $4::boolean then $5 else max_uses end, expires_at = case when $6::boolean then $7::timestamptz else expires_at end
        where id = $1 and merchant_id = $2 returning *`,
      [id, merchantId, p.active ?? null, p.maxUses !== undefined, p.maxUses ?? null, p.expiresAt !== undefined, p.expiresAt ?? null]);
    if (!r.length) throw new NotFoundException('Code not found');
    return shape(r[0]);
  }

  async remove(merchantId: string, id: string) {
    // Orders keep pointing at the code for their history, so a used code is switched off, not deleted.
    const r = await this.db.query(`select used_count from discount_codes where id = $1 and merchant_id = $2`, [id, merchantId]);
    if (!r.length) throw new NotFoundException('Code not found');
    if (r[0].used_count > 0) await this.db.query(`update discount_codes set active = false where id = $1`, [id]);
    else await this.db.query(`delete from discount_codes where id = $1`, [id]);
  }
}
