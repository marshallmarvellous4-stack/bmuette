import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { ENV, Env } from '../config/env';

export type VideoInfo = { ready: boolean; durationMs?: number; width?: number; height?: number };

// Cloudflare Stream does the transcoding and global delivery, so the API never serves video bytes.
@Injectable()
export class VideoProvider {
  private log = new Logger('Video');
  constructor(@Inject(ENV) private env: Env) {
    if (env.VIDEO_DRIVER === 'cloudflare' && (!env.CF_ACCOUNT_ID || !env.CF_STREAM_API_TOKEN || !env.CF_STREAM_CUSTOMER_CODE)) {
      throw new Error('VIDEO_DRIVER=cloudflare needs CF_ACCOUNT_ID, CF_STREAM_API_TOKEN and CF_STREAM_CUSTOMER_CODE');
    }
  }

  get isCloud() {
    return this.env.VIDEO_DRIVER === 'cloudflare';
  }

  private api(path: string) {
    return `https://api.cloudflare.com/client/v4/accounts/${this.env.CF_ACCOUNT_ID}/stream${path}`;
  }

  async createDirectUpload(ownerId: string): Promise<{ uid: string; uploadUrl: string }> {
    const res = await fetch(this.api('/direct_upload'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.env.CF_STREAM_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxDurationSeconds: 600, creator: ownerId }),
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok || !body.success) {
      this.log.error(`direct_upload failed: ${res.status} ${JSON.stringify(body.errors ?? body)}`);
      throw new Error('Video provider is unavailable');
    }
    return { uid: body.result.uid, uploadUrl: body.result.uploadURL };
  }

  async lookup(uid: string): Promise<VideoInfo> {
    const res = await fetch(this.api(`/${uid}`), { headers: { Authorization: `Bearer ${this.env.CF_STREAM_API_TOKEN}` } });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok || !body.success) return { ready: false };
    return this.fromVideoObject(body.result);
  }

  fromVideoObject(v: any): VideoInfo {
    return {
      ready: !!v.readyToStream,
      durationMs: typeof v.duration === 'number' && v.duration > 0 ? Math.round(v.duration * 1000) : undefined,
      width: v.input?.width || undefined,
      height: v.input?.height || undefined,
    };
  }

  /** Asks Cloudflare to prepare an MP4 for "save to phone". Best effort. */
  async enableDownload(uid: string) {
    try {
      await fetch(this.api(`/${uid}/downloads`), { method: 'POST', headers: { Authorization: `Bearer ${this.env.CF_STREAM_API_TOKEN}` } });
    } catch (e) {
      this.log.warn(`enableDownload failed for ${uid}`);
    }
  }
  downloadUrl(uid: string) {
    return `https://customer-${this.env.CF_STREAM_CUSTOMER_CODE}.cloudflarestream.com/${uid}/downloads/default.mp4`;
  }

  playbackUrl(uid: string) {
    return `https://customer-${this.env.CF_STREAM_CUSTOMER_CODE}.cloudflarestream.com/${uid}/manifest/video.m3u8`;
  }
  thumbnailUrl(uid: string) {
    return `https://customer-${this.env.CF_STREAM_CUSTOMER_CODE}.cloudflarestream.com/${uid}/thumbnails/thumbnail.jpg`;
  }

  /** Header looks like "time=1700000000,sig1=<hex>" and signs "<time>.<raw body>". */
  verifyWebhook(rawBody: Buffer, header: string | undefined): boolean {
    const secret = this.env.CF_STREAM_WEBHOOK_SECRET;
    if (!secret || !header) return false;
    const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
    const time = Number(parts.time);
    if (!parts.sig1 || !Number.isFinite(time) || Math.abs(Date.now() / 1000 - time) > 300) return false;
    const expected = createHmac('sha256', secret).update(`${parts.time}.${rawBody.toString('utf8')}`).digest();
    const given = Buffer.from(parts.sig1, 'hex');
    return given.length === expected.length && timingSafeEqual(given, expected);
  }
}
