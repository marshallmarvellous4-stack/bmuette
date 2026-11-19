import { Body, Controller, ForbiddenException, Get, HttpCode, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Put, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard, UserId } from '../common/auth.guard';
import { ZodPipe } from '../common/zod.pipe';
import { ENV, Env } from '../config/env';
import { MediaService, IMAGE_MIMES, VIDEO_MIMES, AUDIO_MIMES } from './media.service';
import { Storage } from './storage';

const create = z.object({
  kind: z.enum(['image', 'video', 'audio']),
  mime: z.string(),
  bytes: z.number().int().positive(),
  width: z.number().int().positive().max(20000).optional(),
  height: z.number().int().positive().max(20000).optional(),
});

@Controller('media')
@UseGuards(AuthGuard)
export class MediaController {
  constructor(private media: MediaService) {}

  // Step 1: ask for an upload slot. The app then sends the file straight to storage, not through this API.
  @Post('uploads')
  create(@UserId() userId: string, @Body(new ZodPipe(create)) body: z.infer<typeof create>) {
    return this.media.createUpload(userId, body);
  }

  // Step 2: tell us it finished.
  @Post(':id/complete')
  @HttpCode(200)
  complete(@UserId() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.media.complete(userId, id);
  }

  @Get(':id')
  get(@UserId() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.media.get(userId, id);
  }
}

// Development-only stand-in for a bucket, so the app works on a laptop with no cloud accounts.
@Controller('dev/upload')
@UseGuards(AuthGuard)
export class DevUploadController {
  constructor(private storage: Storage, @Inject(ENV) private env: Env) {}

  @Put(':kind/:owner/:file')
  @HttpCode(200)
  async put(@UserId() userId: string, @Param('kind') kind: string, @Param('owner') owner: string, @Param('file') file: string, @Req() req: { body: Buffer }) {
    if (this.env.NODE_ENV === 'production') throw new NotFoundException();
    if (owner !== userId) throw new ForbiddenException();
    const ext = file.split('.').pop() ?? '';
    const okExt = kind === 'image' ? Object.values(IMAGE_MIMES) : kind === 'audio' ? Object.values(AUDIO_MIMES) : Object.values(VIDEO_MIMES);
    if (!['image', 'video', 'audio'].includes(kind) || !/^[0-9a-f-]{36}\.[a-z0-9]{3,4}$/.test(file) || !okExt.includes(ext)) throw new ForbiddenException();
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new ForbiddenException('Empty upload');
    await this.storage.writeLocal(`${kind}/${owner}/${file}`, req.body);
    return { ok: true };
  }
}
