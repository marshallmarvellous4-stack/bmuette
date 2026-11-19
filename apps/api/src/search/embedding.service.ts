import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV, Env } from '../config/env';
import { Db } from '../db/db.service';

export const EMBED_DIM = 512;
export const toVector = (v: number[]) => `[${v.join(',')}]`;

// Talks to the Python AI service (CLIP-style model). Everything here is best effort:
// if the service is down or not configured, uploads and search still work with text only.
@Injectable()
export class EmbeddingService {
  private log = new Logger('Embedding');
  constructor(@Inject(ENV) private env: Env, private db: Db) {}

  get enabled() {
    return !!this.env.AI_SERVICE_URL;
  }

  private async call(path: string, body: unknown): Promise<number[] | null> {
    if (!this.env.AI_SERVICE_URL) return null;
    try {
      const res = await fetch(`${this.env.AI_SERVICE_URL}${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { embedding } = (await res.json()) as { embedding: number[] };
      if (!Array.isArray(embedding) || embedding.length !== EMBED_DIM) throw new Error(`expected ${EMBED_DIM} numbers`);
      return embedding;
    } catch (e: any) {
      this.log.warn(`${path} failed: ${e.message}`);
      return null;
    }
  }

  embedText(text: string) { return this.call('/embed/text', { text }); }
  embedImage(url: string) { return this.call('/embed/image', { url }); }

  /** Fire and forget after a post is created. */
  indexPost(postId: string) {
    if (!this.enabled) return;
    void (async () => {
      const row = await this.db.one(
        `select p.caption, p.tags, (select coalesce(m.thumb_url, m.url) from post_media pm join media_assets m on m.id = pm.media_id
                                     where pm.post_id = p.id order by pm.position limit 1) as image
           from posts p where p.id = $1`, [postId]);
      if (!row) return;
      const v = (row.image && (await this.embedImage(row.image))) || (await this.embedText(`${row.caption} ${row.tags.join(' ')}`.trim()));
      if (v) await this.db.query(`update posts set embedding = $2::vector where id = $1`, [postId, toVector(v)]);
    })().catch((e) => this.log.warn(`indexPost: ${e.message}`));
  }

  indexProduct(productId: string) {
    if (!this.enabled) return;
    void (async () => {
      const row = await this.db.one(
        `select p.title, p.description, p.tags, (select coalesce(m.thumb_url, m.url) from product_media pm join media_assets m on m.id = pm.media_id
                                                  where pm.product_id = p.id order by pm.position limit 1) as image
           from products p where p.id = $1`, [productId]);
      if (!row) return;
      const v = (row.image && (await this.embedImage(row.image))) || (await this.embedText(`${row.title} ${row.description} ${row.tags.join(' ')}`.trim()));
      if (v) await this.db.query(`update products set embedding = $2::vector where id = $1`, [productId, toVector(v)]);
    })().catch((e) => this.log.warn(`indexProduct: ${e.message}`));
  }
}
