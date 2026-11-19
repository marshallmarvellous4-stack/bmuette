import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Db } from '../db/db.service';
import { MarketService } from '../market/market.service';
import { PostsService } from '../posts/posts.service';
import { EmbeddingService, toVector } from './embedding.service';

// Reciprocal rank fusion: merges several ranked lists (text match, meaning match, image match)
// without needing their scores to be comparable.
export function fuse(lists: string[][], k = 60): string[] {
  const score = new Map<string, number>();
  for (const list of lists) list.forEach((id, i) => score.set(id, (score.get(id) ?? 0) + 1 / (k + i + 1)));
  return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

@Injectable()
export class SearchService {
  constructor(private db: Db, private posts: PostsService, private market: MarketService, private embed: EmbeddingService) {}

  async search(userId: string | undefined, q: string, type: 'all' | 'posts' | 'products' | 'users', limit: number) {
    // "#sunday" searches the tag.
    const query = q.trim().replace(/^#+/, '');
    if (query.length < 2) throw new BadRequestException('Type at least 2 characters');
    void this.db.query(`insert into searches (user_id, query) values ($1,$2)`, [userId ?? null, query.slice(0, 200)]).catch(() => undefined);

    const vec = this.embed.enabled && type !== 'users' ? await this.embed.embedText(query) : null;
    const out: Record<string, unknown> = { query, semantic: !!vec };

    if (type === 'all' || type === 'posts') {
      const text = await this.db.query(
        `select id from posts where status = 'published' and (search @@ websearch_to_tsquery('simple', $1) or tags @> array[lower($1)])
          order by ts_rank(search, websearch_to_tsquery('simple', $1)) desc, created_at desc limit $2`, [query, limit * 2]);
      const lists = [text.map((r) => r.id as string)];
      if (vec) lists.push((await this.db.query(`select id from posts where status = 'published' and embedding is not null order by embedding <=> $1::vector limit $2`, [toVector(vec), limit * 2])).map((r) => r.id));
      out.posts = await this.posts.hydrate(fuse(lists).slice(0, limit), userId);
    }

    if (type === 'all' || type === 'products') {
      const text = await this.db.query(
        `select id from products where status = 'active'
            and (search @@ websearch_to_tsquery('simple', $1) or similarity(lower(title), lower($1)) > 0.25)
          order by ts_rank(search, websearch_to_tsquery('simple', $1)) + similarity(lower(title), lower($1)) desc limit $2`, [query, limit * 2]);
      const lists = [text.map((r) => r.id as string)];
      if (vec) lists.push((await this.db.query(`select id from products where status = 'active' and embedding is not null order by embedding <=> $1::vector limit $2`, [toVector(vec), limit * 2])).map((r) => r.id));
      out.products = await this.market.hydrate(fuse(lists).slice(0, limit), userId);
    }

    if (type === 'all' || type === 'users') {
      const rows = await this.db.query(
        `select id, username, display_name, avatar_url, is_merchant, follower_count from users
          where deleted_at is null and (lower(username) like lower($1) || '%' or lower(display_name) like '%' || lower($1) || '%' or similarity(lower(username), lower($1)) > 0.3)
          order by follower_count desc limit $2`, [query, Math.min(limit, 10)]);
      out.users = rows.map((u) => ({ id: u.id, username: u.username, displayName: u.display_name, avatarUrl: u.avatar_url, isMerchant: u.is_merchant, followerCount: u.follower_count }));
    }
    return out;
  }

  async suggest(q: string) {
    const p = q.trim().toLowerCase();
    if (p.length < 1) return { items: [] };
    const rows = await this.db.query(
      `(select 'tag' as type, t as text from (select distinct unnest(tags) as t from posts where status = 'published') x where t like $1 || '%' limit 5)
       union all (select 'product', title from products where status = 'active' and lower(title) like $1 || '%' limit 5)
       union all (select 'user', username from users where deleted_at is null and lower(username) like $1 || '%' limit 5)`, [p]);
    return { items: rows };
  }

  /** Search by picture: embed the uploaded image, then find the nearest products and posts. */
  async visual(userId: string, mediaId: string, limit: number) {
    if (!this.embed.enabled) throw new ServiceUnavailableException('Visual search is not switched on yet (the AI service is not connected)');
    const m = await this.db.one(`select url from media_assets where id = $1 and owner_id = $2 and kind = 'image' and status = 'ready'`, [mediaId, userId]);
    if (!m) throw new BadRequestException('Upload the image first, then search with it');
    const vec = await this.embed.embedImage(m.url);
    if (!vec) throw new ServiceUnavailableException('Visual search is temporarily unavailable');
    const v = toVector(vec);
    const products = await this.db.query(`select id from products where status = 'active' and embedding is not null order by embedding <=> $1::vector limit $2`, [v, limit]);
    const posts = await this.db.query(`select id from posts where status = 'published' and embedding is not null order by embedding <=> $1::vector limit $2`, [v, limit]);
    return { products: await this.market.hydrate(products.map((r) => r.id), userId), posts: await this.posts.hydrate(posts.map((r) => r.id), userId) };
  }
}
