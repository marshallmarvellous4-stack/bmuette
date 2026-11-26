import { Notifications } from '../notifications/notifications.service';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuthService, toPublicUser } from '../auth/auth.service';
import { decodeCursor, encodeCursor, clampLimit } from '../common/cursor';
import { Db } from '../db/db.service';

@Injectable()
export class UsersService {
  constructor(private db: Db, private auth: AuthService, private notes: Notifications) {}

  async me(userId: string) {
    const row = await this.db.one(`select * from users where id = $1 and deleted_at is null`, [userId]);
    if (!row) throw new NotFoundException();
    const merchant = await this.db.one(`select shop_name, slug, verified from merchants where user_id = $1`, [userId]);
    return { ...toPublicUser(row), email: row.email, isAdmin: row.is_admin, emailVerified: !!row.email_verified_at, isAdult: row.is_adult, merchant: merchant ? { shopName: merchant.shop_name, slug: merchant.slug, verified: merchant.verified } : null };
  }

  async updateMe(userId: string, input: { displayName?: string; bio?: string; country?: string; avatarMediaId?: string | null }) {
    let avatarUrl: string | null | undefined;
    if (input.avatarMediaId !== undefined) {
      if (input.avatarMediaId === null) avatarUrl = null;
      else {
        const m = await this.db.one(`select url from media_assets where id = $1 and owner_id = $2 and kind = 'image' and status = 'ready'`, [input.avatarMediaId, userId]);
        if (!m) throw new BadRequestException('Avatar image is not ready');
        avatarUrl = m.url;
      }
    }
    await this.db.query(
      `update users set display_name = coalesce($2, display_name), bio = coalesce($3, bio), country = coalesce($4, country),
              avatar_url = case when $5::boolean then $6 else avatar_url end
        where id = $1`,
      [userId, input.displayName ?? null, input.bio ?? null, input.country?.toUpperCase() ?? null, avatarUrl !== undefined, avatarUrl ?? null],
    );
    return this.me(userId);
  }

  // Account deletion: the row stays so orders and receipts keep working, but nothing personal is left.
  async deleteMe(userId: string, password: string) {
    await this.auth.checkPassword(userId, password);
    // A seller with paid orders that have not arrived yet cannot vanish: those buyers are owed their goods or a refund.
    const open = await this.db.one(
      `select count(*)::int as n from order_items i join orders o on o.id = i.order_id
        where i.merchant_id = $1 and o.status = 'paid' and i.fulfilment in ('pending','shipped')`, [userId]);
    const owed = await this.db.one<{ n: string }>(`select coalesce(sum(amount_minor),0) as n from merchant_ledger where merchant_id = $1 group by currency having sum(amount_minor) > 0 limit 1`, [userId]);
    if (owed) throw new ConflictException('You still have earnings to withdraw. Take your payout first, then delete your account.');
    if (open && open.n > 0) throw new ConflictException(`You have ${open.n} open order${open.n === 1 ? '' : 's'} to fulfil or refund first`);
    const tag = randomUUID().slice(0, 8);
    await this.db.tx(async (tx) => {
      await tx.query(
        `update users set deleted_at = now(), email = $2, username = $3, display_name = 'Deleted user', bio = '', avatar_url = null, password_hash = '!'
          where id = $1`,
        [userId, `deleted+${tag}@bmuette.invalid`, `deleted_${tag}`],
      );
      await tx.query(`update posts set status = 'removed' where author_id = $1`, [userId]);
      await tx.query(`update products set status = 'archived' where merchant_id = $1`, [userId]);
      await tx.query(`delete from follows where follower_id = $1 or followee_id = $1`, [userId]);
      await tx.query(`delete from comments where user_id = $1`, [userId]);
      await tx.query(`delete from saves where user_id = $1`, [userId]);
      await tx.query(`delete from collections where owner_id = $1`, [userId]);
      await tx.query(`delete from auth_codes where user_id = $1`, [userId]);
      await tx.query(`delete from blocks where blocker_id = $1`, [userId]);
      await tx.query(`update conversation_members set muted = true where user_id = $1`, [userId]);
    });
    await this.auth.revokeAll(userId);
  }

  async blockedList(userId: string) {
    const rows = await this.db.query(
      `select u.* from blocks b join users u on u.id = b.blocked_id where b.blocker_id = $1 and u.deleted_at is null order by b.created_at desc limit 200`, [userId]);
    return { items: rows.map(toPublicUser) };
  }

  async profile(username: string, viewerId?: string) {
    const row = await this.db.one(`select * from users where lower(username) = lower($1) and deleted_at is null`, [username]);
    if (!row) throw new NotFoundException('User not found');
    const rel = viewerId
      ? await this.db.one(
          `select exists(select 1 from follows where follower_id = $1 and followee_id = $2) as following,
                  exists(select 1 from follows where follower_id = $2 and followee_id = $1) as follows_you,
                  exists(select 1 from blocks where blocker_id = $1 and blocked_id = $2) as blocked`,
          [viewerId, row.id])
      : null;
    const postCount = await this.db.one(`select count(*)::int as n from posts where author_id = $1 and status = 'published'`, [row.id]);
    const merchant = await this.db.one(`select shop_name, slug, verified from merchants where user_id = $1`, [row.id]);
    return {
      ...toPublicUser(row),
      postCount: postCount!.n,
      merchant: merchant ? { shopName: merchant.shop_name, slug: merchant.slug, verified: merchant.verified } : null,
      viewer: rel ? { following: rel.following, followsYou: rel.follows_you, blocked: rel.blocked } : null,
    };
  }

  private async idOf(username: string): Promise<string> {
    const row = await this.db.one(`select id from users where lower(username) = lower($1) and deleted_at is null`, [username]);
    if (!row) throw new NotFoundException('User not found');
    return row.id;
  }

  async follow(viewerId: string, username: string) {
    const target = await this.idOf(username);
    if (target === viewerId) throw new BadRequestException('You cannot follow yourself');
    const blocked = await this.db.one(`select 1 from blocks where (blocker_id = $1 and blocked_id = $2) or (blocker_id = $2 and blocked_id = $1)`, [viewerId, target]);
    if (blocked) throw new ConflictException('You cannot follow this account');
    const fresh = await this.db.tx(async (tx) => {
      const ins = await tx.query(`insert into follows (follower_id, followee_id) values ($1,$2) on conflict do nothing returning 1`, [viewerId, target]);
      if (ins.length) {
        await tx.query(`update users set follower_count = follower_count + 1 where id = $1`, [target]);
        await tx.query(`update users set following_count = following_count + 1 where id = $1`, [viewerId]);
      }
      return ins.length > 0;
    });
    if (fresh) {
      const me = await this.db.one<{ username: string }>(`select username from users where id = $1`, [viewerId]);
      await this.notes.notify({ userId: target, actorId: viewerId, type: 'follow', title: `${me?.username ?? 'Someone'} started following you` });
    }
    return { following: true };
  }

  async unfollow(viewerId: string, username: string) {
    const target = await this.idOf(username);
    await this.db.tx(async (tx) => {
      const del = await tx.query(`delete from follows where follower_id = $1 and followee_id = $2 returning 1`, [viewerId, target]);
      if (del.length) {
        await tx.query(`update users set follower_count = greatest(follower_count - 1, 0) where id = $1`, [target]);
        await tx.query(`update users set following_count = greatest(following_count - 1, 0) where id = $1`, [viewerId]);
      }
    });
    return { following: false };
  }

  async block(viewerId: string, username: string) {
    const target = await this.idOf(username);
    if (target === viewerId) throw new BadRequestException('You cannot block yourself');
    await this.db.query(`insert into blocks (blocker_id, blocked_id) values ($1,$2) on conflict do nothing`, [viewerId, target]);
    await this.unfollow(viewerId, username);
    // The blocked person stops following you too.
    await this.db.tx(async (tx) => {
      const del = await tx.query(`delete from follows where follower_id = $1 and followee_id = $2 returning 1`, [target, viewerId]);
      if (del.length) {
        await tx.query(`update users set follower_count = greatest(follower_count - 1, 0) where id = $1`, [viewerId]);
        await tx.query(`update users set following_count = greatest(following_count - 1, 0) where id = $1`, [target]);
      }
    });
    return { blocked: true };
  }

  async unblock(viewerId: string, username: string) {
    const target = await this.idOf(username);
    await this.db.query(`delete from blocks where blocker_id = $1 and blocked_id = $2`, [viewerId, target]);
    return { blocked: false };
  }

  async list(kind: 'followers' | 'following', username: string, cursor?: string, rawLimit?: unknown) {
    const id = await this.idOf(username);
    const limit = clampLimit(rawLimit);
    const c = decodeCursor(cursor);
    const [me, other] = kind === 'followers' ? ['followee_id', 'follower_id'] : ['follower_id', 'followee_id'];
    const rows = await this.db.query(
      `select u.*, f.created_at as at from follows f join users u on u.id = f.${other}
        where f.${me} = $1 and u.deleted_at is null
          ${c ? 'and (f.created_at, u.id) < ($2::timestamptz, $3::uuid)' : ''}
        order by f.created_at desc, u.id desc limit ${limit + 1}`,
      c ? [id, c.t, c.id] : [id],
    );
    const page = rows.slice(0, limit);
    return { items: page.map(toPublicUser), nextCursor: rows.length > limit ? encodeCursor(page[page.length - 1].at, page[page.length - 1].id) : null };
  }
}
