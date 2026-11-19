import { Body, Controller, Delete, Get, HttpCode, Post, Put, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard, UserId } from '../common/auth.guard';
import { ZodPipe } from '../common/zod.pipe';
import { Notifications } from './notifications.service';

const read = z.object({ ids: z.array(z.string().uuid()).max(100).optional() });
const token = z.object({ token: z.string().min(10).max(300), platform: z.enum(['ios', 'android', 'web', 'unknown']).default('unknown') });
const prefs = z.object({ likes: z.boolean(), comments: z.boolean(), follows: z.boolean(), messages: z.boolean(), orders: z.boolean() }).partial();

@Controller()
@UseGuards(AuthGuard)
export class NotificationsController {
  constructor(private n: Notifications) {}

  @Get('notifications') list(@UserId() uid: string, @Query('cursor') c?: string, @Query('limit') l?: string) { return this.n.list(uid, c, l); }
  @Get('notifications/unread-count') unread(@UserId() uid: string) { return this.n.unreadCount(uid); }
  @Post('notifications/read') @HttpCode(200) read(@UserId() uid: string, @Body(new ZodPipe(read)) b: z.infer<typeof read>) { return this.n.markRead(uid, b.ids); }
  @Get('me/notification-settings') getPrefs(@UserId() uid: string) { return this.n.getPrefs(uid); }
  @Put('me/notification-settings') setPrefs(@UserId() uid: string, @Body(new ZodPipe(prefs)) b: z.infer<typeof prefs>) { return this.n.setPrefs(uid, b); }
  @Post('push/register') @HttpCode(200) reg(@UserId() uid: string, @Body(new ZodPipe(token)) b: z.infer<typeof token>) { return this.n.registerToken(uid, b.token, b.platform); }
  @Post('push/unregister') @HttpCode(200) unreg(@UserId() uid: string, @Body(new ZodPipe(z.object({ token: z.string() }))) b: { token: string }) { return this.n.removeToken(uid, b.token); }
}
