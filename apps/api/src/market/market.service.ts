import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { requireTrading } from '../common/gates';
import { Db } from '../db/db.service';
import { SUPPORTED_CURRENCIES } from '../payments/currencies';
import { EmbeddingService } from '../search/embedding.service';
import { InterestService } from '../posts/interests.service';

export const PRODUCT_KINDS = ['physical', 'digital', 'service', 'course', 'food', 'ticket'] as const;

export type ProductInput = {
  title: string; description: string; kind: (typeof PRODUCT_KINDS)[number]; priceMinor: number; currency: string;
  stock: number | null; category: string; tags: string[]; mediaIds: string[]; postId?: string;
};

const MEDIA_JSON = `coalesce((select json_agg(json_build_object('id', m.id, 'kind', m.kind, 'url', m.url, 'thumbUrl', m.thumb_url,
                                       'width', m.width, 'height', m.height, 'durationMs', m.duration_ms) order by pm.position)
                       from product_media pm join media_assets m on m.id = pm.media_id where pm.product_id = p.id), '[]'::json)`;

const VARIANTS_JSON = `coalesce((select json_agg(json_build_object('id', v.id, 'label', v.label, 'options', v.options, 'priceMinor', v.price_minor, 'stock', v.stock,
                                       'inStock', (v.stock is null or v.stock > 0)) order by v.position, v.created_at)
                       from product_variants v where v.product_id = p.id and v.active), '[]'::json)`;

export const toProduct = (r: any) => ({
  id: r.id, title: r.title, description: r.description, kind: r.kind,
  price: { amountMinor: Number(r.price_minor), currency: r.currency },
  stock: r.stock,
  inStock: r.variants?.length ? r.variants.some((v: any) => v.inStock) : r.stock === null || r.stock > 0,
  variants: (r.variants ?? []).map((v: any) => ({ id: v.id, label: v.label, options: v.options, priceMinor: v.priceMinor === null ? null : Number(v.priceMinor), stock: v.stock, inStock: v.inStock })),
  rating: { avg: Number(r.rating_avg ?? 0), count: r.rating_count ?? 0 }, category: r.category, tags: r.tags, status: r.status, postId: r.post_id,
  counts: { likes: r.like_count, saves: r.save_count, sold: r.sold_count },
  createdAt: r.created_at,
  merchant: { userId: r.merchant_id, shopName: r.shop_name, slug: r.slug, verified: r.verified, country: r.merchant_country, avatarUrl: r.avatar_url, rating: { avg: Number(r.m_rating_avg ?? 0), count: r.m_rating_count ?? 0 } },
  media: r.media,
  viewer: { saved: r.saved },
});

@Injectable()
export class MarketService {
  constructor(private db: Db, private embed: EmbeddingService, private interests: InterestService) {}

  // ---------- merchants ----------
  async becomeMerchant(userId: string, input: { shopName: string; slug: string; description: string; country: string }) {
    await requireTrading(this.db, userId, 'sell');
    try {
      await this.db.tx(async (tx) => {
        await tx.query(`insert into merchants (user_id, shop_name, slug, description, country) values ($1,$2,$3,$4,$5)`,
          [userId, input.shopName, input.slug, input.description, input.country.toUpperCase()]);
        await tx.query(`update users set is_merchant = true where id = $1`, [userId]);
      });
    } catch (e: any) {
      if (e.code === '23505') throw new ConflictException(e.constraint === 'merchants_pkey' ? 'You already have a shop' : 'That shop link is taken');
      throw e;
    }
    return this.shop(input.slug);
  }

  async shop(slug: string, viewerId?: string) {
    const m = await this.db.one(
      `select m.*, u.username, u.avatar_url from merchants m join users u on u.id = m.user_id where lower(m.slug) = lower($1) and u.deleted_at is null`, [slug]);
    if (!m) throw new NotFoundException('Shop not found');
    const ids = await this.db.query(`select id from products where merchant_id = $1 and status = 'active' order by created_at desc limit 60`, [m.user_id]);
    return {
      userId: m.user_id, shopName: m.shop_name, slug: m.slug, description: m.description, country: m.country, verified: m.verified,
      username: m.username, avatarUrl: m.avatar_url, rating: await this.shopRating(m.user_id),
      products: await this.hydrate(ids.map((r) => r.id), viewerId),
    };
  }

  async shopRating(merchantId: string) {
    const r = await this.db.one<any>(`select coalesce(round(avg(rating), 2), 0) as avg, count(*)::int as n from reviews where merchant_id = $1`, [merchantId]);
    return { avg: Number(r?.avg ?? 0), count: r?.n ?? 0 };
  }

  // ---------- products ----------
  async hydrate(ids: string[], viewerId?: string) {
    if (ids.length === 0) return [];
    const rows = await this.db.query(
      `select p.*, m.shop_name, m.slug, m.verified, m.country as merchant_country, u.avatar_url, ${MEDIA_JSON} as media, ${VARIANTS_JSON} as variants,
              (select coalesce(round(avg(rv.rating), 2), 0) from reviews rv where rv.merchant_id = p.merchant_id) as m_rating_avg,
              (select count(*)::int from reviews rv where rv.merchant_id = p.merchant_id) as m_rating_count,
              exists(select 1 from saves s where s.product_id = p.id and s.user_id = $2::uuid) as saved
         from products p join merchants m on m.user_id = p.merchant_id join users u on u.id = p.merchant_id
        where p.id = any($1::uuid[])`,
      [ids, viewerId ?? null],
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids.map((id) => byId.get(id)).filter(Boolean).map(toProduct);
  }

  private async checkMedia(userId: string, mediaIds: string[]) {
    const found = await this.db.query(`select id from media_assets where id = any($1::uuid[]) and owner_id = $2 and status <> 'failed'`, [mediaIds, userId]);
    if (found.length !== new Set(mediaIds).size) throw new BadRequestException('One or more product files were not found');
  }

  private async requireMerchant(userId: string) {
    const m = await this.db.one(`select 1 from merchants where user_id = $1`, [userId]);
    if (!m) throw new ForbiddenException('Open a shop before selling');
  }

  async create(userId: string, input: ProductInput) {
    await this.requireMerchant(userId);
    if (!(SUPPORTED_CURRENCIES as readonly string[]).includes(input.currency)) throw new BadRequestException(`Unsupported currency. Use one of: ${SUPPORTED_CURRENCIES.join(', ')}`);
    await this.checkMedia(userId, input.mediaIds);
    if (input.postId) {
      const post = await this.db.one(`select 1 from posts where id = $1 and author_id = $2 and status <> 'removed'`, [input.postId, userId]);
      if (!post) throw new BadRequestException('That post is not yours');
    }
    const tags = [...new Set(input.tags.map((t) => t.toLowerCase().replace(/^#/, '').trim()).filter(Boolean))].slice(0, 15);
    const id = await this.db.tx(async (tx) => {
      const [{ id }] = await tx.query(
        `insert into products (merchant_id, title, description, kind, price_minor, currency, stock, category, tags, post_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
        [userId, input.title.trim(), input.description.trim(), input.kind, input.priceMinor, input.currency, input.stock, input.category.toLowerCase(), tags, input.postId ?? null],
      );
      for (const [i, mediaId] of input.mediaIds.entries()) await tx.query(`insert into product_media (product_id, media_id, position) values ($1,$2,$3)`, [id, mediaId, i]);
      return id as string;
    });
    this.embed.indexProduct(id);
    return (await this.hydrate([id], userId))[0];
  }

  async update(userId: string, id: string, patch: Partial<Omit<ProductInput, 'mediaIds' | 'currency' | 'kind'>> & { status?: 'draft' | 'active' | 'archived' }) {
    const owned = await this.db.one(`select 1 from products where id = $1 and merchant_id = $2`, [id, userId]);
    if (!owned) throw new NotFoundException('Product not found');
    await this.db.query(
      `update products set title = coalesce($3, title), description = coalesce($4, description), price_minor = coalesce($5, price_minor),
              stock = case when $6::boolean then $7 else stock end, category = coalesce($8, category), tags = coalesce($9, tags), status = coalesce($10, status)
        where id = $1 and merchant_id = $2`,
      [id, userId, patch.title?.trim() ?? null, patch.description?.trim() ?? null, patch.priceMinor ?? null,
       patch.stock !== undefined, patch.stock ?? null, patch.category?.toLowerCase() ?? null,
       patch.tags ? [...new Set(patch.tags.map((t) => t.toLowerCase().replace(/^#/, '').trim()).filter(Boolean))].slice(0, 15) : null, patch.status ?? null],
    );
    this.embed.indexProduct(id);
    return (await this.hydrate([id], userId))[0];
  }

  async get(id: string, viewerId?: string) {
    const [p] = await this.hydrate([id], viewerId);
    if (!p || (p.status !== 'active' && p.merchant.userId !== viewerId)) throw new NotFoundException('Product not found');
    return p;
  }

  async mine(userId: string) {
    const ids = await this.db.query(`select id from products where merchant_id = $1 and status <> 'archived' order by created_at desc limit 200`, [userId]);
    return { items: await this.hydrate(ids.map((r) => r.id), userId) };
  }

  async saveProduct(userId: string, id: string, save: boolean, collectionId?: string) {
    const p = await this.db.one(`select tags from products where id = $1 and status = 'active'`, [id]);
    if (!p) throw new NotFoundException('Product not found');
    if (collectionId && !(await this.db.one(`select 1 from collections where id = $1 and owner_id = $2`, [collectionId, userId]))) throw new BadRequestException('Board not found');
    let fresh = false;
    await this.db.tx(async (tx) => {
      if (save) {
        const ins = await tx.query(`insert into saves (user_id, product_id, collection_id) values ($1,$2,$3) on conflict (user_id, product_id) where product_id is not null do update set collection_id = coalesce(excluded.collection_id, saves.collection_id) returning (xmax = 0) as inserted`, [userId, id, collectionId ?? null]);
        fresh = !!ins[0]?.inserted;
        if (fresh) await tx.query(`update products set save_count = save_count + 1 where id = $1`, [id]);
      } else {
        const del = await tx.query(`delete from saves where user_id = $1 and product_id = $2 returning 1`, [userId, id]);
        if (del.length) await tx.query(`update products set save_count = greatest(save_count - 1, 0) where id = $1`, [id]);
      }
    });
    if (fresh) await this.interests.bump(userId, p.tags, 2);
    return { saved: save };
  }

  // ---------- the marketplace grid ----------
  async grid(userId: string | undefined, q: { cursor?: string; limit: number; category?: string; kind?: string }) {
    const profile = userId ? await this.db.one(`select country from users where id = $1`, [userId]) : null;
    const interests = userId ? await this.interests.top(userId) : new Map<string, number>();
    const rows = await this.db.query(
      `with base as materialized (
         select p.id, p.tags, p.created_at, p.sold_count, p.save_count, p.like_count, m.verified, m.country
           from products p join merchants m on m.user_id = p.merchant_id join users u on u.id = p.merchant_id
          where p.status = 'active' and (p.stock is null or p.stock > 0) and u.deleted_at is null
            and ($1::text is null or p.category = $1) and ($2::text is null or p.kind = $2)
            and p.merchant_id is distinct from $3::uuid
       )
       select * from base where id in (
         (select id from base order by created_at desc limit 150)
         union (select id from base order by (sold_count * 3 + save_count * 2 + like_count) desc limit 100)
         union (select id from base where tags && $4::text[] limit 100))`,
      [q.category?.toLowerCase() ?? null, q.kind ?? null, userId ?? null, [...interests.keys()]],
    );
    const now = Date.now();
    const ranked = rows.map((r) => {
      const I = Math.min(1, r.tags.reduce((s: number, t: string) => s + (interests.get(t) ?? 0), 0) / 5);
      const P = Math.min(1, Math.log(1 + r.sold_count * 3 + r.save_count * 2 + r.like_count) / Math.log(50));
      const R = Math.exp(-((now - new Date(r.created_at).getTime()) / 3.6e6) / 168);
      const L = profile?.country && r.country === profile.country ? 1 : 0;
      return { id: r.id as string, score: 0.35 * I + 0.25 * P + 0.2 * R + 0.1 * (r.verified ? 1 : 0) + 0.1 * L };
    }).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

    const offset = q.cursor ? Number.parseInt(Buffer.from(q.cursor, 'base64url').toString(), 10) || 0 : 0;
    const slice = ranked.slice(offset, offset + q.limit);
    const next = offset + q.limit < ranked.length ? Buffer.from(String(offset + q.limit)).toString('base64url') : null;
    return { items: await this.hydrate(slice.map((s) => s.id), userId), nextCursor: next };
  }

  async similar(id: string, viewerId?: string, limit = 12) {
    const base = await this.db.one(`select title, tags, embedding is not null as has_vec from products where id = $1 and status = 'active'`, [id]);
    if (!base) throw new NotFoundException('Product not found');
    const rows = base.has_vec
      ? await this.db.query(
          `select p.id from products p, (select embedding from products where id = $1) me
            where p.id <> $1 and p.status = 'active' and p.embedding is not null
            order by p.embedding <=> me.embedding limit $2`, [id, limit])
      // Without embeddings, fall back to shared tags and similar titles.
      : await this.db.query(
          `select p.id from products p
            where p.id <> $1 and p.status = 'active'
            order by cardinality(array(select unnest(p.tags) intersect select unnest($2::text[]))) desc,
                     similarity(lower(p.title), lower($3)) desc, p.created_at desc limit $4`, [id, base.tags, base.title, limit]);
    return { items: await this.hydrate(rows.map((r) => r.id), viewerId) };
  }
}
