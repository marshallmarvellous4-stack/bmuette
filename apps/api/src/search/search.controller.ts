import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard, MaybeUserId, OptionalAuthGuard, UserId } from '../common/auth.guard';
import { clampLimit } from '../common/cursor';
import { ZodPipe } from '../common/zod.pipe';
import { SearchService } from './search.service';

const visual = z.object({ mediaId: z.string().uuid() });

@Controller('search')
export class SearchController {
  constructor(private search: SearchService) {}

  @Get() @UseGuards(OptionalAuthGuard)
  find(@Query('q') q = '', @Query('type') type = 'all', @Query('limit') limit?: string, @MaybeUserId() uid?: string) {
    const t = (['all', 'posts', 'products', 'users'] as const).find((x) => x === type) ?? 'all';
    return this.search.search(uid, q, t, clampLimit(limit, 12, 30));
  }

  @Get('suggest')
  suggest(@Query('q') q = '') { return this.search.suggest(q); }

  @Post('visual') @UseGuards(AuthGuard) @HttpCode(200)
  visual(@UserId() uid: string, @Body(new ZodPipe(visual)) b: z.infer<typeof visual>, @Query('limit') limit?: string) {
    return this.search.visual(uid, b.mediaId, clampLimit(limit, 12, 30));
  }
}
