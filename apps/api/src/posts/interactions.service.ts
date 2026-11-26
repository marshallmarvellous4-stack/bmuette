import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { clampLimit, decodeCursor, encodeCursor } from '../common/cursor';
import { Notifications } from '../notifications/notifications.service';
import { Db } from '../db/db.service';
import { InterestService } from './interests.service';

@Injectable()
export class InteractionsService {
  constructor(private db: Db, private interests: InterestService, private notes: Notifications) {}

  private async nameOf(id: string) {
    const u = await this.db.one<{ username: string }>(`select username from users where id = $1`, [id]);
    return u?.username ?? 'Someone';
  }

  private async livePost(id: string) {
    const p = await this.db.one(`select id, tags, author_id from posts where id = $1 and status = 'published'`, [id]);
    if (!p) throw new NotFoundException('Post not found');
    return p as { id: string; tags: string[]; author_id: string };
  }

  async like(userId: string, postId: string) {
    const p = await this.livePost(postId);
    const likes = await this.db.tx(async (tx) => {
      const ins = await tx.query(`insert into likes (user_id, post_id) values ($1,$2) on conflict do nothing returning 1`, [userId, postId]);
      const [row] = ins.length
        ? await tx.query(`update posts set like_count = like_count + 1 where id = $1 returning like_count`, [postId])
        : await tx.query(`select like_count from posts where id = $1`, [postId]);
      return { n: row.like_count as number, fresh: ins.length > 0 };
    });
    if (likes.fresh) {
      await this.interests.bump(userId, p.tags, 1);
      await this.notes.notify({ userId: p.author_id, actorId: userId, type: 'like', postId: postId, title: `${await this.nameOf(userId)} liked your post` });
    }
    return { liked: true, likes: likes.n };
  }

  async unlike(userId: string, postId: string) {
    return this.db.tx(async (tx) => {
      const del = await tx.query(`delete from likes where user_id = $1 and post_id = $2 returning 1`, [userId, postId]);
      const [row] = del.length
        ? await tx.query(`update posts set like_count = greatest(like_count - 1, 0) where id = $1 returning like_count`, [postId])
        : await tx.query(`select like_count from posts where id = $1`, [postId]);
      if (!row) throw new NotFoundException('Post not found');
      return { liked: false, likes: row.like_count as number };
    });
  }

  async save(userId: string, postId: string, collectionId?: string) {
    const p = await this.livePost(postId);
    if (collectionId) {
      const c = await this.db.one(`select 1 from collections where id = $1 and owner_id = $2`, [collectionId, userId]);
      if (!c) throw new BadRequestException('Board not found');
    }
    const fresh = await this.db.tx(async (tx) => {
      const rows = await tx.query(
        `insert into saves (user_id, post_id, collection_id) values ($1,$2,$3)
         on conflict (user_id, post_id) where post_id is not null do update set collection_id = excluded.collection_id
         returning (xmax = 0) as inserted`,
        [userId, postId, collectionId ?? null],
      );
      if (rows[0].inserted) await tx.query(`update posts set save_count = save_count + 1 where id = $1`, [postId]);
      return rows[0].inserted as boolean;
    });
    if (fresh) await this.interests.bump(userId, p.tags, 2);
    return { saved: true };
  }

  async unsave(userId: string, postId: string) {
    await this.db.tx(async (tx) => {
      const del = await tx.query(`delete from saves where user_id = $1 and post_id = $2 returning 1`, [userId, postId]);
      if (del.length) await tx.query(`update posts set save_count = greatest(save_count - 1, 0) where id = $1`, [postId]);
    });
    return { saved: false };
  }

  async comment(userId: string, postId: string, body: string, parentId?: string) {
    const post = await this.livePost(postId);
    let parentAuthor: string | null = null;
    if (parentId) {
      const parent = await this.db.one<{ user_id: string }>(`select user_id from comments where id = $1 and post_id = $2 and parent_id is null and deleted_at is null`, [parentId, postId]);
      if (!parent) throw new BadRequestException('You can only reply to a top-level comment on this post');
      parentAuthor = parent.user_id;
    }
    const row = await this.db.tx(async (tx) => {
      const [c] = await tx.query(`insert into comments (post_id, user_id, parent_id, body) values ($1,$2,$3,$4) returning *`, [postId, userId, parentId ?? null, body.trim()]);
      await tx.query(`update posts set comment_count = comment_count + 1 where id = $1`, [postId]);
      return c;
    });
    const who = await this.nameOf(userId);
    const preview = body.trim().slice(0, 140);
    if (parentAuthor && parentAuthor !== post.author_id) await this.notes.notify({ userId: parentAuthor, actorId: userId, type: 'reply', postId, commentId: row.id, title: `${who} replied to your comment`, body: preview });
    await this.notes.notify({ userId: post.author_id, actorId: userId, type: parentAuthor === post.author_id ? 'reply' : 'comment', postId, commentId: row.id, title: parentAuthor === post.author_id ? `${who} replied to your comment` : `${who} commented on your post`, body: preview });
    return (await this.listComments(postId, undefined, 1, row.id)).items[0];
  }

  async listComments(postId: string, cursor?: string, rawLimit?: unknown, onlyId?: string) {
    const limit = clampLimit(rawLimit, 20, 50);
    const c = decodeCursor(cursor);
    const rows = await this.db.query(
      `select c.id, c.parent_id, c.body, c.created_at, c.kind, u.id as user_id, u.username, u.display_name, u.avatar_url,
              g.slug as g_slug, g.name as g_name, g.tier as g_tier, s.qty as g_qty, s.coins as g_coins, s.message as g_message
         from comments c join users u on u.id = c.user_id
         left join gift_sends s on s.id = c.gift_send_id left join gifts g on g.slug = s.gift_slug
        where c.post_id = $1 and c.deleted_at is null
          ${onlyId ? 'and c.id = $2' : c ? 'and (c.created_at, c.id) > ($2::timestamptz, $3::uuid)' : ''}
        order by c.created_at asc, c.id asc limit ${limit + 1}`,
      onlyId ? [postId, onlyId] : c ? [postId, c.t, c.id] : [postId],
    );
    const page = rows.slice(0, limit);
    return {
      items: page.map((r) => ({
        id: r.id, parentId: r.parent_id, body: r.body, createdAt: r.created_at, kind: r.kind,
        gift: r.kind === 'gift' && r.g_slug ? { slug: r.g_slug, name: r.g_name, tier: r.g_tier, qty: r.g_qty, coins: r.g_coins, message: r.g_message } : null,
        author: { id: r.user_id, username: r.username, displayName: r.display_name, avatarUrl: r.avatar_url },
      })),
      nextCursor: rows.length > limit ? encodeCursor(page[page.length - 1].created_at, page[page.length - 1].id) : null,
    };
  }

  async deleteComment(userId: string, commentId: string) {
    const c = await this.db.one(
      `select c.id, c.post_id, c.user_id, c.kind, p.author_id from comments c join posts p on p.id = c.post_id where c.id = $1 and c.deleted_at is null`, [commentId]);
    if (!c) throw new NotFoundException('Comment not found');
    if (c.kind === 'gift') throw new ForbiddenException('Gifts cannot be deleted');
    if (c.user_id !== userId && c.author_id !== userId) throw new ForbiddenException();
    await this.db.tx(async (tx) => {
      // Replies go with their parent, so count everything that disappears.
      const gone = await tx.query(
        `update comments set deleted_at = now() where (id = $1 or parent_id = $1) and deleted_at is null returning 1`, [commentId]);
      await tx.query(`update posts set comment_count = greatest(comment_count - $2, 0) where id = $1`, [c.post_id, gone.length]);
    });
  }

  /** "Seeing" is recorded by the feed. This records actual watching. */
  async view(userId: string | undefined, postId: string, input: { watchMs: number; completion: number; replays: number }) {
    const p = await this.livePost(postId);
    await this.db.tx(async (tx) => {
      await tx.query(`insert into views (user_id, post_id, watch_ms, completion, replays) values ($1,$2,$3,$4,$5)`, [userId ?? null, postId, input.watchMs, input.completion, input.replays]);
      await tx.query(`update posts set view_count = view_count + 1 where id = $1`, [postId]);
    });
    if (input.completion >= 0.8 || input.replays > 0) await this.interests.bump(userId, p.tags, 1.5);
    else if (input.completion < 0.15 && input.watchMs < 2000) await this.interests.bump(userId, p.tags, -0.5);
    return { ok: true };
  }

  async share(postId: string) {
    const row = await this.db.one(`update posts set share_count = share_count + 1 where id = $1 and status = 'published' returning share_count`, [postId]);
    if (!row) throw new NotFoundException('Post not found');
    return { shares: row.share_count as number };
  }

  async report(userId: string, input: { postId?: string; productId?: string; userId?: string; commentId?: string; reason: string; details?: string }) {
    if (input.userId === userId) throw new BadRequestException('You cannot report yourself');
    // Make sure the thing exists, so reports never dangle.
    const exists = input.postId ? await this.db.one(`select 1 from posts where id = $1`, [input.postId])
      : input.productId ? await this.db.one(`select 1 from products where id = $1`, [input.productId])
      : input.commentId ? await this.db.one(`select 1 from comments where id = $1 and deleted_at is null`, [input.commentId])
      : await this.db.one(`select 1 from users where id = $1 and deleted_at is null`, [input.userId]);
    if (!exists) throw new NotFoundException('That no longer exists');
    await this.db.tx(async (tx) => {
      const ins = await tx.query(
        `insert into reports (reporter_id, post_id, product_id, user_id, comment_id, reason, details) values ($1,$2,$3,$4,$5,$6,$7) on conflict do nothing returning id`,
        [userId, input.postId ?? null, input.productId ?? null, input.userId ?? null, input.commentId ?? null, input.reason, input.details ?? null]);
      if (input.postId && ins.length) {
        // Enough independent reports pull a post out of feeds until a person reviews it.
        await tx.query(
          `update posts set report_count = report_count + 1,
                  status = case when report_count + 1 >= 5 and status = 'published' then 'held' else status end
            where id = $1`, [input.postId]);
      }
    });
    return { ok: true };
  }
}
