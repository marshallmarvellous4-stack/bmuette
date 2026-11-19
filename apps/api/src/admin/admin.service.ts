import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { clampLimit, decodeCursor, encodeCursor } from '../common/cursor';
import { ENV, Env } from '../config/env';
import { Cache } from '../cache/cache.service';
import { Db } from '../db/db.service';
import { Hub } from '../chat/hub';

type Win = { unit: 'hour' | 'day'; n: number; tz: string; start: string; prevStart: string };
const num = (v: unknown) => Number(v ?? 0);
const pair = (r: any) => ({ cur: num(r?.cur), prev: num(r?.prev) });

@Injectable()
export class AdminService {
  constructor(private db: Db, private cache: Cache, private hub: Hub, @Inject(ENV) private env: Env) {}

  // ---------------------------------------------------------------- windows
  private async window(daysRaw: unknown, tzRaw: unknown): Promise<Win> {
    const days = Math.min(Math.max(Math.floor(Number(daysRaw)) || 7, 1), 365);
    const tz = typeof tzRaw === 'string' && tzRaw ? tzRaw : 'UTC';
    const ok = await this.db.one(`select 1 from pg_timezone_names where name = $1`, [tz]);
    if (!ok) throw new BadRequestException('Unknown time zone');
    const unit = days === 1 ? 'hour' : 'day';
    const n = days === 1 ? 24 : days;
    // Windows start on a bucket boundary in the admin's own time zone, so "today" means their today.
    const r = await this.db.one<{ start: string; prev: string }>(
      `select ((date_trunc('${unit}', now() at time zone $1) - ($2 - 1) * interval '1 ${unit}') at time zone $1) as start,
              ((date_trunc('${unit}', now() at time zone $1) - (2 * $2 - 1) * interval '1 ${unit}') at time zone $1) as prev`, [tz, n]);
    return { unit, n, tz, start: new Date(r!.start).toISOString(), prevStart: new Date(r!.prev).toISOString() };
  }

  private async countIn(w: Win, from: string, ts: string, where = '') {
    const r = await this.db.one(
      `select count(*) filter (where ${ts} >= $1) as cur, count(*) filter (where ${ts} >= $2 and ${ts} < $1) as prev
         from ${from} where ${ts} >= $2 ${where ? `and (${where})` : ''}`, [w.start, w.prevStart]);
    return pair(r);
  }

  // One number per hour or day, zero-filled so charts have no gaps.
  private async series(w: Win, from: string, ts: string, value = 'count(*)', where = '') {
    const rows = await this.db.query(
      `with b as (select generate_series(date_trunc('${w.unit}', now() at time zone $1) - ($2 - 1) * interval '1 ${w.unit}', date_trunc('${w.unit}', now() at time zone $1), interval '1 ${w.unit}') as t),
            d as (select date_trunc('${w.unit}', ${ts} at time zone $1) as t, (${value})::float8 as v from ${from} where ${ts} >= $3 ${where ? `and (${where})` : ''} group by 1)
       select to_char(b.t, 'YYYY-MM-DD"T"HH24:MI') as t, coalesce(d.v, 0) as v from b left join d using (t) order by b.t`, [w.tz, w.n, w.start]);
    return rows.map((r) => ({ t: r.t as string, v: num(r.v) }));
  }

  // Everything a person can do that means "they used the app". Used for active-user counts.
  private static readonly ACTIONS = `(
      select user_id as u, created_at as ts from likes
      union all select user_id, created_at from comments
      union all select author_id, created_at from posts
      union all select sender_id, created_at from messages
      union all select buyer_id, created_at from orders
      union all select follower_id, created_at from follows
      union all select user_id, created_at from views where user_id is not null
      union all select user_id, created_at from refresh_tokens
    )`;

  // ---------------------------------------------------------------- overview
  async overview(daysRaw: unknown, tzRaw: unknown) {
    const w = await this.window(daysRaw, tzRaw);
    const A = AdminService.ACTIONS;
    const [users, newUsers, active, posts, videos, photos, comments, likes, follows, views, messages, merchants, newMerchants, products, newProducts, ordersCreated, ordersPaid] = await Promise.all([
      this.db.one(`select count(*)::int as n from users where deleted_at is null`),
      this.countIn(w, 'users', 'created_at'),
      this.db.one(`select count(distinct u) filter (where ts >= $1) as cur, count(distinct u) filter (where ts >= $2 and ts < $1) as prev from ${A} a where ts >= $2`, [w.start, w.prevStart]).then(pair),
      this.countIn(w, 'posts', 'created_at'),
      this.countIn(w, 'posts', 'created_at', `kind = 'video'`),
      this.countIn(w, 'posts', 'created_at', `kind = 'photo'`),
      this.countIn(w, 'comments', 'created_at', 'deleted_at is null'),
      this.countIn(w, 'likes', 'created_at'),
      this.countIn(w, 'follows', 'created_at'),
      this.countIn(w, 'views', 'created_at'),
      this.countIn(w, 'messages', 'created_at'),
      this.db.one(`select count(*)::int as n from merchants`),
      this.countIn(w, 'merchants', 'created_at'),
      this.db.one(`select count(*)::int as n from products where status = 'active'`),
      this.countIn(w, 'products', 'created_at'),
      this.countIn(w, 'orders', 'created_at'),
      this.countIn(w, 'orders', 'paid_at', `status = 'paid'`),
    ]);

    const money = await this.db.query(
      `select currency, count(*) filter (where paid_at >= $1)::int as orders, coalesce(sum(total_minor) filter (where paid_at >= $1), 0) as gmv,
              coalesce(sum(fee_minor) filter (where paid_at >= $1), 0) as fee, coalesce(sum(total_minor) filter (where paid_at >= $2 and paid_at < $1), 0) as prev_gmv,
              coalesce(sum(fee_minor) filter (where paid_at >= $2 and paid_at < $1), 0) as prev_fee
         from orders where status = 'paid' and paid_at >= $2 group by currency order by gmv desc`, [w.start, w.prevStart]);
    const byStatus = await this.db.query(`select status, count(*)::int as n from orders where created_at >= $1 group by status`, [w.start]);
    const created = byStatus.reduce((a, r) => a + r.n, 0);
    const paidOfCreated = byStatus.find((r) => r.status === 'paid')?.n ?? 0;

    const attention = await this.db.one(
      `select (select count(*) from orders where status = 'pending' and created_at < now() - interval '1 hour' and created_at > now() - interval '14 days')::int as stuck,
              (select count(*) from orders where status = 'failed' and created_at > now() - interval '24 hours')::int as failed,
              (select count(*) from error_log where at > now() - interval '24 hours')::int as errors,
              (select count(*) from reports where status = 'open')::int as reports`);

    const currencies = money.map((m) => m.currency as string);
    const [sSignups, sActive, sPosts, sOrders, sPaid, sMessages, ...sRevenue] = await Promise.all([
      this.series(w, 'users', 'created_at'),
      this.series(w, `${A} a`, 'ts', 'count(distinct u)'),
      this.series(w, 'posts', 'created_at'),
      this.series(w, 'orders', 'created_at'),
      this.series(w, 'orders', 'paid_at', 'count(*)', `status = 'paid'`),
      this.series(w, 'messages', 'created_at'),
      ...currencies.map((c) => this.series(w, 'orders', 'paid_at', 'sum(total_minor)', `status = 'paid' and currency = '${c.replace(/[^A-Z]/g, '')}'`)),
    ]);

    const [countries, productKinds, topProducts, topMerchants, topPosts, providers] = await Promise.all([
      this.db.query(`select coalesce(country, '??') as k, count(*)::int as n from users where created_at >= $1 group by 1 order by n desc limit 8`, [w.start]),
      this.db.query(`select kind as k, count(*)::int as n from products where status = 'active' group by 1 order by n desc`),
      this.db.query(
        `select oi.product_id as id, oi.title, o.currency, sum(oi.qty)::int as units, sum(oi.qty * oi.unit_price_minor) as revenue
           from order_items oi join orders o on o.id = oi.order_id where o.status = 'paid' and o.paid_at >= $1 group by 1,2,3 order by revenue desc limit 5`, [w.start]),
      this.db.query(
        `select m.shop_name as name, o.currency, sum(oi.qty * oi.unit_price_minor) as revenue, sum(oi.qty)::int as units
           from order_items oi join orders o on o.id = oi.order_id join merchants m on m.user_id = oi.merchant_id
          where o.status = 'paid' and o.paid_at >= $1 group by 1,2 order by revenue desc limit 5`, [w.start]),
      this.db.query(
        `select p.id, left(coalesce(p.caption, ''), 60) as caption, p.kind, u.username, count(*)::int as views
           from views v join posts p on p.id = v.post_id join users u on u.id = p.author_id where v.created_at >= $1 group by p.id, u.username order by views desc limit 5`, [w.start]),
      this.db.query(`select provider, status, count(*)::int as n, coalesce(sum(total_minor), 0) as total, currency from orders where created_at >= $1 group by provider, status, currency order by provider, status`, [w.start]),
    ]);

    return {
      window: { days: w.unit === 'hour' ? 1 : w.n, unit: w.unit, tz: w.tz, start: w.start },
      attention: { stuckPending: num(attention!.stuck), failedPayments24h: num(attention!.failed), serverErrors24h: num(attention!.errors), reports7d: num(attention!.reports) },
      kpis: {
        users: { total: num(users!.n), newUsers, active },
        content: { posts, videos, photos, comments, likes, follows, views, messages },
        market: { merchants: num(merchants!.n), newMerchants, activeProducts: num(products!.n), newProducts },
        orders: {
          created: ordersCreated, paid: ordersPaid, conversion: created ? paidOfCreated / created : null,
          byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r.n])),
          money: money.map((m) => ({ currency: m.currency, orders: m.orders, gmvMinor: num(m.gmv), feeMinor: num(m.fee), prevGmvMinor: num(m.prev_gmv), prevFeeMinor: num(m.prev_fee), avgOrderMinor: m.orders ? Math.round(num(m.gmv) / m.orders) : 0 })),
        },
      },
      series: { signups: sSignups, active: sActive, posts: sPosts, orders: sOrders, paid: sPaid, messages: sMessages, revenue: Object.fromEntries(currencies.map((c, i) => [c, sRevenue[i]])) },
      breakdowns: {
        signupCountries: countries.map((r) => ({ key: r.k, n: r.n })),
        productKinds: productKinds.map((r) => ({ key: r.k, n: r.n })),
        topProducts: topProducts.map((r) => ({ id: r.id, title: r.title, currency: r.currency, units: r.units, revenueMinor: num(r.revenue) })),
        topMerchants: topMerchants.map((r) => ({ name: r.name, currency: r.currency, units: r.units, revenueMinor: num(r.revenue) })),
        topPosts: topPosts.map((r) => ({ id: r.id, caption: r.caption, kind: r.kind, username: r.username, views: r.views })),
        providers: providers.map((r) => ({ provider: r.provider, status: r.status, n: r.n, totalMinor: num(r.total), currency: r.currency })),
      },
    };
  }

  // ---------------------------------------------------------------- people
  async people(q: string | undefined, cursor: string | undefined, limitRaw: unknown) {
    const limit = clampLimit(limitRaw, 25, 100);
    const cur = decodeCursor(cursor);
    const like = q?.trim() ? `%${q.trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
    const rows = await this.db.query(
      `select u.id, u.username, u.display_name, u.email, u.country, u.created_at, u.is_merchant, u.is_admin, u.follower_count, u.banned_at, u.email_verified_at,
              (select count(*)::int from posts p where p.author_id = u.id) as posts,
              (select count(*)::int from orders o where o.buyer_id = u.id and o.status = 'paid') as paid_orders,
              (select max(r.created_at) from refresh_tokens r where r.user_id = u.id) as last_seen
         from users u
        where u.deleted_at is null
          and ($1::text is null or u.username ilike $1 or u.email ilike $1 or u.display_name ilike $1)
          and ($2::timestamptz is null or (u.created_at, u.id) < ($2::timestamptz, $3::uuid))
        order by u.created_at desc, u.id desc limit $4`, [like, cur?.t ?? null, cur?.id ?? null, limit + 1]);
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const total = await this.db.one(`select count(*)::int as n from users where deleted_at is null`);
    return {
      total: num(total!.n),
      items: page.map((r) => ({ id: r.id, username: r.username, displayName: r.display_name, email: r.email, country: r.country, createdAt: r.created_at, isMerchant: r.is_merchant, isAdmin: r.is_admin, banned: !!r.banned_at, emailVerified: !!r.email_verified_at, followers: r.follower_count, posts: r.posts, paidOrders: r.paid_orders, lastSeen: r.last_seen })),
      nextCursor: rows.length > limit && last ? encodeCursor(last.created_at, last.id) : null,
    };
  }

  // ---------------------------------------------------------------- orders and payments
  async orders(status: string | undefined, cursor: string | undefined, limitRaw: unknown) {
    const limit = clampLimit(limitRaw, 25, 100);
    const cur = decodeCursor(cursor);
    const st = ['pending', 'paid', 'failed', 'cancelled', 'refunded'].includes(status ?? '') ? status! : null;
    // Shipping addresses are deliberately not returned: the dashboard doesn't need them.
    const rows = await this.db.query(
      `select o.id, o.status, o.currency, o.subtotal_minor, o.fee_minor, o.total_minor, o.provider, o.provider_ref, o.created_at, o.paid_at,
              u.username, u.email,
              (select coalesce(json_agg(json_build_object('title', i.title, 'qty', i.qty, 'unitPriceMinor', i.unit_price_minor, 'shop', m.shop_name, 'fulfilment', i.fulfilment) order by i.title), '[]'::json)
                 from order_items i join merchants m on m.user_id = i.merchant_id where i.order_id = o.id) as items
         from orders o join users u on u.id = o.buyer_id
        where ($1::text is null or o.status = $1)
          and ($2::timestamptz is null or (o.created_at, o.id) < ($2::timestamptz, $3::uuid))
        order by o.created_at desc, o.id desc limit $4`, [st, cur?.t ?? null, cur?.id ?? null, limit + 1]);
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map((r) => ({ id: r.id, status: r.status, currency: r.currency, subtotalMinor: num(r.subtotal_minor), feeMinor: num(r.fee_minor), totalMinor: num(r.total_minor), provider: r.provider, providerRef: r.provider_ref, createdAt: r.created_at, paidAt: r.paid_at, buyer: { username: r.username, email: r.email }, items: r.items })),
      nextCursor: rows.length > limit && last ? encodeCursor(last.created_at, last.id) : null,
    };
  }

  async paymentEvents(limitRaw: unknown) {
    const rows = await this.db.query(
      `select provider, event_id, created_at,
              coalesce(payload->>'type', payload->>'event') as type,
              coalesce(payload->'data'->'object'->>'id', payload->'data'->>'tx_ref', payload->'data'->>'id') as ref,
              coalesce(payload->'data'->'object'->>'payment_status', payload->'data'->>'status') as status
         from payment_events order by created_at desc limit $1`, [clampLimit(limitRaw, 30, 100)]);
    return rows.map((r) => ({ provider: r.provider, eventId: r.event_id, at: r.created_at, type: r.type, ref: r.ref, status: r.status }));
  }

  // ---------------------------------------------------------------- activity log
  private static readonly KINDS: Record<string, (lim: string) => string> = {
    signup: () => `select u.created_at as at, 'signup' as kind, u.username as actor, coalesce(u.country, '') as detail, u.id::text as ref from users u where u.created_at < $1 order by u.created_at desc limit $2`,
    session: () => `select r.created_at, 'session', u.username, '', r.family_id::text from refresh_tokens r join users u on u.id = r.user_id
                     where r.created_at < $1 and not exists (select 1 from refresh_tokens e where e.family_id = r.family_id and e.created_at < r.created_at) order by r.created_at desc limit $2`,
    post: () => `select p.created_at, 'post', u.username, p.kind || ': ' || left(coalesce(p.caption, ''), 80), p.id::text from posts p join users u on u.id = p.author_id where p.created_at < $1 order by p.created_at desc limit $2`,
    comment: () => `select c.created_at, 'comment', u.username, left(c.body, 80), c.post_id::text from comments c join users u on u.id = c.user_id where c.created_at < $1 and c.deleted_at is null order by c.created_at desc limit $2`,
    merchant: () => `select m.created_at, 'merchant', u.username, m.shop_name || ' (' || m.country || ')', m.user_id::text from merchants m join users u on u.id = m.user_id where m.created_at < $1 order by m.created_at desc limit $2`,
    product: () => `select p.created_at, 'product', u.username, p.title || ' · ' || p.kind || ' · ' || p.currency || ' ' || (p.price_minor / 100.0)::numeric(14,2), p.id::text from products p join users u on u.id = p.merchant_id where p.created_at < $1 order by p.created_at desc limit $2`,
    order: () => `select o.created_at, 'order', u.username, o.currency || ' ' || (o.total_minor / 100.0)::numeric(14,2) || ' via ' || o.provider || ' (' || o.status || ')', o.id::text from orders o join users u on u.id = o.buyer_id where o.created_at < $1 order by o.created_at desc limit $2`,
    payment: () => `select o.paid_at, 'payment', u.username, o.currency || ' ' || (o.total_minor / 100.0)::numeric(14,2) || ' paid via ' || o.provider, o.id::text from orders o join users u on u.id = o.buyer_id where o.paid_at < $1 order by o.paid_at desc limit $2`,
    report: () => `select r.created_at, 'report', u.username, left(r.reason, 80), coalesce(r.post_id, r.product_id, r.comment_id, r.user_id)::text from reports r join users u on u.id = r.reporter_id where r.created_at < $1 order by r.created_at desc limit $2`,
    webhook: () => `select e.created_at, 'webhook', e.provider, coalesce(e.payload->>'type', e.payload->>'event', '') || ' ' || coalesce(e.payload->'data'->'object'->>'id', e.payload->'data'->>'tx_ref', ''), e.event_id from payment_events e where e.created_at < $1 order by e.created_at desc limit $2`,
    error: () => `select e.at, 'error', coalesce(e.user_id::text, ''), e.status || ' ' || e.method || ' ' || e.path || ': ' || left(e.message, 120), e.id::text from error_log e where e.at < $1 order by e.at desc limit $2`,
  };
  static readonly KIND_NAMES = Object.keys(AdminService.KINDS);

  async activity(kindsRaw: string | undefined, before: string | undefined, limitRaw: unknown) {
    const limit = clampLimit(limitRaw, 60, 150);
    const want = (kindsRaw ? kindsRaw.split(',') : AdminService.KIND_NAMES).filter((k) => k in AdminService.KINDS);
    if (!want.length) throw new BadRequestException('Unknown activity kind');
    const upper = before && !Number.isNaN(Date.parse(before)) ? new Date(before).toISOString() : new Date(Date.now() + 60_000).toISOString();
    const sql = `select * from (${want.map((k) => `(${AdminService.KINDS[k]('')})`).join(' union all ')}) a(at, kind, actor, detail, ref) order by at desc limit $3`;
    const rows = await this.db.query(sql, [upper, limit, limit]);
    return {
      items: rows.map((r) => ({ at: r.at, kind: r.kind, actor: r.actor, detail: r.detail, ref: r.ref })),
      nextBefore: rows.length === limit ? new Date(rows[rows.length - 1].at).toISOString() : null,
    };
  }

  async errors(limitRaw: unknown) {
    const rows = await this.db.query(`select id, at, method, path, status, message from error_log order by at desc limit $1`, [clampLimit(limitRaw, 50, 200)]);
    return rows.map((r) => ({ id: r.id, at: r.at, method: r.method, path: r.path, status: r.status, message: r.message }));
  }

  // ---------------------------------------------------------------- system
  async system() {
    const t0 = Date.now();
    await this.db.query('select 1');
    const dbMs = Date.now() - t0;
    const [size, counts, migrations] = await Promise.all([
      this.db.one(`select pg_database_size(current_database())::float8 as bytes`),
      this.db.one(
        `select (select count(*) from users where deleted_at is null)::int as users, (select count(*) from posts)::int as posts, (select count(*) from products)::int as products,
                (select count(*) from orders)::int as orders, (select count(*) from messages)::int as messages, (select count(*) from media_assets)::int as media`),
      this.db.query(`select name from schema_migrations order by name`),
    ]);
    const e = this.env;
    const stripe = !!(e.STRIPE_SECRET_KEY && e.STRIPE_WEBHOOK_SECRET);
    const flutterwave = !!(e.FLW_SECRET_KEY && e.FLW_WEBHOOK_HASH);
    const warnings: string[] = [];
    if (!stripe && !flutterwave) warnings.push('No payment provider is configured, so checkout will fail.');
    else if (!flutterwave) warnings.push('Flutterwave is not configured: Naira checkout will fail.');
    else if (!stripe) warnings.push('Stripe is not configured: checkout in other currencies will fail.');
    if (e.STORAGE_DRIVER === 'local' || e.VIDEO_DRIVER === 'local') warnings.push('Photos and videos are stored on this server only (local drivers). Fine for testing, not for launch.');
    if (/change-me/i.test(e.JWT_ACCESS_SECRET)) warnings.push('JWT_ACCESS_SECRET is still the example value. Anyone who has read the example can forge sign-ins.');
    if (!e.AI_SERVICE_URL) warnings.push('AI service is off: search by photo and meaning is disabled (text search still works).');
    if (!e.REDIS_URL) warnings.push('Redis is off: caching is per server and live chat only works on a single server.');
    return {
      ok: true, dbLatencyMs: dbMs, dbSizeBytes: num(size!.bytes), counts,
      migrations: migrations.map((m) => m.name),
      redis: await this.cache.status(),
      live: this.hub.stats(),
      config: { env: e.NODE_ENV, storage: e.STORAGE_DRIVER, video: e.VIDEO_DRIVER, stripe, flutterwave, ai: !!e.AI_SERVICE_URL, email: e.EMAIL_DRIVER, platformFeePercent: e.PLATFORM_FEE_BPS / 100, publicBaseUrl: e.PUBLIC_BASE_URL },
      runtime: { node: process.version, uptimeSeconds: Math.round(process.uptime()), rssMb: Math.round(process.memoryUsage().rss / 1048576) },
      warnings,
    };
  }
}
