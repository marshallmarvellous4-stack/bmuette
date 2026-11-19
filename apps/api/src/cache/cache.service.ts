import { Global, Inject, Injectable, Logger, Module, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { ENV, Env } from '../config/env';

// Redis when REDIS_URL is set, otherwise a small in-memory map (fine for one server and for development).
@Injectable()
export class Cache implements OnModuleDestroy {
  private redis?: Redis;
  private mem = new Map<string, { v: string; exp: number }>();
  private log = new Logger('Cache');

  constructor(@Inject(ENV) env: Env) {
    if (env.REDIS_URL) {
      this.redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2, lazyConnect: false });
      this.redis.on('error', (e) => this.log.warn(`redis: ${e.message}`));
    }
  }

  async status(): Promise<'not configured' | 'ok' | 'down'> {
    if (!this.redis) return 'not configured';
    try { return (await this.redis.ping()) === 'PONG' ? 'ok' : 'down'; } catch { return 'down'; }
  }

  async remember<T>(key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
    try {
      const hit = this.redis ? await this.redis.get(key) : this.mem.get(key) && this.mem.get(key)!.exp > Date.now() ? this.mem.get(key)!.v : null;
      if (hit) return JSON.parse(hit) as T;
    } catch {
      // cache problems must never break a request
    }
    const value = await load();
    const raw = JSON.stringify(value);
    try {
      if (this.redis) await this.redis.set(key, raw, 'EX', ttlSeconds);
      else this.mem.set(key, { v: raw, exp: Date.now() + ttlSeconds * 1000 });
    } catch {}
    return value;
  }

  /** Tiny flags with an expiry (for example "this user is banned"). Never throws. */
  async setFlag(key: string, ttlSeconds: number) {
    try {
      if (this.redis) await this.redis.set(key, '1', 'EX', ttlSeconds);
      else this.mem.set(key, { v: '1', exp: Date.now() + ttlSeconds * 1000 });
    } catch {}
  }
  async hasFlag(key: string): Promise<boolean> {
    try {
      if (this.redis) return (await this.redis.get(key)) === '1';
      const m = this.mem.get(key);
      return !!m && m.exp > Date.now();
    } catch { return false; }
  }
  async clearFlag(key: string) {
    try { if (this.redis) await this.redis.del(key); else this.mem.delete(key); } catch {}
  }

  onModuleDestroy() {
    this.redis?.disconnect();
  }
}

@Global()
@Module({ providers: [Cache], exports: [Cache] })
export class CacheModule {}
