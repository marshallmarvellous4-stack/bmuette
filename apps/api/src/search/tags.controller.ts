import { Controller, Get, Injectable, Param, Query, UseGuards } from '@nestjs/common';
import { Cache } from '../cache/cache.service';
import { MaybeUserId, OptionalAuthGuard } from '../common/auth.guard';
import { clampLimit, decodeCursor, encodeCursor } from '../common/cursor';
import { Db } from '../db/db.service';
import { PostsService } from '../posts/posts.service';

const clean = (t: string) => t.toLowerCase().replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, '').slice(0, 40);

@Injectable()
export class TagsService {
  constructor(private db: Db, private posts: PostsService, private cache: Cache) {}

  /** Tags people are posting about right now. Looks at the last 14 days, and falls back to all time while the app is young. */
  trending(limit: number) {
    return this.cache.remember(`tags:trending:${limit}`, 60, async () => {
      const q = (window: string) => this.db.query(
        `select t as tag, count(*)::int as posts, coalesce(sum(p.like_count + 2 * p.comment_count + 3 * p.save_count), 0)::int as engagement
           from posts p, unnest(p.tags) t
          where p.status = 'published' ${window}
          group by t order by count(*) * 3 + coalesce(sum(p.like_count + 2 * p.comment_count + 3 * p.save_count), 0) desc, t limit $1`, [limit]);
      let rows = await q(`and p.created_at > now() - interval '14 days'`);
      if (rows.length < Math.min(limit, 5)) rows = await q('');
      return { items: rows.map((r) => ({ tag: r.tag, posts: r.posts, engagement: r.engagement })) };
    });
  }

  async posts_for(tag: string, viewerId: string | undefined, cursor?: string, limitRaw?: unknown) {
    const t = clean(tag);
    const limit = clampLimit(limitRaw, 18, 40);
    const cur = decodeCursor(cursor);
    const rows = await this.db.query(
      `select id, created_at from posts where status = 'published' and tags @> array[$1]::text[]
          and ($2::timestamptz is null or (created_at, id) < ($2::timestamptz, $3::uuid))
        order by created_at desc, id desc limit $4`, [t, cur?.t ?? null, cur?.id ?? null, limit + 1]);
    const page = rows.slice(0, limit);
    const total = await this.db.one<{ n: number }>(`select count(*)::int as n from posts where status = 'published' and tags @> array[$1]::text[]`, [t]);
    const last = page[page.length - 1];
    return {
      tag: t, postCount: total?.n ?? 0,
      items: await this.posts.hydrate(page.map((r) => r.id), viewerId),
      nextCursor: rows.length > limit && last ? encodeCursor(last.created_at, last.id) : null,
    };
  }

  /** What people have been searching for lately (most searched first). */
  searches(limit: number) {
    return this.cache.remember(`search:trending:${limit}`, 120, async () => {
      const rows = await this.db.query(
        `select lower(query) as q, count(*)::int as n from searches where created_at > now() - interval '7 days' and length(query) between 2 and 40
          group by lower(query) order by n desc, q limit $1`, [limit]);
      return { items: rows.map((r) => r.q as string) };
    });
  }
}

@Controller()
export class TagsController {
  constructor(private tags: TagsService) {}

  @Get('tags/trending')
  trending(@Query('limit') limit?: string) { return this.tags.trending(clampLimit(limit, 12, 30)); }

  @Get('tags/:tag/posts') @UseGuards(OptionalAuthGuard)
  forTag(@Param('tag') tag: string, @MaybeUserId() uid?: string, @Query('cursor') cursor?: string, @Query('limit') limit?: string) { return this.tags.posts_for(tag, uid, cursor, limit); }

  @Get('trending/searches')
  searches(@Query('limit') limit?: string) { return this.tags.searches(clampLimit(limit, 8, 20)); }
}
