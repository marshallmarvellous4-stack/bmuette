import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard, MaybeUserId, OptionalAuthGuard, UserId } from '../common/auth.guard';
import { ZodPipe } from '../common/zod.pipe';
import { UsersService } from './users.service';

const del = z.object({ password: z.string().min(1).max(128) });
const update = z.object({
  displayName: z.string().trim().min(1).max(60).optional(),
  bio: z.string().max(300).optional(),
  country: z.string().length(2).optional(),
  avatarMediaId: z.string().uuid().nullable().optional(),
});

@Controller()
export class UsersController {
  constructor(private users: UsersService) {}

  @Get('me') @UseGuards(AuthGuard)
  me(@UserId() id: string) { return this.users.me(id); }

  @Patch('me') @UseGuards(AuthGuard)
  update(@UserId() id: string, @Body(new ZodPipe(update)) body: z.infer<typeof update>) { return this.users.updateMe(id, body); }

  // Deleting an account needs the password again, so a stolen phone cannot wipe it.
  @Post('me/delete') @UseGuards(AuthGuard) @HttpCode(204)
  async remove(@UserId() id: string, @Body(new ZodPipe(del)) b: z.infer<typeof del>) { await this.users.deleteMe(id, b.password); }

  @Get('me/blocked') @UseGuards(AuthGuard)
  blocked(@UserId() id: string) { return this.users.blockedList(id); }

  @Get('users/:username') @UseGuards(OptionalAuthGuard)
  profile(@Param('username') u: string, @MaybeUserId() viewer?: string) { return this.users.profile(u, viewer); }

  @Post('users/:username/follow') @UseGuards(AuthGuard) @HttpCode(200)
  follow(@UserId() id: string, @Param('username') u: string) { return this.users.follow(id, u); }

  @Delete('users/:username/follow') @UseGuards(AuthGuard)
  unfollow(@UserId() id: string, @Param('username') u: string) { return this.users.unfollow(id, u); }

  @Post('users/:username/block') @UseGuards(AuthGuard) @HttpCode(200)
  block(@UserId() id: string, @Param('username') u: string) { return this.users.block(id, u); }

  @Delete('users/:username/block') @UseGuards(AuthGuard)
  unblock(@UserId() id: string, @Param('username') u: string) { return this.users.unblock(id, u); }

  @Get('users/:username/followers')
  followers(@Param('username') u: string, @Query('cursor') c?: string, @Query('limit') l?: string) { return this.users.list('followers', u, c, l); }

  @Get('users/:username/following')
  following(@Param('username') u: string, @Query('cursor') c?: string, @Query('limit') l?: string) { return this.users.list('following', u, c, l); }
}
