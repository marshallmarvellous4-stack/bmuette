import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Db } from '../db/db.service';
import { Storage } from './storage';
import { VideoProvider } from './video';

export const IMAGE_MIMES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif' };
export const VIDEO_MIMES: Record<string, string> = { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' };
export const AUDIO_MIMES: Record<string, string> = { 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/m4a': 'm4a', 'audio/aac': 'aac', 'audio/mpeg': 'mp3', 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/wav': 'wav' };
export const MAX_AUDIO_BYTES = 15 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024; // larger files need resumable (tus) uploads

export type MediaView = {
  id: string; kind: 'image' | 'video' | 'audio'; status: string; url: string | null; thumbUrl: string | null;
  width: number | null; height: number | null; durationMs: number | null;
};
export const toMediaView = (m: any): MediaView => ({
  id: m.id, kind: m.kind, status: m.status, url: m.url, thumbUrl: m.thumb_url, width: m.width, height: m.height, durationMs: m.duration_ms,
});

@Injectable()
export class MediaService {
  constructor(private db: Db, private storage: Storage, private video: VideoProvider) {}

  async createUpload(userId: string, input: { kind: 'image' | 'video' | 'audio'; mime: string; bytes: number; width?: number; height?: number }) {
    const table = input.kind === 'image' ? IMAGE_MIMES : input.kind === 'audio' ? AUDIO_MIMES : VIDEO_MIMES;
    const ext = table[input.mime];
    if (!ext) throw new BadRequestException(`Unsupported ${input.kind} type: ${input.mime}`);
    const max = input.kind === 'image' ? MAX_IMAGE_BYTES : input.kind === 'audio' ? MAX_AUDIO_BYTES : MAX_VIDEO_BYTES;
    if (input.bytes > max) throw new BadRequestException(`File is too large (limit ${Math.round(max / 1024 / 1024)} MB)`);

    const id = randomUUID();
    const key = `${input.kind}/${userId}/${id}.${ext}`;

    if (input.kind === 'video' && this.video.isCloud) {
      const { uid, uploadUrl } = await this.video.createDirectUpload(userId);
      await this.db.query(
        `insert into media_assets (id, owner_id, kind, mime, bytes, stream_uid, width, height) values ($1,$2,'video',$3,$4,$5,$6,$7)`,
        [id, userId, input.mime, input.bytes, uid, input.width ?? null, input.height ?? null],
      );
      return { id, uploadUrl, method: 'POST' as const, headers: {}, formField: 'file' };
    }

    await this.db.query(
      `insert into media_assets (id, owner_id, kind, mime, bytes, storage_key, width, height) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, userId, input.kind, input.mime, input.bytes, key, input.width ?? null, input.height ?? null],
    );
    return { id, ...(await this.storage.presignPut(key, input.mime)) };
  }

  async complete(userId: string, id: string) {
    const m = await this.owned(userId, id);
    if (m.status === 'ready') return toMediaView(m);

    if (m.kind === 'video' && m.stream_uid) {
      // The webhook normally flips this to ready. Asking once here covers a missed webhook.
      const info = await this.video.lookup(m.stream_uid);
      return toMediaView(info.ready ? await this.markVideoReady(m.stream_uid, info) : await this.setStatus(id, 'processing'));
    }

    const size = await this.storage.head(m.storage_key);
    if (size === null) throw new BadRequestException('The file has not finished uploading');
    if (size > (m.kind === 'image' ? MAX_IMAGE_BYTES : m.kind === 'audio' ? MAX_AUDIO_BYTES : MAX_VIDEO_BYTES)) {
      await this.setStatus(id, 'failed');
      throw new BadRequestException('Uploaded file is larger than allowed');
    }
    const url = this.storage.publicUrl(m.storage_key);
    const row = await this.db.one(
      `update media_assets set status = 'ready', url = $2, thumb_url = $3, bytes = $4 where id = $1 returning *`,
      [id, url, m.kind === 'image' ? url : null, size],
    );
    await this.publishReadyPosts();
    return toMediaView(row);
  }

  async get(userId: string, id: string) {
    const m = await this.owned(userId, id);
    if (m.status === 'processing' && m.stream_uid) {
      const info = await this.video.lookup(m.stream_uid);
      if (info.ready) return toMediaView(await this.markVideoReady(m.stream_uid, info));
    }
    return toMediaView(m);
  }

  /** Called by the Cloudflare Stream webhook and by the status check above. */
  async markVideoReady(uid: string, info: { durationMs?: number; width?: number; height?: number }) {
    const row = await this.db.one(
      `update media_assets
          set status = 'ready', url = $2, thumb_url = $3,
              duration_ms = coalesce($4, duration_ms), width = coalesce($5, width), height = coalesce($6, height)
        where stream_uid = $1 returning *`,
      [uid, this.video.playbackUrl(uid), this.video.thumbnailUrl(uid), info.durationMs ?? null, info.width ?? null, info.height ?? null],
    );
    await this.publishReadyPosts();
    return row;
  }

  async markVideoFailed(uid: string) {
    await this.db.query(`update media_assets set status = 'failed' where stream_uid = $1`, [uid]);
  }

  // A post waits as "pending" until every file in it is ready, then goes live by itself.
  async publishReadyPosts() {
    await this.db.query(
      `update posts p set status = 'published'
        where p.status = 'pending'
          and exists (select 1 from post_media pm where pm.post_id = p.id)
          and not exists (select 1 from post_media pm join media_assets m on m.id = pm.media_id
                           where pm.post_id = p.id and m.status <> 'ready')`,
    );
  }

  private async setStatus(id: string, status: string) {
    return this.db.one(`update media_assets set status = $2 where id = $1 returning *`, [id, status]);
  }

  private async owned(userId: string, id: string) {
    const m = await this.db.one(`select * from media_assets where id = $1`, [id]);
    if (!m) throw new NotFoundException('Media not found');
    if (m.owner_id !== userId) throw new ForbiddenException();
    return m;
  }
}
