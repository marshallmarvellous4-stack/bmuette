import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard, UserId } from '../common/auth.guard';
import { ZodPipe } from '../common/zod.pipe';
import { ChatService } from './chat.service';

const open = z.object({ userId: z.string().uuid() });
const clientId = z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/);
const send = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), body: z.string().trim().min(1).max(4000), clientId }),
  z.object({ kind: z.literal('voice'), mediaId: z.string().uuid(), durationMs: z.number().int().min(500).max(5 * 60_000), clientId }),
  z.object({ kind: z.literal('image'), mediaId: z.string().uuid(), body: z.string().trim().max(1000).optional(), clientId }),
  z.object({ kind: z.enum(['post', 'product']), refId: z.string().uuid(), body: z.string().trim().max(1000).optional(), clientId }),
]);

@Controller()
@UseGuards(AuthGuard)
export class ChatController {
  constructor(private chat: ChatService) {}

  @Post('conversations')
  @HttpCode(200)
  open(@UserId() uid: string, @Body(new ZodPipe(open)) b: z.infer<typeof open>) { return this.chat.openWith(uid, b.userId); }

  @Get('conversations')
  list(@UserId() uid: string) { return this.chat.list(uid); }

  @Get('conversations/unread')
  unread(@UserId() uid: string) { return this.chat.unreadTotal(uid); }

  @Get('conversations/:id')
  one(@UserId() uid: string, @Param('id', ParseUUIDPipe) id: string) { return this.chat.get(uid, id); }

  @Get('conversations/:id/messages')
  messages(@UserId() uid: string, @Param('id', ParseUUIDPipe) id: string, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    return this.chat.messages(uid, id, cursor, limit);
  }

  @Post('conversations/:id/messages')
  send(@UserId() uid: string, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(send)) b: z.infer<typeof send>) {
    return this.chat.send(uid, id, b);
  }

  @Post('conversations/:id/read')
  @HttpCode(200)
  read(@UserId() uid: string, @Param('id', ParseUUIDPipe) id: string) { return this.chat.markRead(uid, id); }
}
