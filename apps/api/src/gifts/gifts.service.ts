import { BadRequestException, ConflictException, ForbiddenException, HttpException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ENV, Env } from '../config/env';
import { requireTrading } from '../common/gates';
import { Db } from '../db/db.service';
import { Notifications } from '../notifications/notifications.service';
import { InteractionsService } from '../posts/interactions.service';

@Injectable()
export class GiftsService {
  constructor(private db: Db, private notes: Notifications, private interactions: InteractionsService, @Inject(ENV) private env: Env) {}

  async catalog() {
    const rows = await this.db.query(`select slug, name, coins, tier from gifts where active order by sort`);
    return { items: rows.map((g) => ({ slug: g.slug, name: g.name, coins: g.coins, tier: g.tier })) };
  }

  /** Send a gift on a post. It lands in the comments as a gift comment. */
  async send(userId: string, postId: string, input: { gift: string; qty: number; message?: string }) {
    await requireTrading(this.db, userId, 'buy');
    const post = await this.db.one<{ author_id: string }>(
      `select p.author_id from posts p join users u on u.id = p.author_id
        where p.id = $1 and p.status = 'published' and u.deleted_at is null and u.banned_at is null`, [postId]);
    if (!post) throw new NotFoundException('Post not found');
    if (post.author_id === userId) throw new BadRequestException('You cannot gift your own post');
    const blocked = await this.db.one(`select 1 from blocks where (blocker_id = $1 and blocked_id = $2) or (blocker_id = $2 and blocked_id = $1) limit 1`, [userId, post.author_id]);
    if (blocked) throw new NotFoundException('Post not found');
    const g = await this.db.one<any>(`select slug, name, coins, tier from gifts where slug = $1 and active`, [input.gift]);
    if (!g) throw new BadRequestException('Unknown gift');
    const recent = await this.db.one<{ n: number }>(`select count(*)::int as n from gift_sends where sender_id = $1 and created_at > now() - interval '1 minute'`, [userId]);
    if ((recent?.n ?? 0) >= 40) throw new HttpException('Slow down a little', 429);

    const cost = g.coins * input.qty;
    const earned = cost * this.env.CREATOR_COIN_MINOR;
    const message = input.message?.trim() || null;
    const commentId = await this.db.tx(async (tx) => {
      // One statement checks and takes the coins, so two taps cannot spend the same coins twice.
      const w = await tx.query(`update wallets set coins = coins - $2 where user_id = $1 and coins >= $2 returning coins`, [userId, cost]);
      if (!w.length) throw new HttpException({ message: 'Not enough coins', code: 'INSUFFICIENT_COINS' }, 402);
      const [send] = await tx.query(
        `insert into gift_sends (sender_id, recipient_id, post_id, gift_slug, qty, coins, earned_minor, message) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
        [userId, post.author_id, postId, g.slug, input.qty, cost, earned, message]);
      await tx.query(`insert into coin_ledger (user_id, delta, kind, ref) values ($1,$2,'gift',$3)`, [userId, -cost, send.id]);
      if (earned > 0) {
        await tx.query(
          `insert into merchant_ledger (merchant_id, currency, kind, amount_minor, available_at, note) values ($1,'NGN','gift',$2, now() + make_interval(days => $3), $4)`,
          [post.author_id, earned, this.env.GIFT_HOLD_DAYS, `${input.qty} × ${g.name}`]);
      }
      const [c] = await tx.query(
        `insert into comments (post_id, user_id, body, kind, gift_send_id) values ($1,$2,$3,'gift',$4) returning id`,
        [postId, userId, message ?? `Sent ${input.qty > 1 ? `${input.qty} × ` : 'a '}${g.name}`, send.id]);
      await tx.query(`update posts set comment_count = comment_count + 1, gift_coins = gift_coins + $2 where id = $1`, [postId, cost]);
      return c.id as string;
    });

    const who = (await this.db.one<{ display_name: string }>(`select display_name from users where id = $1`, [userId]))?.display_name ?? 'Someone';
    await this.notes.notify({
      userId: post.author_id, actorId: userId, type: 'gift', postId, commentId, title: `${who} sent you ${input.qty > 1 ? `${input.qty} × ` : 'a '}${g.name}`, body: message,
    });
    const comment = (await this.interactions.listComments(postId, undefined, 1, commentId)).items[0];
    const w = await this.db.one<{ coins: number }>(`select coins from wallets where user_id = $1`, [userId]);
    return { comment, coins: w?.coins ?? 0 };
  }

  /** Who has gifted this post the most. */
  async forPost(postId: string) {
    const rows = await this.db.query(
      `select u.id, u.username, u.display_name, u.avatar_url, sum(s.coins)::int as coins
         from gift_sends s join users u on u.id = s.sender_id where s.post_id = $1 group by u.id order by coins desc limit 5`, [postId]);
    const t = await this.db.one<{ n: number }>(`select coalesce(sum(coins),0)::int as n from gift_sends where post_id = $1`, [postId]);
    return { totalCoins: t?.n ?? 0, top: rows.map((r) => ({ id: r.id, username: r.username, displayName: r.display_name, avatarUrl: r.avatar_url, coins: r.coins })) };
  }

  /** What the creator has received. The money itself is in the shared balance and payout endpoints. */
  async earnings(userId: string) {
    const r = await this.db.one<any>(
      `select coalesce(sum(coins),0)::int as coins, coalesce(sum(earned_minor),0)::int8 as earned,
              coalesce(sum(earned_minor) filter (where created_at > date_trunc('month', now())),0)::int8 as month, count(*)::int as sends
         from gift_sends where recipient_id = $1`, [userId]);
    const recent = await this.db.query(
      `select s.id, s.qty, s.coins, s.created_at, g.name, g.slug, u.username, u.display_name, u.avatar_url
         from gift_sends s join gifts g on g.slug = s.gift_slug join users u on u.id = s.sender_id
        where s.recipient_id = $1 order by s.created_at desc limit 20`, [userId]);
    return {
      coinsReceived: r.coins, earnedMinor: Number(r.earned), earnedThisMonthMinor: Number(r.month), gifts: r.sends, currency: 'NGN', holdDays: this.env.GIFT_HOLD_DAYS,
      recent: recent.map((x) => ({ id: x.id, gift: x.slug, name: x.name, qty: x.qty, coins: x.coins, createdAt: x.created_at, from: { username: x.username, displayName: x.display_name, avatarUrl: x.avatar_url } })),
    };
  }
}
