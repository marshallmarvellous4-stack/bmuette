import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { WebSocketServer } from 'ws';
import { Cache } from '../cache/cache.service';
import { ENV, Env } from '../config/env';
import { Hub } from './hub';
import { ChatService } from './chat.service';

// Live delivery at ws(s)://host/ws. The first message must be {"type":"auth","token":"<access token>"}.
// The token goes in a message, not the address, because addresses end up in logs.
@Injectable()
export class ChatGateway implements OnApplicationBootstrap, OnModuleDestroy {
  private wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  private log = new Logger('ChatGateway');
  private beat?: NodeJS.Timeout;

  constructor(private hosts: HttpAdapterHost, private hub: Hub, private jwt: JwtService, private cache: Cache, private chat: ChatService, @Inject(ENV) private env: Env) {}

  onApplicationBootstrap() {
    const server = this.hosts.httpAdapter.getHttpServer();
    server.on('upgrade', (req: any, socket: any, head: any) => {
      if ((req.url ?? '').split('?')[0] !== '/ws') return socket.destroy();
      this.wss.handleUpgrade(req, socket, head, (ws) => this.onConnect(ws));
    });
    // Phones disappear without saying goodbye; a ping every 30s clears out the dead ones.
    this.beat = setInterval(() => {
      for (const ws of this.wss.clients as Set<any>) {
        if (ws.isAlive === false) { ws.terminate(); continue; }
        ws.isAlive = false;
        ws.ping();
      }
    }, 30_000);
    this.beat.unref();
  }

  private onConnect(ws: any) {
    ws.isAlive = true;
    ws.on('pong', () => (ws.isAlive = true));
    ws.on('error', () => {});
    const timer = setTimeout(() => ws.close(4401, 'auth timeout'), 5000);
    ws.once('message', async (raw: Buffer) => {
      clearTimeout(timer);
      try {
        const m = JSON.parse(raw.toString());
        if (m?.type !== 'auth' || typeof m.token !== 'string') throw new Error('bad');
        const { sub } = await this.jwt.verifyAsync<{ sub: string }>(m.token, { secret: this.env.JWT_ACCESS_SECRET });
        if (await this.cache.hasFlag(`banned:${sub}`)) throw new Error('suspended');
        this.hub.add(sub, ws);
        ws.send(JSON.stringify({ type: 'ready' }));
        // After this the phone mostly listens. The one thing it may send is "I'm typing in this chat".
        let lastTyping = 0;
        ws.on('message', (data: Buffer) => {
          try {
            const t = JSON.parse(data.toString());
            if (t?.type !== 'typing' || typeof t.conversationId !== 'string' || !/^[0-9a-f-]{36}$/.test(t.conversationId)) return;
            const now = Date.now();
            if (now - lastTyping < 1500) return;
            lastTyping = now;
            this.chat.typing(sub, t.conversationId).catch(() => {});
          } catch {}
        });
      } catch {
        ws.close(4401, 'unauthorised');
      }
    });
  }

  onModuleDestroy() {
    if (this.beat) clearInterval(this.beat);
    this.wss.close();
  }
}
