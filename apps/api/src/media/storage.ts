import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable } from '@nestjs/common';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { ENV, Env } from '../config/env';

export type PresignedUpload = { uploadUrl: string; method: 'PUT' | 'POST'; headers: Record<string, string>; formField?: string };

export const LOCAL_DIR = resolve(process.cwd(), '.uploads');

// One interface for both drivers, so the rest of the app never cares where files live.
@Injectable()
export class Storage {
  private s3?: S3Client;
  constructor(@Inject(ENV) private env: Env) {
    if (env.STORAGE_DRIVER === 's3') {
      if (!env.S3_BUCKET || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY || !env.S3_PUBLIC_BASE_URL) {
        throw new Error('STORAGE_DRIVER=s3 needs S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY and S3_PUBLIC_BASE_URL');
      }
      this.s3 = new S3Client({
        region: env.S3_REGION,
        endpoint: env.S3_ENDPOINT,
        forcePathStyle: !!env.S3_ENDPOINT,
        credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
      });
    }
  }

  async presignPut(key: string, mime: string): Promise<PresignedUpload> {
    if (this.s3) {
      const url = await getSignedUrl(this.s3, new PutObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key, ContentType: mime }), { expiresIn: 900 });
      return { uploadUrl: url, method: 'PUT', headers: { 'Content-Type': mime } };
    }
    return { uploadUrl: `${this.env.PUBLIC_BASE_URL}/dev/upload/${key}`, method: 'PUT', headers: { 'Content-Type': mime } };
  }

  /** Returns the stored size, or null when the object does not exist. */
  async head(key: string): Promise<number | null> {
    if (this.s3) {
      try {
        const r = await this.s3.send(new HeadObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key }));
        return Number(r.ContentLength ?? 0);
      } catch {
        return null;
      }
    }
    try {
      return (await stat(join(LOCAL_DIR, key))).size;
    } catch {
      return null;
    }
  }

  publicUrl(key: string): string {
    return this.s3 ? `${this.env.S3_PUBLIC_BASE_URL!.replace(/\/$/, '')}/${key}` : `${this.env.PUBLIC_BASE_URL}/files/${key}`;
  }

  async writeLocal(key: string, data: Buffer) {
    const target = join(LOCAL_DIR, key);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, data);
  }

  /** Short-lived link to download the original file (for "save to phone"). */
  async downloadUrl(key: string): Promise<string> {
    if (this.s3) return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key }), { expiresIn: 300 });
    return this.publicUrl(key);
  }
}
