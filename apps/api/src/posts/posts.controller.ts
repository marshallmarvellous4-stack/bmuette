import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard, MaybeUserId, OptionalAuthGuard, UserId } from '../common/auth.guard';
import { ZodPipe } from '../common/zod.pipe';
import { InteractionsService } from './interactions.service';
import { CTA_KINDS, PostsService } from './posts.service';

const createPost = z.object({
  kind: z.enum(['video', 'photo']),
  caption: z.string().max(2200).default(''),
  tags: z.array(z.string().min(1).max(30)).max(15).default([]),
  mediaIds: z.array(z.string().uuid()).min(1).max(10),
  cta: z.object({ kind: z.enum(CTA_KINDS), productId: z.string().uuid().optional(), label: z.string().max(30).optional() }).optional(),
  allowDownload: z.boolean().default(false),
  products: z.array(z.object({ productId: z.string().uuid(), atMs: z.number().int().min(0).max(3_600_000).nullish() })).max(6).optional(),
  soundId: z.string().uuid().optional(),
  soundVolume: z.number().int().min(0).max(100).optional(),
  originalVolume: z.number().int().min(0).max(100).optional(),
  edit: z.object({
    trimStartMs: z.number().int().min(0).max(3_600_000).optional(),
    trimEndMs: z.number().int().min(0).max(3_600_000).optional(),
    filter: z.enum(['none', 'warm', 'cool', 'mono', 'vivid', 'fade', 'noir']).default('none'),
    texts: z.array(z.object({ text: z.string().trim().min(1).max(80), x: z.number().min(0).max(1), y: z.number().min(0).max(1), color: z.string().regex(/^#[0-9a-fA-F]{6}$/), size: z.number().int().min(12).max(64) })).max(8).default([]),
  }).refine((e) => e.trimStartMs === undefined || e.trimEndMs === undefined || e.trimEndMs - e.trimStartMs >= 1000, 'Keep at least one second').optional(),
});
const tagBody = z.object({ products: z.array(z.object({ productId: z.string().uuid(), atMs: z.number().int().min(0).max(3_600_000).nullish() })).max(6) });
const commentBody = z.object({ body: z.string().trim().min(1).max(1000), parentId: z.string().uuid().optional() });
const saveBody = z.object({ collectionId: z.string().uuid().optional() }).default({});
const viewBody = z.object({ watchMs: z.number().int().min(0).max(36_000_000), completion: z.number().min(0).max(1), replays: z.number().int().min(0).max(100).default(0) });
const reportBody = z.object({
  postId: z.string().uuid().optional(), productId: z.string().uuid().optional(), userId: z.string().uuid().optional(), commentId: z.string().uuid().optional(),
  details: z.string().trim().max(500).optional(),
  reason: z.enum(['spam', 'nudity', 'violence', 'harassment', 'scam', 'counterfeit', 'copyright', 'child_safety', 'other']),
}).refine((r) => [r.postId, r.productId, r.userId, r.commentId].filter(Boolean).length === 1, 'Report exactly one of postId, productId, userId, commentId');

@Controller()
export class PostsController {
  constructor(private posts: PostsService, private inter: InteractionsService) {}

  @Post('posts') @UseGuards(AuthGuard)
  create(@UserId() id: string, @Body(new ZodPipe(createPost)) body: z.infer<typeof createPost>) { return this.posts.create(id, body); }

  @Get('posts/:id') @UseGuards(OptionalAuthGuard)
  get(@Param('id', ParseUUIDPipe) id: string, @MaybeUserId() viewer?: string) { return this.posts.get(id, viewer); }

  @Delete('posts/:id') @UseGuards(AuthGuard) @HttpCode(204)
  async remove(@UserId() uid: string, @Param('id', ParseUUIDPipe) id: string) { await this.posts.remove(uid, id); }

  @Get('users/:username/posts') @UseGuards(OptionalAuthGuard)
  byUser(@Param('username') u: string, @MaybeUserId() viewer?: string, @Query('cursor') c?: string, @Query('limit') l?: string) {
    return this.posts.byUser(u, viewer, c, l);
  }

  @Put('posts/:id/products') @UseGuards(AuthGuard)
  tag(@UserId() uid: string, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(tagBody)) b: z.infer<typeof tagBody>) { return this.posts.setProducts(uid, id, b.products); }

  @Post('posts/:id/like') @UseGuards(AuthGuard) @HttpCode(200)
  like(@UserId() uid: string, @Param('id', ParseUUIDPipe) id: string) { return this.inter.like(uid, id); }

  @Delete('posts/:id/like') @UseGuards(AuthGuard)
  unlike(@UserId() uid: string, @Param('id', ParseUUIDPipe) id: string) { return this.inter.unlike(uid, id); }

  @Post('posts/:id/save') @UseGuards(AuthGuard) @HttpCode(200)
  save(@UserId() uid: string, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(saveBody)) b: z.infer<typeof saveBody>) { return this.inter.save(uid, id, b.collectionId); }

  @Delete('posts/:id/save') @UseGuards(AuthGuard)
  unsave(@UserId() uid: string, @Param('id', ParseUUIDPipe) id: string) { return this.inter.unsave(uid, id); }

  @Get('posts/:id/comments')
  comments(@Param('id', ParseUUIDPipe) id: string, @Query('cursor') c?: string, @Query('limit') l?: string) { return this.inter.listComments(id, c, l); }

  @Post('posts/:id/comments') @UseGuards(AuthGuard)
  comment(@UserId() uid: string, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(commentBody)) b: z.infer<typeof commentBody>) {
    return this.inter.comment(uid, id, b.body, b.parentId);
  }

  @Delete('comments/:id') @UseGuards(AuthGuard) @HttpCode(204)
  async deleteComment(@UserId() uid: string, @Param('id', ParseUUIDPipe) id: string) { await this.inter.deleteComment(uid, id); }

  @Post('posts/:id/view') @UseGuards(OptionalAuthGuard) @HttpCode(200)
  view(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(viewBody)) b: z.infer<typeof viewBody>, @MaybeUserId() uid?: string) { return this.inter.view(uid, id, b); }

  @Post('posts/:id/share') @HttpCode(200)
  share(@Param('id', ParseUUIDPipe) id: string) { return this.inter.share(id); }

  @Post('posts/:id/download') @UseGuards(AuthGuard) @HttpCode(200)
  download(@UserId() uid: string, @Param('id', ParseUUIDPipe) id: string) { return this.posts.downloadLink(uid, id); }

  @Post('reports') @UseGuards(AuthGuard) @HttpCode(201)
  report(@UserId() uid: string, @Body(new ZodPipe(reportBody)) b: z.infer<typeof reportBody>) { return this.inter.report(uid, b); }
}
