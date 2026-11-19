import { BadRequestException, ForbiddenException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { Db } from '../db/db.service';
import { clampLimit, decodeCursor, encodeCursor } from '../common/cursor';
import { Hub } from './hub';
import { Notifications } from '../notifications/notifications.service';

export type SendInput =
  | { kind: 'text'; body: string; clientId: string }
  | { kind: 'image'; mediaId: string; body?: string; clientId: string }
  | { kind: 'voice'; mediaId: string; durationMs: number; clientId: string }
  | { kind: 'post' | 'product'; refId: string; body?: string; clientId: string };

const pairKey = (a: string, b: string) => (a < b ? `${a}:${b}` : `${b}:${a}`);

@Injectable()
export class ChatService {
  constructor(private db: Db, private hub: Hub, private notes: Notifications) {}

  private async blocked(a: string, b: string) {
    const r = await this.db.one(`select 1 from blocks where (blocker_id=$1 and blocked_id=$2) or (blocker_id=$2 and blocked_id=$1) limit 1`, [a, b]);
    return !!r;
  }

  private async requireMember(me: string, conversationId: string) {
    const other = await this.db.one<{ user_id: string }>(
      `select o.user_id from conversation_members m
         join conversation_members o on o.conversation_id = m.conversation_id and o.user_id <> m.user_id
        where m.conversation_id = $1 and m.user_id = $2`, [conversationId, me]);
    // Same answer for "no such chat" and "not yours", so ids can't be probed.
    if (!other) throw new NotFoundException('Conversation not found');
    return other.user_id;
  }

  async openWith(me: string, otherId: string) {
    if (otherId === me) throw new BadRequestException("You can't message yourself");
    const other = await this.db.one(`select id from users where id=$1 and deleted_at is null`, [otherId]);
    if (!other) throw new NotFoundException('User not found');
    if (await this.blocked(me, otherId)) throw new ForbiddenException("You can't message this person");
    const id = await this.db.tx(async (tx) => {
      const [c] = await tx.query<{ id: string }>(
        `insert into conversations (pair_key) values ($1)
         on conflict (pair_key) do update set pair_key = excluded.pair_key returning id`, [pairKey(me, otherId)]);
      await tx.query(`insert into conversation_members (conversation_id, user_id) values ($1,$2),($1,$3) on conflict do nothing`, [c.id, me, otherId]);
      return c.id;
    });
    return this.get(me, id);
  }

  private shapeConversation(r: any) {
    return {
      id: r.id,
      with: { id: r.o_id, username: r.o_username, displayName: r.o_display_name, avatarUrl: r.o_avatar_url },
      lastMessage: r.lm_id ? this.shapeMessage({ id: r.lm_id, conversation_id: r.id, sender_id: r.lm_sender, kind: r.lm_kind, body: r.lm_body, duration_ms: null, media_url: null, ref_id: null, client_id: '', created_at: r.lm_at }) : null,
      lastMessageAt: r.last_message_at,
      unread: r.unread,
      muted: r.muted,
    };
  }

  private static readonly LIST_SQL = `
    select c.id, c.last_message_at, m.muted,
           o.id as o_id, o.username as o_username, o.display_name as o_display_name, o.avatar_url as o_avatar_url,
           lm.id as lm_id, lm.sender_id as lm_sender, lm.kind as lm_kind, lm.body as lm_body, lm.created_at as lm_at,
           (select count(*)::int from messages x where x.conversation_id = c.id and x.sender_id <> $1 and x.created_at > m.last_read_at) as unread
      from conversations c
      join conversation_members m on m.conversation_id = c.id and m.user_id = $1
      join conversation_members om on om.conversation_id = c.id and om.user_id <> $1
      join users o on o.id = om.user_id and o.deleted_at is null
      left join messages lm on lm.id = c.last_message_id`;

  async get(me: string, id: string) {
    const r = await this.db.one(`${ChatService.LIST_SQL} where c.id = $2`, [me, id]);
    if (!r) throw new NotFoundException('Conversation not found');
    return this.shapeConversation(r);
  }

  async list(me: string) {
    const rows = await this.db.query(`${ChatService.LIST_SQL} order by c.last_message_at desc limit 200`, [me]);
    // Chats nobody has written in yet stay out of the list until the first message.
    return rows.filter((r) => r.lm_id).map((r) => this.shapeConversation(r));
  }

  async unreadTotal(me: string) {
    const r = await this.db.one<{ n: number }>(
      `select count(*)::int as n from messages x
         join conversation_members m on m.conversation_id = x.conversation_id and m.user_id = $1
        where x.sender_id <> $1 and x.created_at > m.last_read_at and not m.muted`, [me]);
    return { unread: r?.n ?? 0 };
  }

  private shapeMessage(r: any, ref: any = null) {
    return {
      id: r.id, conversationId: r.conversation_id, senderId: r.sender_id, kind: r.kind, body: r.body,
      mediaUrl: r.media_url, durationMs: r.duration_ms ?? null, refId: r.ref_id, ref, clientId: r.client_id, createdAt: r.created_at,
    };
  }

  // Small cards for shared posts and products, so the thread can draw them without more requests.
  private async withRefs(rows: any[]) {
    const productIds = rows.filter((r) => r.kind === 'product').map((r) => r.ref_id);
    const postIds = rows.filter((r) => r.kind === 'post').map((r) => r.ref_id);
    const products = new Map<string, any>();
    const posts = new Map<string, any>();
    if (productIds.length) {
      for (const p of await this.db.query(
        `select p.id, p.title, p.price_minor, p.currency, p.kind,
                (select coalesce(m.thumb_url, m.url) from product_media pm join media_assets m on m.id = pm.media_id where pm.product_id = p.id order by pm.position limit 1) as thumb
           from products p where p.id = any($1::uuid[]) and p.status = 'active'`, [productIds]))
        products.set(p.id, { id: p.id, title: p.title, priceMinor: Number(p.price_minor), currency: p.currency, kind: p.kind, thumbUrl: p.thumb });
    }
    if (postIds.length) {
      for (const p of await this.db.query(
        `select p.id, p.caption, p.kind, u.username,
                (select coalesce(m.thumb_url, m.url) from post_media pm join media_assets m on m.id = pm.media_id where pm.post_id = p.id order by pm.position limit 1) as thumb
           from posts p join users u on u.id = p.author_id where p.id = any($1::uuid[]) and p.status = 'published'`, [postIds]))
        posts.set(p.id, { id: p.id, caption: p.caption, kind: p.kind, username: p.username, thumbUrl: p.thumb });
    }
    return rows.map((r) => this.shapeMessage(r, r.kind === 'product' ? products.get(r.ref_id) ?? null : r.kind === 'post' ? posts.get(r.ref_id) ?? null : null));
  }

  async messages(me: string, conversationId: string, cursor?: string, limitRaw?: unknown) {
    await this.requireMember(me, conversationId);
    const limit = clampLimit(limitRaw, 30, 60);
    const cur = decodeCursor(cursor);
    const rows = await this.db.query(
      `select * from messages where conversation_id = $1
         and ($2::timestamptz is null or (created_at, id) < ($2::timestamptz, $3::uuid))
       order by created_at desc, id desc limit $4`,
      [conversationId, cur?.t ?? null, cur?.id ?? null, limit + 1]);
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const peer = await this.db.one<{ last_read_at: string }>(
      `select o.last_read_at from conversation_members o where o.conversation_id = $1 and o.user_id <> $2`, [conversationId, me]);
    return {
      items: await this.withRefs(page),
      nextCursor: rows.length > limit && last ? encodeCursor(last.created_at, last.id) : null,
      peerReadAt: peer?.last_read_at ?? null,
    };
  }

  async send(me: string, conversationId: string, input: SendInput) {
    const otherId = await this.requireMember(me, conversationId);
    if (await this.blocked(me, otherId)) throw new ForbiddenException("You can't message this person");

    // 30 messages per 10 seconds is plenty for a person and stops a script flooding someone.
    const recent = await this.db.one<{ n: number }>(`select count(*)::int as n from messages where sender_id = $1 and created_at > now() - interval '10 seconds'`, [me]);
    if ((recent?.n ?? 0) >= 30) throw new HttpException('Slow down a little', 429);

    let body: string | null = null;
    let mediaUrl: string | null = null;
    let refId: string | null = null;
    let durationMs: number | null = null;
    if (input.kind === 'text') body = input.body.trim();
    else if (input.kind === 'voice') {
      const m = await this.db.one<{ url: string }>(
        `select url from media_assets where id = $1 and owner_id = $2 and kind = 'audio' and status = 'ready'`, [input.mediaId, me]);
      if (!m?.url) throw new BadRequestException('That voice note is not ready or is not yours');
      mediaUrl = m.url;
      durationMs = Math.round(input.durationMs);
    }
    else {
      body = input.body?.trim() || null;
      if (input.kind === 'image') {
        const m = await this.db.one<{ url: string }>(
          `select url from media_assets where id = $1 and owner_id = $2 and kind = 'image' and status = 'ready'`, [input.mediaId, me]);
        if (!m?.url) throw new BadRequestException('That photo is not ready or is not yours');
        mediaUrl = m.url;
      } else {
        const ok = input.kind === 'product'
          ? await this.db.one(`select 1 from products where id = $1 and status = 'active'`, [input.refId])
          : await this.db.one(`select 1 from posts where id = $1 and status = 'published'`, [input.refId]);
        if (!ok) throw new BadRequestException(`That ${input.kind} isn't available`);
        refId = input.refId;
      }
    }
    if (input.kind === 'text' && !body) throw new BadRequestException('Message is empty');

    const row = await this.db.tx(async (tx) => {
      const [inserted] = await tx.query(
        `insert into messages (conversation_id, sender_id, kind, body, media_url, ref_id, client_id, duration_ms)
         values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (sender_id, client_id) do nothing returning *`,
        [conversationId, me, input.kind, body, mediaUrl, refId, input.clientId, durationMs]);
      if (!inserted) {
        // A retry of something already saved: hand back the original.
        const [existing] = await tx.query(`select * from messages where sender_id = $1 and client_id = $2`, [me, input.clientId]);
        return { row: existing, fresh: false };
      }
      await tx.query(`update conversations set last_message_id = $2, last_message_at = $3 where id = $1`, [conversationId, inserted.id, inserted.created_at]);
      // Sending something means you have read everything before it.
      await tx.query(`update conversation_members set last_read_at = $3 where conversation_id = $1 and user_id = $2`, [conversationId, me, inserted.created_at]);
      return { row: inserted, fresh: true };
    });
    if (row.row.conversation_id !== conversationId) throw new BadRequestException('clientId already used');
    const [message] = await this.withRefs([row.row]);
    if (row.fresh) {
      await this.hub.emit([me, otherId], { type: 'message', message });
      const muted = await this.db.one(`select 1 from conversation_members where conversation_id = $1 and user_id = $2 and muted`, [conversationId, otherId]);
      if (!muted) {
        const s = await this.db.one<{ display_name: string; username: string }>(`select display_name, username from users where id = $1`, [me]);
        const preview = input.kind === 'text' ? body! : input.kind === 'voice' ? '🎤 Voice note' : input.kind === 'image' ? '📷 Photo' : input.kind === 'post' ? 'Shared a post' : 'Shared a product';
        await this.notes.notify({ userId: otherId, actorId: me, type: 'message', conversationId, title: s?.display_name || s?.username || 'New message', body: preview.slice(0, 140) });
      }
    }
    return message;
  }

  /** "Typing…" is relayed live and never stored. */
  async typing(me: string, conversationId: string) {
    const otherId = await this.requireMember(me, conversationId);
    if (await this.blocked(me, otherId)) return;
    await this.hub.emit([otherId], { type: 'typing', conversationId, userId: me });
  }

  async markRead(me: string, conversationId: string) {
    const otherId = await this.requireMember(me, conversationId);
    const r = await this.db.one<{ last_read_at: string }>(
      `update conversation_members set last_read_at = now() where conversation_id = $1 and user_id = $2 returning last_read_at`, [conversationId, me]);
    await this.hub.emit([otherId, me], { type: 'read', conversationId, userId: me, at: r!.last_read_at });
    return { ok: true };
  }
}
