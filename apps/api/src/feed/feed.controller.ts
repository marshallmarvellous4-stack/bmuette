import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard, MaybeUserId, OptionalAuthGuard, UserId } from '../common/auth.guard';
import { FeedService } from './feed.service';

@Controller('feed')
export class FeedController {
  constructor(private feed: FeedService) {}

  // Personalised for signed-in users, trending for everyone else. Each call returns the next unseen batch.
  @Get() @UseGuards(OptionalAuthGuard)
  forYou(@MaybeUserId() userId?: string, @Query('limit') limit?: string) { return this.feed.forYou(userId, limit); }

  @Get('following') @UseGuards(AuthGuard)
  following(@UserId() userId: string, @Query('cursor') cursor?: string, @Query('limit') limit?: string) { return this.feed.following(userId, cursor, limit); }
}
