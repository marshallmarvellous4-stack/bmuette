import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { clampLimit, decodeCursor, encodeCursor } from '../common/cursor';
import { Db } from '../db/db.service';
import { VideoProvider } from '../media/video';
import { EmbeddingService } from '../search/embedding.service';

export const CTA_KINDS = ['buy', 'book', 'enroll', 'join_event', 'order_food', 'expert'] as const;
export type PostEdit = { trimStartMs?: number; trimEndMs?: number; filter: string; texts: { text: string; x: number; y: number; color: string; size: number }[] };
export type TaggedProduct = { productId: string; atMs?: number | null };
export type Cta = { kind: (typeof CTA_KINDS)[number]; productId?: string; label?: string };

// Each action can only point at the right kind of product, so "Book" never opens a sneaker.
const CTA_PRODUCT_KINDS: Record<string, string[]> = {
  buy: ['physical', 'digital'], book: ['service'], enroll: ['course'], join_event: ['ticket'], order_food: ['food'],
};

export const toPost = (r: any) => ({
  id: r.id, kind: r.kind, caption: r.caption, tags: r.tags, cta: r.cta, allowDownload: r.allow_download, status: r.status,
  createdAt: r.created_at,
  counts: { likes: r.like_count, comments: r.comment_count, saves: r.save_count, shares: r.share_count, views: r.view_count },
  author: { id: r.author_id, username: r.username, displayName: r.display_name, avatarUrl: r.avatar_url, isMerchant: r.is_merchant },
  media: r.media,
  sound: r.sound ?? null, products: r.products ?? [], soundVolume: r.sound_volume, originalVolume: r.original_volume, edit: r.edit ?? null,
  viewer: { liked: r.liked, saved: r.saved, following: r.following },
});

@Injectable()
export class PostsService {
  constructor(private db: Db, private video: VideoProvider, private embed: EmbeddingService) {}

  /** Loads full posts for a list of ids, keeping the order given. Shared by feed, profile, search and boards. */
  async hydrate(ids: string[], viewerId?: string) {
    if (ids.length === 0) return [];
    const rows = await this.db.query(
      `select p.*, u.username, u.display_name, u.avatar_url, u.is_merchant,
              coalesce((select json_agg(json_build_object('id', m.id, 'kind', m.kind, 'url', m.url, 'thumbUrl', m.thumb_url,
                                                         'width', m.width, 'height', m.height, 'durationMs', m.duration_ms) order by pm.position)
                          from post_media pm join media_assets m on m.id = pm.media_id where pm.post_id = p.id), '[]'::json) as media,
              (select json_build_object('id', s.id, 'title', s.title, 'artist', s.artist, 'url', s.url, 'durationMs', s.duration_ms, 'color', s.color) from sounds s where s.id = p.sound_id) as sound,
              coalesce((select json_agg(json_build_object('id', pr.id, 'title', pr.title, 'priceMinor', pr.price_minor, 'currency', pr.currency, 'atMs', pp.at_ms,
                                                         'inStock', (pr.stock is null or pr.stock > 0 or exists(select 1 from product_variants v where v.product_id = pr.id and v.active and (v.stock is null or v.stock > 0))),
                                                         'hasVariants', exists(select 1 from product_variants v where v.product_id = pr.id and v.active),
                                                         'thumbUrl', (select coalesce(a.thumb_url, a.url) from product_media pm2 join media_assets a on a.id = pm2.media_id where pm2.product_id = pr.id order by pm2.position limit 1))
                                                         order by pp.position)
                          from post_products pp join products pr on pr.id = pp.product_id where pp.post_id = p.id and pr.status = 'active'), '[]'::json) as products,
              exists(select 1 from likes l where l.post_id = p.id and l.user_id = $2::uuid) as liked,
              exists(select 1 from saves s where s.post_id = p.id and s.user_id = $2::uuid) as saved,
              exists(select 1 from follows f where f.follower_id = $2::uuid and f.followee_id = p.author_id) as following
         from posts p join users u on u.id = p.author_id
        where p.id = any($1::uuid[])`,
      [ids, viewerId ?? null],
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids.map((id) => byId.get(id)).filter(Boolean).map(toPost);
  }

  async create(
    userId: string,
    input: { kind: 'video' | 'photo'; caption: string; tags: string[]; mediaIds: string[]; cta?: Cta; allowDownload: boolean; soundId?: string; soundVolume?: number; originalVolume?: number; edit?: PostEdit; products?: TaggedProduct[] },
  ) {
    // #hashtags typed in the caption count as tags too.
    const fromCaption = [...input.caption.matchAll(/#([\p{L}\p{N}_]{1,40})/gu)].map((m) => m[1]);
    const tags = [...new Set([...input.tags, ...fromCaption].map((t) => t.toLowerCase().replace(/^#/, '').trim()).filter(Boolean))].slice(0, 15);
    const media = await this.db.query(`select * from media_assets where id = any($1::uuid[]) and owner_id = $2`, [input.mediaIds, userId]);
    if (media.length !== new Set(input.mediaIds).size) throw new BadRequestException('One or more files were not found');
    const wantKind = input.kind === 'video' ? 'video' : 'image';
    if (media.some((m) => m.kind !== wantKind)) throw new BadRequestException(`A ${input.kind} post needs ${wantKind} files only`);
    if (input.kind === 'video' && media.length !== 1) throw new BadRequestException('A video post has exactly one video');
    if (media.some((m) => m.status === 'failed')) throw new BadRequestException('One of the files failed to upload');
    const used = await this.db.one(`select 1 from post_media where media_id = any($1::uuid[])`, [input.mediaIds]);
    if (used) throw new BadRequestException('A file can only be used in one post');

    if (input.cta) await this.checkCta(userId, input.cta);
    if (input.soundId && !(await this.db.one(`select 1 from sounds where id = $1`, [input.soundId]))) throw new BadRequestException('That sound is not available');
    if (input.edit && input.kind !== 'video' && input.edit.trimStartMs !== undefined) throw new BadRequestException('Only videos can be trimmed');

    if (input.products?.length) await this.checkTagged(userId, input.products);
    const allReady = media.every((m) => m.status === 'ready');
    const id = await this.db.tx(async (tx) => {
      const [{ id }] = await tx.query(
        `insert into posts (author_id, kind, caption, tags, cta, allow_download, status, sound_id, sound_volume, original_volume, edit) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
        [userId, input.kind, input.caption.trim(), tags, input.cta ? JSON.stringify(input.cta) : null, input.allowDownload, allReady ? 'published' : 'pending',
          input.soundId ?? null, input.soundVolume ?? 70, input.originalVolume ?? 100, input.edit ? JSON.stringify(input.edit) : null],
      );
      for (const [i, mediaId] of input.mediaIds.entries()) {
        await tx.query(`insert into post_media (post_id, media_id, position) values ($1,$2,$3)`, [id, mediaId, i]);
      }
      for (const [i, t] of (input.products ?? []).entries()) {
        await tx.query(`insert into post_products (post_id, product_id, position, at_ms) values ($1,$2,$3,$4)`, [id, t.productId, i, t.atMs ?? null]);
        await tx.query(`update products set post_id = coalesce(post_id, $1) where id = $2`, [id, t.productId]);
      }
      if (input.soundId) await tx.query(`update sounds set use_count = use_count + 1 where id = $1`, [input.soundId]);
      if (input.cta?.productId) await tx.query(`update products set post_id = coalesce(post_id, $1) where id = $2`, [id, input.cta.productId]);
      return id as string;
    });

    if (input.allowDownload && this.video.isCloud) for (const m of media) if (m.stream_uid) void this.video.enableDownload(m.stream_uid);
    this.embed.indexPost(id);
    return (await this.hydrate([id], userId))[0];
  }

  private async checkTagged(userId: string, tagged: TaggedProduct[]) {
    const ids = [...new Set(tagged.map((t) => t.productId))];
    if (ids.length !== tagged.length) throw new BadRequestException('Each product can be tagged once');
    const found = await this.db.query(`select id from products where id = any($1::uuid[]) and merchant_id = $2 and status = 'active'`, [ids, userId]);
    if (found.length !== ids.length) throw new BadRequestException('You can only tag your own active products');
  }

  /** Replace the products shown in one of your posts. */
  async setProducts(userId: string, postId: string, tagged: TaggedProduct[]) {
    const owner = await this.db.one(`select 1 from posts where id = $1 and author_id = $2 and status <> 'removed'`, [postId, userId]);
    if (!owner) throw new NotFoundException('Post not found');
    await this.checkTagged(userId, tagged);
    await this.db.tx(async (tx) => {
      await tx.query(`delete from post_products where post_id = $1`, [postId]);
      for (const [i, t] of tagged.entries()) await tx.query(`insert into post_products (post_id, product_id, position, at_ms) values ($1,$2,$3,$4)`, [postId, t.productId, i, t.atMs ?? null]);
    });
    return (await this.hydrate([postId], userId))[0];
  }

  private async checkCta(userId: string, cta: Cta) {
    const kinds = CTA_PRODUCT_KINDS[cta.kind];
    if (!kinds) return; // "expert" has no product
    if (!cta.productId) throw new BadRequestException(`The "${cta.kind}" action needs a product`);
    const p = await this.db.one(`select kind from products where id = $1 and merchant_id = $2 and status <> 'archived'`, [cta.productId, userId]);
    if (!p) throw new BadRequestException('That product is not yours');
    if (!kinds.includes(p.kind)) throw new BadRequestException(`"${cta.kind}" does not fit a ${p.kind} product`);
  }

  async get(id: string, viewerId?: string) {
    const [post] = await this.hydrate([id], viewerId);
    if (!post) throw new NotFoundException('Post not found');
    if (post.status !== 'published' && post.author.id !== viewerId) throw new NotFoundException('Post not found');
    return post;
  }

  async remove(userId: string, id: string) {
    const row = await this.db.one(`update posts set status = 'removed' where id = $1 and author_id = $2 returning id`, [id, userId]);
    if (!row) throw new NotFoundException('Post not found');
  }

  async byUser(username: string, viewerId: string | undefined, cursor?: string, rawLimit?: unknown) {
    const limit = clampLimit(rawLimit);
    const c = decodeCursor(cursor);
    const rows = await this.db.query(
      `select p.id, p.created_at from posts p join users u on u.id = p.author_id
        where lower(u.username) = lower($1) and u.deleted_at is null
          and (p.status = 'published' or (p.author_id = $2::uuid and p.status = 'pending'))
          ${c ? 'and (p.created_at, p.id) < ($3::timestamptz, $4::uuid)' : ''}
        order by p.created_at desc, p.id desc limit ${limit + 1}`,
      c ? [username, viewerId ?? null, c.t, c.id] : [username, viewerId ?? null],
    );
    const page = rows.slice(0, limit);
    return {
      items: await this.hydrate(page.map((r) => r.id), viewerId),
      nextCursor: rows.length > limit ? encodeCursor(page[page.length - 1].created_at, page[page.length - 1].id) : null,
    };
  }

  async downloadLink(userId: string, id: string) {
    const post = await this.db.one(`select allow_download, author_id, status from posts where id = $1`, [id]);
    if (!post || post.status !== 'published') throw new NotFoundException('Post not found');
    if (!post.allow_download && post.author_id !== userId) throw new ForbiddenException('The creator has turned off downloads');
    const m = await this.db.one(
      `select m.* from post_media pm join media_assets m on m.id = pm.media_id where pm.post_id = $1 order by pm.position limit 1`, [id]);
    if (!m) throw new NotFoundException();
    if (m.stream_uid) return { url: this.video.downloadUrl(m.stream_uid) };
    return { url: m.url };
  }
}
