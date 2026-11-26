import { Inject, Injectable, Logger } from '@nestjs/common';
import { Db } from '../db/db.service';
import { Hub } from '../chat/hub';
import { ENV, Env } from '../config/env';
import { clampLimit, decodeCursor, encodeCursor } from '../common/cursor';

export type NotifType = 'like' | 'comment' | 'reply' | 'follow' | 'order_paid' | 'order_update' | 'sale' | 'review' | 'refund' | 'payout' | 'gift' | 'system';
type Category = 'likes' | 'comments' | 'follows' | 'messages' | 'orders';
const CATEGORY: Record<string, Category> = {
  like: 'likes', comment: 'comments', reply: 'comments', follow: 'follows', message: 'messages',
  order_paid: 'orders', order_update: 'orders', sale: 'orders', review: 'comments', refund: 'orders', payout: 'orders', gift: 'comments',
};

export type NotifInput = {
  userId: string; actorId?: string | null; type: NotifType | 'message';
  postId?: string; commentId?: string; conversationId?: string; orderId?: string;
  title: string; body?: string | null;
  /** Messages are pushed to the phone but live in the chat list, not the Activity list. */
  store?: boolean;
};

@Injectable()
export class Notifications {
  private log = new Logger('Notifications');
  constructor(private db: Db, private hub: Hub, @Inject(ENV) private env: Env) {}

  /** Record and deliver one notification. Never throws: a failed ping must not break a like or an order. */
  async notify(n: NotifInput): Promise<void> {
    try {
      if (n.actorId && n.actorId === n.userId) return;
      const cat = CATEGORY[n.type];
      const prefs = await this.db.one<any>(`select * from notification_prefs where user_id = $1`, [n.userId]);
      if (prefs && cat && prefs[cat] === false) return;
      if (n.actorId) {
        const blocked = await this.db.one(`select 1 from blocks where (blocker_id=$1 and blocked_id=$2) or (blocker_id=$2 and blocked_id=$1) limit 1`, [n.userId, n.actorId]);
        if (blocked) return;
      }
      if (n.store ?? n.type !== 'message') {
        const row = await this.db.one(
          `insert into notifications (user_id, actor_id, type, post_id, comment_id, conversation_id, order_id, title, body)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict do nothing returning id`,
          [n.userId, n.actorId ?? null, n.type, n.postId ?? null, n.commentId ?? null, n.conversationId ?? null, n.orderId ?? null, n.title, n.body ?? null]);
        if (!row) return; // a repeat like or follow
        const { unread } = await this.unreadCount(n.userId);
        await this.hub.emit([n.userId], { type: 'notification', unread });
      }
      // People looking at the app already see it live; only ping phones that are away.
      if (!this.hub.isOnline(n.userId)) {
        await this.push(n.userId, n.title, n.body ?? '', {
          type: n.type, postId: n.postId, commentId: n.commentId, conversationId: n.conversationId, orderId: n.orderId,
        });
      }
    } catch (e: any) {
      this.log.warn(`notify failed: ${e?.message}`);
    }
  }

  private async push(userId: string, title: string, body: string, data: Record<string, unknown>) {
    const tokens = await this.db.query<{ token: string }>(`select token from push_tokens where user_id = $1`, [userId]);
    if (!tokens.length) return;
    if (this.env.PUSH_DRIVER === 'log') {
      this.log.log(`push (log driver) to ${userId}: ${title} ${body}`);
      return;
    }
    const messages = tokens.map((t) => ({ to: t.token, title, body, data, sound: 'default', channelId: 'default' }));
    const res = await fetch(this.env.EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', Accept: 'application/json',
        ...(this.env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${this.env.EXPO_ACCESS_TOKEN}` } : {}),
      },
      body: JSON.stringify(messages),
      signal: AbortSignal.timeout(8000),
    });
    const json: any = await res.json().catch(() => ({}));
    // Expo says "DeviceNotRegistered" when the app was uninstalled; forget those tokens.
    const dead: string[] = [];
    (json.data ?? []).forEach((t: any, i: number) => {
      if (t?.status === 'error' && t?.details?.error === 'DeviceNotRegistered') dead.push(messages[i].to);
    });
    if (dead.length) await this.db.query(`delete from push_tokens where token = any($1::text[])`, [dead]);
    if (!res.ok) this.log.warn(`expo push ${res.status}`);
  }

  async list(userId: string, cursor?: string, limitRaw?: unknown) {
    const limit = clampLimit(limitRaw, 30, 60);
    const cur = decodeCursor(cursor);
    const rows = await this.db.query(
      `select n.*, a.username as a_username, a.display_name as a_name, a.avatar_url as a_avatar,
              (select coalesce(m.thumb_url, m.url) from post_media pm join media_assets m on m.id = pm.media_id where pm.post_id = n.post_id order by pm.position limit 1) as post_thumb
         from notifications n left join users a on a.id = n.actor_id
        where n.user_id = $1 and ($2::timestamptz is null or (n.created_at, n.id) < ($2::timestamptz, $3::uuid))
        order by n.created_at desc, n.id desc limit $4`,
      [userId, cur?.t ?? null, cur?.id ?? null, limit + 1]);
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const { unread } = await this.unreadCount(userId);
    return {
      unread,
      items: page.map((r) => ({
        id: r.id, type: r.type, title: r.title, body: r.body, read: !!r.read_at, createdAt: r.created_at,
        postId: r.post_id, commentId: r.comment_id, conversationId: r.conversation_id, orderId: r.order_id, postThumbUrl: r.post_thumb,
        actor: r.actor_id ? { id: r.actor_id, username: r.a_username, displayName: r.a_name, avatarUrl: r.a_avatar } : null,
      })),
      nextCursor: rows.length > limit && last ? encodeCursor(last.created_at, last.id) : null,
    };
  }

  async unreadCount(userId: string) {
    const r = await this.db.one<{ n: number }>(`select count(*)::int as n from notifications where user_id = $1 and read_at is null`, [userId]);
    return { unread: r?.n ?? 0 };
  }

  async markRead(userId: string, ids?: string[]) {
    if (ids?.length) await this.db.query(`update notifications set read_at = now() where user_id = $1 and id = any($2::uuid[]) and read_at is null`, [userId, ids]);
    else await this.db.query(`update notifications set read_at = now() where user_id = $1 and read_at is null`, [userId]);
    const c = await this.unreadCount(userId);
    await this.hub.emit([userId], { type: 'notification', unread: c.unread });
    return c;
  }

  async getPrefs(userId: string) {
    const r = await this.db.one<any>(`select * from notification_prefs where user_id = $1`, [userId]);
    return { likes: r?.likes ?? true, comments: r?.comments ?? true, follows: r?.follows ?? true, messages: r?.messages ?? true, orders: r?.orders ?? true };
  }

  async setPrefs(userId: string, p: Partial<Record<Category, boolean>>) {
    const cur = { ...(await this.getPrefs(userId)), ...p };
    await this.db.query(
      `insert into notification_prefs (user_id, likes, comments, follows, messages, orders) values ($1,$2,$3,$4,$5,$6)
       on conflict (user_id) do update set likes=$2, comments=$3, follows=$4, messages=$5, orders=$6`,
      [userId, cur.likes, cur.comments, cur.follows, cur.messages, cur.orders]);
    return cur;
  }

  async registerToken(userId: string, token: string, platform: string) {
    // A phone that signs into another account moves its token to that account.
    await this.db.query(
      `insert into push_tokens (user_id, token, platform) values ($1,$2,$3)
       on conflict (token) do update set user_id = $1, platform = $3, last_seen_at = now()`, [userId, token, platform]);
    return { ok: true };
  }

  async removeToken(userId: string, token: string) {
    await this.db.query(`delete from push_tokens where user_id = $1 and token = $2`, [userId, token]);
    return { ok: true };
  }
}
