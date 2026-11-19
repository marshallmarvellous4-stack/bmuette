import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import type { WebSocket } from 'ws';
import { ENV, Env } from '../config/env';

const CHANNEL = 'bmuette:chat';

// Keeps track of who is connected on THIS server and pushes events to them.
// With REDIS_URL set, every server hears every event, so chat works across several servers.
@Injectable()
export class Hub implements OnModuleDestroy {
  private sockets = new Map<string, Set<WebSocket>>();
  private pub?: Redis;
  private sub?: Redis;
  private log = new Logger('ChatHub');

  constructor(@Inject(ENV) env: Env) {
    if (env.REDIS_URL) {
      this.pub = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2 });
      this.sub = new Redis(env.REDIS_URL);
      this.pub.on('error', (e) => this.log.warn(`redis pub: ${e.message}`));
      this.sub.on('error', (e) => this.log.warn(`redis sub: ${e.message}`));
      this.sub.subscribe(CHANNEL).catch((e) => this.log.warn(`subscribe: ${e.message}`));
      this.sub.on('message', (_c, raw) => {
        try { const m = JSON.parse(raw); this.deliver(m.userIds, m.event); } catch {}
      });
    }
  }

  /** People and connections on this server right now. */
  stats() {
    let sockets = 0;
    for (const set of this.sockets.values()) sockets += set.size;
    return { users: this.sockets.size, sockets };
  }

  add(userId: string, ws: WebSocket) {
    let set = this.sockets.get(userId);
    if (!set) this.sockets.set(userId, (set = new Set()));
    set.add(ws);
    ws.on('close', () => {
      set!.delete(ws);
      if (set!.size === 0) this.sockets.delete(userId);
    });
  }

  /** Disconnect everything a user has open on this server (used when an account is suspended). */
  kick(userId: string) {
    for (const ws of this.sockets.get(userId) ?? []) ws.close(4403, 'suspended');
  }

  /** Is this person connected on this server right now? */
  isOnline(userId: string) {
    return (this.sockets.get(userId)?.size ?? 0) > 0;
  }

  /** Tell these people about something. Never throws: a failed push must not fail a send. */
  async emit(userIds: string[], event: unknown) {
    if (this.pub) {
      try { await this.pub.publish(CHANNEL, JSON.stringify({ userIds, event })); return; } catch {}
    }
    this.deliver(userIds, event);
  }

  private deliver(userIds: string[], event: unknown) {
    const text = JSON.stringify(event);
    for (const id of userIds) for (const ws of this.sockets.get(id) ?? []) if (ws.readyState === ws.OPEN) ws.send(text);
  }

  onModuleDestroy() {
    this.pub?.disconnect();
    this.sub?.disconnect();
    for (const set of this.sockets.values()) for (const ws of set) ws.close();
  }
}
