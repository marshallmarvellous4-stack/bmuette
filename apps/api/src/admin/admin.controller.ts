import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { UserId } from '../common/auth.guard';
import { ZodPipe } from '../common/zod.pipe';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';
import { ModerationService, REPORT_ACTIONS } from './moderation.service';

const resolve = z.object({ action: z.enum(REPORT_ACTIONS), note: z.string().trim().max(300).optional() });
const ban = z.object({ reason: z.string().trim().min(3).max(300) });
const postStatus = z.object({ status: z.enum(['published', 'held', 'removed']) });

// Everything under /admin/api is admin-only. Reads are plain GETs; the few actions (moderation, bans) are POSTs and are all
// written to admin_actions. main.ts marks all of /admin as never cached.
@Controller('admin/api')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(private admin: AdminService, private mod: ModerationService) {}

  @Get('overview') overview(@Query('days') days?: string, @Query('tz') tz?: string) { return this.admin.overview(days, tz); }
  @Get('people') people(@Query('q') q?: string, @Query('cursor') cursor?: string, @Query('limit') limit?: string) { return this.admin.people(q, cursor, limit); }
  @Get('orders') orders(@Query('status') status?: string, @Query('cursor') cursor?: string, @Query('limit') limit?: string) { return this.admin.orders(status, cursor, limit); }
  @Get('payment-events') events(@Query('limit') limit?: string) { return this.admin.paymentEvents(limit); }
  @Get('activity') activity(@Query('kinds') kinds?: string, @Query('before') before?: string, @Query('limit') limit?: string) { return this.admin.activity(kinds, before, limit); }
  @Get('errors') errors(@Query('limit') limit?: string) { return this.admin.errors(limit); }
  @Get('system') system() { return this.admin.system(); }

  // ---- moderation
  @Get('reports') reports(@Query('status') status?: string, @Query('cursor') cursor?: string, @Query('limit') limit?: string) { return this.mod.reports(status, cursor, limit); }
  @Post('reports/:id/resolve') @HttpCode(200)
  resolve(@UserId() admin: string, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(resolve)) b: z.infer<typeof resolve>) { return this.mod.resolve(admin, id, b.action, b.note); }
  @Post('users/:id/ban') @HttpCode(200)
  ban(@UserId() admin: string, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ban)) b: z.infer<typeof ban>) { return this.mod.ban(admin, id, b.reason); }
  @Post('users/:id/unban') @HttpCode(200)
  unban(@UserId() admin: string, @Param('id', ParseUUIDPipe) id: string) { return this.mod.unban(admin, id); }
  @Post('posts/:id/status') @HttpCode(200)
  postStatus(@UserId() admin: string, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(postStatus)) b: z.infer<typeof postStatus>) { return this.mod.setPostStatus(admin, id, b.status); }
  @Get('audit') audit(@Query('limit') limit?: string) { return this.mod.audits(limit); }
  @Get('emails') emails(@Query('limit') limit?: string) { return this.mod.emails(limit); }
}
