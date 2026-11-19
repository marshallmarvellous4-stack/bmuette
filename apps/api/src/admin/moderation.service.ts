import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Cache } from '../cache/cache.service';
import { Hub } from '../chat/hub';
import { clampLimit, decodeCursor, encodeCursor } from '../common/cursor';
import { Db, Tx } from '../db/db.service';

export const REPORT_ACTIONS = ['dismiss', 'hide', 'remove', 'restore', 'ban'] as const;
export type ReportAction = (typeof REPORT_ACTIONS)[number];

const ACCESS_TOKEN_SECONDS = 15 * 60 + 60; // longest an access token can live, plus a minute

// What admins can DO. Everything here is written to admin_actions so there is a record of who did what.
@Injectable()
export class ModerationService {
  constructor(private db: Db, private cache: Cache, private hub: Hub) {}

  private async audit(tx: Tx | Db, adminId: string, action: string, type: string, id: string, note?: string) {
    await tx.query(`insert into admin_actions (admin_id, action, target_type, target_id, note) values ($1,$2,$3,$4,$5)`, [adminId, action, type, id, note ?? null]);
  }

  // ---------------------------------------------------------------- queue
  async reports(status: string | undefined, cursor: string | undefined, limitRaw: unknown) {
    const limit = clampLimit(limitRaw, 25, 100);
    const cur = decodeCursor(cursor);
    const st = ['open', 'actioned', 'dismissed'].includes(status ?? '') ? status! : 'open';
    const rows = await this.db.query(
      `select r.id, r.reason, r.details, r.status, r.action, r.note, r.created_at, r.handled_at,
              rep.username as reporter,
              case when r.post_id is not null then 'post' when r.product_id is not null then 'product' when r.comment_id is not null then 'comment' else 'user' end as target_type,
              coalesce(r.post_id, r.product_id, r.comment_id, r.user_id) as target_id,
              p.caption as post_caption, p.status as post_status, p.kind as post_kind, pu.username as post_author,
              pr.title as product_title, pr.status as product_status, prm.shop_name as product_shop,
              c.body as comment_body, cu.username as comment_author, c.deleted_at as comment_deleted,
              tu.username as user_username, tu.banned_at as user_banned,
              (select count(*)::int from reports r2 where r2.status = 'open'
                  and coalesce(r2.post_id, r2.product_id, r2.comment_id, r2.user_id) = coalesce(r.post_id, r.product_id, r.comment_id, r.user_id)) as open_on_target
         from reports r
         join users rep on rep.id = r.reporter_id
         left join posts p on p.id = r.post_id left join users pu on pu.id = p.author_id
         left join products pr on pr.id = r.product_id left join merchants prm on prm.user_id = pr.merchant_id
         left join comments c on c.id = r.comment_id left join users cu on cu.id = c.user_id
         left join users tu on tu.id = r.user_id
        where r.status = $1 and ($2::timestamptz is null or (r.created_at, r.id) < ($2::timestamptz, $3::uuid))
        order by r.created_at desc, r.id desc limit $4`, [st, cur?.t ?? null, cur?.id ?? null, limit + 1]);
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const counts = await this.db.one(`select count(*) filter (where status = 'open')::int as open, count(*) filter (where status = 'actioned')::int as actioned, count(*) filter (where status = 'dismissed')::int as dismissed from reports`);
    return {
      counts,
      items: page.map((r) => ({
        id: r.id, reason: r.reason, details: r.details, status: r.status, action: r.action, note: r.note, createdAt: r.created_at, handledAt: r.handled_at,
        reporter: r.reporter, openOnTarget: r.open_on_target,
        target: {
          type: r.target_type, id: r.target_id,
          label: r.target_type === 'post' ? (r.post_caption || `(${r.post_kind} with no caption)`).slice(0, 140)
               : r.target_type === 'product' ? r.product_title
               : r.target_type === 'comment' ? (r.comment_body ?? '').slice(0, 140)
               : `@${r.user_username}`,
          owner: r.target_type === 'post' ? r.post_author : r.target_type === 'product' ? r.product_shop : r.target_type === 'comment' ? r.comment_author : r.user_username,
          state: r.target_type === 'post' ? r.post_status : r.target_type === 'product' ? r.product_status : r.target_type === 'comment' ? (r.comment_deleted ? 'removed' : 'visible') : (r.user_banned ? 'banned' : 'active'),
        },
      })),
      nextCursor: rows.length > limit && last ? encodeCursor(last.created_at, last.id) : null,
    };
  }

  // ---------------------------------------------------------------- acting on a report
  /** One decision settles every open report about the same thing. */
  async resolve(adminId: string, reportId: string, action: ReportAction, note?: string) {
    const r = await this.db.one(`select * from reports where id = $1`, [reportId]);
    if (!r) throw new NotFoundException('Report not found');
    const type = r.post_id ? 'post' : r.product_id ? 'product' : r.comment_id ? 'comment' : 'user';
    const targetId = (r.post_id ?? r.product_id ?? r.comment_id ?? r.user_id) as string;

    if (action !== 'dismiss') await this.applyToTarget(adminId, type, targetId, action, note ?? `report ${reportId}`);
    const col = type === 'post' ? 'post_id' : type === 'product' ? 'product_id' : type === 'comment' ? 'comment_id' : 'user_id';
    const done = await this.db.query(
      `update reports set status = $2, action = $3, handled_by = $4, handled_at = now(), note = $5
        where ${col} = $1 and status = 'open' returning id`,
      [targetId, action === 'dismiss' || action === 'restore' ? 'dismissed' : 'actioned', action, adminId, note ?? null]);
    await this.audit(this.db, adminId, `report:${action}`, type, targetId, note);
    return { ok: true, closed: done.length };
  }

  private async applyToTarget(adminId: string, type: string, id: string, action: ReportAction, note: string) {
    if (type === 'post') {
      const status = action === 'restore' ? 'published' : action === 'hide' ? 'held' : 'removed';
      const row = await this.db.one(`update posts set status = $2 where id = $1 returning author_id`, [id, status]);
      if (!row) throw new NotFoundException('Post not found');
      if (action === 'ban') await this.ban(adminId, row.author_id, note);
    } else if (type === 'product') {
      const status = action === 'restore' ? 'active' : 'archived';
      const row = await this.db.one(`update products set status = $2 where id = $1 returning merchant_id`, [id, status]);
      if (!row) throw new NotFoundException('Product not found');
      if (action === 'ban') await this.ban(adminId, row.merchant_id, note);
    } else if (type === 'comment') {
      const row = await this.db.one(`select post_id, user_id, deleted_at from comments where id = $1`, [id]);
      if (!row) throw new NotFoundException('Comment not found');
      if (action === 'hide' || action === 'remove' || action === 'ban') {
        if (!row.deleted_at) {
          await this.db.tx(async (tx) => {
            const gone = await tx.query(`update comments set deleted_at = now() where (id = $1 or parent_id = $1) and deleted_at is null returning 1`, [id]);
            await tx.query(`update posts set comment_count = greatest(comment_count - $2, 0) where id = $1`, [row.post_id, gone.length]);
          });
        }
        if (action === 'ban') await this.ban(adminId, row.user_id, note);
      } else if (action === 'restore' && row.deleted_at) {
        await this.db.tx(async (tx) => {
          await tx.query(`update comments set deleted_at = null where id = $1`, [id]);
          await tx.query(`update posts set comment_count = comment_count + 1 where id = $1`, [row.post_id]);
        });
      }
    } else {
      if (action === 'ban') await this.ban(adminId, id, note);
      else if (action === 'restore') await this.unban(adminId, id);
      else if (action === 'hide' || action === 'remove') throw new BadRequestException('For a person, choose Ban or Dismiss');
    }
  }

  // ---------------------------------------------------------------- accounts
  async ban(adminId: string, userId: string, reason: string) {
    if (userId === adminId) throw new ConflictException('You cannot ban yourself');
    const u = await this.db.one(`select is_admin, deleted_at from users where id = $1`, [userId]);
    if (!u || u.deleted_at) throw new NotFoundException('User not found');
    if (u.is_admin) throw new ConflictException('Remove their admin access first');
    await this.db.tx(async (tx) => {
      await tx.query(`update users set banned_at = coalesce(banned_at, now()), ban_reason = $2 where id = $1`, [userId, reason.slice(0, 300)]);
      await tx.query(`update refresh_tokens set revoked_at = now() where user_id = $1 and revoked_at is null`, [userId]);
      // Their posts and shop disappear while the account is suspended.
      await tx.query(`update posts set status = 'held' where author_id = $1 and status = 'published'`, [userId]);
      await tx.query(`update products set status = 'archived' where merchant_id = $1 and status = 'active'`, [userId]);
      await this.audit(tx, adminId, 'ban', 'user', userId, reason);
    });
    await this.cache.setFlag(`banned:${userId}`, ACCESS_TOKEN_SECONDS);
    this.hub.kick(userId);
    return { ok: true };
  }

  async unban(adminId: string, userId: string) {
    const u = await this.db.one(`update users set banned_at = null, ban_reason = null where id = $1 and deleted_at is null returning id`, [userId]);
    if (!u) throw new NotFoundException('User not found');
    await this.cache.clearFlag(`banned:${userId}`);
    // Posts held by the ban come back. Posts an admin removed on purpose stay removed.
    await this.db.query(`update posts set status = 'published' where author_id = $1 and status = 'held' and report_count < 5`, [userId]);
    await this.audit(this.db, adminId, 'unban', 'user', userId);
    return { ok: true };
  }

  async setPostStatus(adminId: string, postId: string, status: 'published' | 'held' | 'removed') {
    const row = await this.db.one(`update posts set status = $2 where id = $1 returning id`, [postId, status]);
    if (!row) throw new NotFoundException('Post not found');
    await this.audit(this.db, adminId, `post:${status}`, 'post', postId);
    return { ok: true };
  }

  async audits(limitRaw: unknown) {
    const rows = await this.db.query(
      `select a.id, a.action, a.target_type, a.target_id, a.note, a.created_at, u.username as admin
         from admin_actions a left join users u on u.id = a.admin_id order by a.created_at desc, a.id desc limit $1`, [clampLimit(limitRaw, 50, 200)]);
    return { items: rows.map((r) => ({ id: Number(r.id), action: r.action, targetType: r.target_type, targetId: r.target_id, note: r.note, at: r.created_at, admin: r.admin })) };
  }

  async emails(limitRaw: unknown) {
    const rows = await this.db.query(`select id, to_email, subject, body, driver, status, created_at from email_outbox order by id desc limit $1`, [clampLimit(limitRaw, 30, 100)]);
    return { items: rows.map((r) => ({ id: Number(r.id), to: r.to_email, subject: r.subject, body: r.body, driver: r.driver, status: r.status, at: r.created_at })) };
  }
}
