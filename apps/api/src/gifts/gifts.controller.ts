import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard, UserId } from '../common/auth.guard';
import { ZodPipe } from '../common/zod.pipe';
import { GiftsService } from './gifts.service';
import { WalletService } from './wallet.service';

const send = z.object({ gift: z.string().min(2).max(30), qty: z.number().int().min(1).max(99).default(1), message: z.string().trim().max(140).optional() });
const buy = z.object({ packId: z.string().min(3).max(30), currency: z.enum(['NGN', 'USD']) });

@Controller()
export class GiftsController {
  constructor(private gifts: GiftsService, private wallet: WalletService) {}

  @Get('gifts') @UseGuards(AuthGuard) catalog() { return this.gifts.catalog(); }
  @Get('wallet') @UseGuards(AuthGuard) async getWallet(@UserId() u: string) { return { ...(await this.wallet.balance(u)), packs: this.wallet.packs() }; }
  @Get('wallet/history') @UseGuards(AuthGuard) history(@UserId() u: string) { return this.wallet.history(u); }
  @Post('wallet/purchases') @UseGuards(AuthGuard) buy(@UserId() u: string, @Body(new ZodPipe(buy)) b: z.infer<typeof buy>) { return this.wallet.startPurchase(u, b.packId, b.currency); }
  @Get('wallet/purchases/:id') @UseGuards(AuthGuard) purchase(@UserId() u: string, @Param('id', ParseUUIDPipe) id: string) { return this.wallet.getPurchase(u, id); }

  @Post('posts/:id/gifts') @UseGuards(AuthGuard) @HttpCode(201)
  send(@UserId() u: string, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(send)) b: z.infer<typeof send>) { return this.gifts.send(u, id, b); }
  @Get('posts/:id/gifts') @UseGuards(AuthGuard) forPost(@Param('id', ParseUUIDPipe) id: string) { return this.gifts.forPost(id); }
  @Get('me/earnings') @UseGuards(AuthGuard) earnings(@UserId() u: string) { return this.gifts.earnings(u); }
}
