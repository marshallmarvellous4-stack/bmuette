import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Db } from '../db/db.service';
import { OrdersService, Shipping } from '../orders/orders.service';

@Injectable()
export class CartService {
  constructor(private db: Db, private orders: OrdersService) {}

  async get(userId: string) {
    const rows = await this.db.query(
      `select c.id, c.qty, c.product_id, c.variant_id, p.title, p.price_minor, p.currency, p.stock as p_stock, p.status, p.merchant_id,
              v.label as v_label, v.price_minor as v_price, v.stock as v_stock, v.active as v_active,
              m.shop_name, m.slug,
              (select count(*) from product_variants x where x.product_id = p.id and x.active) as variant_count,
              (select coalesce(mm.thumb_url, mm.url) from product_media pm join media_assets mm on mm.id = pm.media_id where pm.product_id = p.id order by pm.position limit 1) as thumb
         from cart_items c join products p on p.id = c.product_id join merchants m on m.user_id = p.merchant_id
         left join product_variants v on v.id = c.variant_id
        where c.user_id = $1 order by c.created_at desc`, [userId]);
    const items = rows.map((r) => {
      const stock = r.variant_id ? r.v_stock : r.p_stock;
      let issue: string | null = null;
      if (r.status !== 'active') issue = 'No longer available';
      else if (r.variant_id && !r.v_active) issue = 'This option is no longer available';
      else if (!r.variant_id && Number(r.variant_count) > 0) issue = 'Choose an option';
      else if (stock !== null && stock === 0) issue = 'Out of stock';
      else if (stock !== null && stock < r.qty) issue = `Only ${stock} left`;
      return {
        id: r.id, productId: r.product_id, variantId: r.variant_id, qty: r.qty, title: r.title, variantLabel: r.v_label ?? null,
        unitPriceMinor: Number(r.v_price ?? r.price_minor), currency: r.currency, thumbUrl: r.thumb, issue,
        merchant: { userId: r.merchant_id, shopName: r.shop_name, slug: r.slug },
      };
    });
    const groups = new Map<string, { currency: string; subtotalMinor: number; count: number; ready: boolean }>();
    for (const i of items) {
      const g = groups.get(i.currency) ?? { currency: i.currency, subtotalMinor: 0, count: 0, ready: true };
      g.subtotalMinor += i.unitPriceMinor * i.qty; g.count += i.qty; if (i.issue) g.ready = false;
      groups.set(i.currency, g);
    }
    return { items, groups: [...groups.values()], count: items.reduce((s, i) => s + i.qty, 0) };
  }

  async count(userId: string) {
    const r = await this.db.one<{ n: number }>(`select coalesce(sum(qty),0)::int as n from cart_items where user_id = $1`, [userId]);
    return { count: r?.n ?? 0 };
  }

  async add(userId: string, input: { productId: string; variantId?: string | null; qty: number }) {
    const p = await this.db.one<any>(`select id, merchant_id, stock, title from products where id = $1 and status = 'active'`, [input.productId]);
    if (!p) throw new NotFoundException('Product not found');
    if (p.merchant_id === userId) throw new BadRequestException('You cannot buy your own product');
    const variants = await this.db.query(`select id, stock from product_variants where product_id = $1 and active`, [p.id]);
    let stock = p.stock as number | null;
    if (variants.length) {
      if (!input.variantId) throw new BadRequestException('Choose an option first');
      const v = variants.find((x) => x.id === input.variantId);
      if (!v) throw new BadRequestException('That option is not available');
      stock = v.stock;
    } else if (input.variantId) throw new BadRequestException('This product has no options');
    const existing = await this.db.one<any>(
      `select qty from cart_items where user_id = $1 and product_id = $2 and variant_id is not distinct from $3`, [userId, p.id, input.variantId ?? null]);
    const qty = Math.min(20, (existing?.qty ?? 0) + input.qty);
    if (stock !== null && qty > stock) throw new BadRequestException(stock === 0 ? 'Out of stock' : `Only ${stock} available`);
    await this.db.query(
      `insert into cart_items (user_id, product_id, variant_id, qty) values ($1,$2,$3,$4)
       on conflict (user_id, product_id, coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set qty = $4`,
      [userId, p.id, input.variantId ?? null, qty]);
    return this.get(userId);
  }

  async setQty(userId: string, id: string, qty: number) {
    const r = await this.db.query(`update cart_items set qty = $3 where id = $1 and user_id = $2 returning id`, [id, userId, qty]);
    if (!r.length) throw new NotFoundException('Cart item not found');
    return this.get(userId);
  }

  async remove(userId: string, id: string) {
    await this.db.query(`delete from cart_items where id = $1 and user_id = $2`, [id, userId]);
    return this.get(userId);
  }

  async clear(userId: string) {
    await this.db.query(`delete from cart_items where user_id = $1`, [userId]);
    return this.get(userId);
  }

  /** Check out everything in the cart that uses one currency. Other currencies stay in the cart. */
  async checkout(userId: string, input: { currency: string; code?: string | null; shipping?: Shipping }) {
    const cart = await this.get(userId);
    const lines = cart.items.filter((i) => i.currency === input.currency);
    if (!lines.length) throw new BadRequestException('Your cart has nothing in that currency');
    const bad = lines.find((i) => i.issue);
    if (bad) throw new BadRequestException(`${bad.title}: ${bad.issue}`);
    return this.orders.create(userId, { items: lines.map((i) => ({ productId: i.productId, variantId: i.variantId, qty: i.qty })), code: input.code, shipping: input.shipping });
  }
}
