import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard, UserId } from '../common/auth.guard';
import { ZodPipe } from '../common/zod.pipe';
import { Db } from '../db/db.service';
import { PostsService } from './posts.service';

const body = z.object({ name: z.string().trim().min(1).max(60) });

// Boards: private shelves where people file what they save.
@Controller('collections')
@UseGuards(AuthGuard)
export class CollectionsController {
  constructor(private db: Db, private posts: PostsService) {}

  @Post()
  async create(@UserId() uid: string, @Body(new ZodPipe(body)) b: z.infer<typeof body>) {
    const row = await this.db.one(`insert into collections (owner_id, name) values ($1,$2) returning id, name, created_at`, [uid, b.name]);
    return { id: row!.id, name: row!.name, createdAt: row!.created_at, itemCount: 0 };
  }

  @Get()
  async mine(@UserId() uid: string) {
    const rows = await this.db.query(
      `select c.id, c.name, c.created_at,
              (select count(*)::int from saves s where s.collection_id = c.id) as item_count,
              coalesce((select json_agg(t.thumb) from (
                 select coalesce((select coalesce(m.thumb_url, m.url) from post_media pm join media_assets m on m.id = pm.media_id where pm.post_id = s.post_id order by pm.position limit 1),
                                 (select coalesce(m.thumb_url, m.url) from product_media pm join media_assets m on m.id = pm.media_id where pm.product_id = s.product_id order by pm.position limit 1)) as thumb
                   from saves s where s.collection_id = c.id order by s.created_at desc limit 4) t where t.thumb is not null), '[]'::json) as covers
         from collections c where c.owner_id = $1 order by c.created_at desc`, [uid]);
    const all = await this.db.one<{ n: number }>(`select count(*)::int as n from saves where user_id = $1`, [uid]);
    return { total: all?.n ?? 0, items: rows.map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at, itemCount: r.item_count, covers: r.covers })) };
  }

  @Patch(':id')
  async rename(@UserId() uid: string, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(body)) b: z.infer<typeof body>) {
    const r = await this.db.one(`update collections set name = $3 where id = $1 and owner_id = $2 returning id, name`, [id, uid, b.name]);
    if (!r) throw new NotFoundException('Board not found');
    return { id: r.id, name: r.name };
  }

  // Deleting a board never deletes what was saved in it: those items just become "unsorted".
  @Delete(':id') @HttpCode(204)
  async remove(@UserId() uid: string, @Param('id', ParseUUIDPipe) id: string) {
    const r = await this.db.one(`delete from collections where id = $1 and owner_id = $2 returning id`, [id, uid]);
    if (!r) throw new NotFoundException('Board not found');
  }

  // Everything the person has saved, newest first, whether or not it is on a board.
  @Get('saved/items')
  async everything(@UserId() uid: string) {
    const rows = await this.db.query(`select post_id from saves where user_id = $1 and post_id is not null order by created_at desc limit 100`, [uid]);
    const products = await this.db.query(
      `select p.id, p.title, p.price_minor, p.currency,
              (select coalesce(m.thumb_url, m.url) from product_media pm join media_assets m on m.id = pm.media_id where pm.product_id = p.id order by pm.position limit 1) as image
         from saves s join products p on p.id = s.product_id where s.user_id = $1 and p.status = 'active' order by s.created_at desc limit 100`, [uid]);
    return {
      posts: await this.posts.hydrate(rows.map((r) => r.post_id), uid),
      products: products.map((p) => ({ id: p.id, title: p.title, priceMinor: Number(p.price_minor), currency: p.currency, image: p.image })),
    };
  }

  // Everything saved, or only what is filed in one board.
  @Get(':id/items')
  async items(@UserId() uid: string, @Param('id', ParseUUIDPipe) id: string) {
    const c = await this.db.one(`select 1 from collections where id = $1 and owner_id = $2`, [id, uid]);
    if (!c) throw new NotFoundException('Board not found');
    const rows = await this.db.query(`select post_id from saves where collection_id = $1 and post_id is not null order by created_at desc limit 100`, [id]);
    const products = await this.db.query(
      `select p.id, p.title, p.price_minor, p.currency,
              (select coalesce(m.thumb_url, m.url) from product_media pm join media_assets m on m.id = pm.media_id where pm.product_id = p.id order by pm.position limit 1) as image
         from saves s join products p on p.id = s.product_id where s.collection_id = $1 order by s.created_at desc limit 100`, [id]);
    return {
      posts: await this.posts.hydrate(rows.map((r) => r.post_id), uid),
      products: products.map((p) => ({ id: p.id, title: p.title, priceMinor: Number(p.price_minor), currency: p.currency, image: p.image })),
    };
  }
}
