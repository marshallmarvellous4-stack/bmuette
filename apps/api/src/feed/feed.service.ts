import { Injectable } from '@nestjs/common';
import { Cache } from '../cache/cache.service';
import { clampLimit, decodeCursor, encodeCursor } from '../common/cursor';
import { Db } from '../db/db.service';
import { InterestService } from '../posts/interests.service';
import { PostsService } from '../posts/posts.service';

type Candidate = {
  id: string; author_id: string; tags: string[]; age_hours: number;
  like_count: number; comment_count: number; save_count: number; share_count: number; view_count: number; report_count: number;
  followed: boolean;
};

// Starting weights from the system design: 0.30 interest, 0.25 engagement, 0.20 recency, 0.15 creator, 0.10 quality.
// They are a first guess. Once there is real behaviour data they should be tuned or replaced by a trained model.
export const WEIGHTS = { interest: 0.3, engagement: 0.25, recency: 0.2, creator: 0.15, quality: 0.1 };

export function scoreCandidate(c: Candidate, interests: Map<string, number>): number {
  const I = Math.min(1, c.tags.reduce((sum, t) => sum + (interests.get(t) ?? 0), 0) / 5);
  // Smoothed engagement rate: new posts with a couple of views do not jump to the top.
  const actions = c.like_count + 2 * c.comment_count + 3 * c.save_count + 2 * c.share_count;
  const E = Math.min(1, ((actions + 1) / (c.view_count + 20)) * 4);
  const R = Math.exp(-c.age_hours / 72);
  const F = c.followed ? 1 : 0;
  const Q = 1 - Math.min(1, c.report_count * 0.2);
  return WEIGHTS.interest * I + WEIGHTS.engagement * E + WEIGHTS.recency * R + WEIGHTS.creator * F + WEIGHTS.quality * Q;
}

// Stops the feed turning into one creator or one topic: penalise repeats among the posts already chosen.
export function diversify(scored: { c: Candidate; score: number }[], limit: number) {
  const pool = [...scored].sort((a, b) => b.score - a.score);
  const picked: typeof pool = [];
  while (picked.length < limit && pool.length) {
    const recent = picked.slice(-5);
    let best = 0, bestScore = -Infinity;
    for (let i = 0; i < Math.min(pool.length, 40); i++) {
      const { c, score } = pool[i];
      let s = score;
      if (recent.slice(-2).some((p) => p.c.author_id === c.author_id)) s -= 0.15;
      const topic = c.tags[0];
      if (topic && recent.filter((p) => p.c.tags[0] === topic).length >= 2) s -= 0.1;
      if (s > bestScore) { bestScore = s; best = i; }
    }
    picked.push(pool.splice(best, 1)[0]);
  }
  return picked;
}

@Injectable()
export class FeedService {
  constructor(private db: Db, private posts: PostsService, private interests: InterestService, private cache: Cache) {}

  async forYou(userId: string | undefined, rawLimit?: unknown) {
    const limit = clampLimit(rawLimit, 12, 30);
    // Signed-out visitors all see the same trending mix, so it is safe to share one cached copy.
    if (!userId) return this.cache.remember(`feed:anon:${limit}`, 30, () => this.build(undefined, limit));
    return this.build(userId, limit);
  }

  private async build(userId: string | undefined, limit: number) {
    const interests = userId ? await this.interests.top(userId) : new Map<string, number>();
    const topTags = [...interests.keys()];

    // Candidate retrieval: four sources, each capped, merged without duplicates.
    const rows = await this.db.query<Candidate>(
      `with base as materialized (
         select p.id, p.author_id, p.tags, p.created_at,
                p.like_count, p.comment_count, p.save_count, p.share_count, p.view_count, p.report_count,
                u.follower_count,
                exists(select 1 from follows f where f.follower_id = $1::uuid and f.followee_id = p.author_id) as followed
           from posts p join users u on u.id = p.author_id
          where p.status = 'published' and u.deleted_at is null
            and p.created_at > now() - interval '45 days'
            and p.author_id is distinct from $1::uuid
            and p.author_id not in (select blocked_id from blocks where blocker_id = $1::uuid
                                    union select blocker_id from blocks where blocked_id = $1::uuid)
            and not exists (select 1 from impressions i where i.user_id = $1::uuid and i.post_id = p.id)
       ), picked as (
         (select id from base where followed order by created_at desc limit 100)
         union (select id from base where tags && $2::text[] order by created_at desc limit 100)
         union (select id from base order by (like_count + 2 * comment_count + 3 * save_count + 2 * share_count) desc, created_at desc limit 100)
         union (select id from base where follower_count < 100 order by created_at desc limit 50)
       )
       select b.id, b.author_id, b.tags, extract(epoch from (now() - b.created_at)) / 3600 as age_hours,
              b.like_count, b.comment_count, b.save_count, b.share_count, b.view_count, b.report_count, b.followed
         from base b join picked using (id)`,
      [userId ?? null, topTags],
    );

    // A little noise keeps two people with the same tastes from seeing an identical order.
    const scored = rows.map((c) => ({ c: { ...c, age_hours: Number(c.age_hours) }, score: scoreCandidate({ ...c, age_hours: Number(c.age_hours) }, interests) + (Math.random() - 0.5) * 0.04 }));
    let ids = diversify(scored, limit).map((p) => p.c.id);

    // Ran out of unseen posts: bring back the ones seen longest ago rather than showing nothing.
    if (userId && ids.length < limit) {
      const again = await this.db.query(
        `select p.id from impressions i join posts p on p.id = i.post_id
          where i.user_id = $1 and p.status = 'published' and p.author_id <> $1 and not (p.id = any($2::uuid[]))
          order by i.created_at asc limit $3`,
        [userId, ids, limit - ids.length],
      );
      ids = ids.concat(again.map((r) => r.id));
    }

    if (userId && ids.length) {
      await this.db.query(
        `insert into impressions (user_id, post_id) select $1, unnest($2::uuid[]) on conflict (user_id, post_id) do update set created_at = now()`,
        [userId, ids],
      );
    }
    return { items: await this.posts.hydrate(ids, userId) };
  }

  /** Plain newest-first feed from people you follow. */
  async following(userId: string, cursor?: string, rawLimit?: unknown) {
    const limit = clampLimit(rawLimit);
    const c = decodeCursor(cursor);
    const rows = await this.db.query(
      `select p.id, p.created_at from posts p
         join follows f on f.followee_id = p.author_id and f.follower_id = $1
        where p.status = 'published' ${c ? 'and (p.created_at, p.id) < ($2::timestamptz, $3::uuid)' : ''}
        order by p.created_at desc, p.id desc limit ${limit + 1}`,
      c ? [userId, c.t, c.id] : [userId],
    );
    const page = rows.slice(0, limit);
    return {
      items: await this.posts.hydrate(page.map((r) => r.id), userId),
      nextCursor: rows.length > limit ? encodeCursor(page[page.length - 1].created_at, page[page.length - 1].id) : null,
    };
  }
}
