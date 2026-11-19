import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { clampLimit, decodeCursor, encodeCursor } from '../common/cursor';
import { Db } from '../db/db.service';
import { Notifications } from '../notifications/notifications.service';

@Injectable()
export class ReviewsService {
  constructor(private db: Db, private notes: Notifications) {}

  async create(userId: string, productId: string, input: { orderItemId: string; rating: number; body?: string }) {
    const item = await this.db.one<any>(
      `select i.id, i.merchant_id, i.title from order_items i join orders o on o.id = i.order_id
        where i.id = $1 and i.product_id = $2 and o.buyer_id = $3 and o.status in ('paid','refunded')`, [input.orderItemId, productId, userId]);
    if (!item) throw new BadRequestException('You can review a product after you have bought it');
    try {
      const [r] = await this.db.query(
        `insert into reviews (product_id, merchant_id, reviewer_id, order_item_id, rating, body) values ($1,$2,$3,$4,$5,$6) returning id`,
        [productId, item.merchant_id, userId, item.id, input.rating, (input.body ?? '').trim()]);
      await this.recount(productId);
      await this.notes.notify({ userId: item.merchant_id, actorId: userId, type: 'review', title: `New ${input.rating}-star review`, body: item.title });
      return this.one(r.id);
    } catch (e: any) {
      if (e.code === '23505') throw new ConflictException('You already reviewed this purchase');
      throw e;
    }
  }

  private async recount(productId: string) {
    await this.db.query(
      `update products set rating_avg = coalesce((select round(avg(rating), 2) from reviews where product_id = $1), 0),
                           rating_count = (select count(*) from reviews where product_id = $1) where id = $1`, [productId]);
  }

  private async one(id: string) {
    const r = await this.db.one(`${SELECT} where r.id = $1`, [id]);
    if (!r) throw new NotFoundException('Review not found');
    return shape(r);
  }

  async list(productId: string, cursor?: string, limitRaw?: unknown) {
    const limit = clampLimit(limitRaw, 20, 50);
    const cur = decodeCursor(cursor);
    const rows = await this.db.query(
      `${SELECT} where r.product_id = $1 and ($2::timestamptz is null or (r.created_at, r.id) < ($2::timestamptz, $3::uuid))
        order by r.created_at desc, r.id desc limit $4`, [productId, cur?.t ?? null, cur?.id ?? null, limit + 1]);
    const page = rows.slice(0, limit);
    const hist = await this.db.query<{ rating: number; n: number }>(`select rating, count(*)::int as n from reviews where product_id = $1 group by rating`, [productId]);
    const histogram = [1, 2, 3, 4, 5].map((s) => hist.find((h) => h.rating === s)?.n ?? 0);
    const count = histogram.reduce((a, b) => a + b, 0);
    const avg = count ? Math.round((histogram.reduce((s, n, i) => s + n * (i + 1), 0) / count) * 100) / 100 : 0;
    const last = page[page.length - 1];
    return { summary: { avg, count, histogram }, items: page.map(shape), nextCursor: rows.length > limit && last ? encodeCursor(last.created_at, last.id) : null };
  }

  async remove(userId: string, id: string) {
    const r = await this.db.one<any>(`delete from reviews where id = $1 and reviewer_id = $2 returning product_id`, [id, userId]);
    if (!r) throw new NotFoundException('Review not found');
    await this.recount(r.product_id);
  }

  async reply(merchantId: string, id: string, reply: string) {
    const r = await this.db.one<any>(`select merchant_id, reviewer_id from reviews where id = $1`, [id]);
    if (!r) throw new NotFoundException('Review not found');
    if (r.merchant_id !== merchantId) throw new ForbiddenException();
    await this.db.query(`update reviews set reply = $2, replied_at = now() where id = $1`, [id, reply]);
    return this.one(id);
  }
}

const SELECT = `select r.*, u.username, u.display_name, u.avatar_url from reviews r join users u on u.id = r.reviewer_id`;
const shape = (r: any) => ({
  id: r.id, productId: r.product_id, rating: r.rating, body: r.body, verified: true, reply: r.reply, repliedAt: r.replied_at, createdAt: r.created_at,
  reviewer: { id: r.reviewer_id, username: r.username, displayName: r.display_name, avatarUrl: r.avatar_url },
});
