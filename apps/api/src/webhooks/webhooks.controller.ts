import { BadRequestException, Controller, Get, Headers, HttpCode, Logger, Post, Query, RawBodyRequest, Req, Res, ServiceUnavailableException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Inject } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ENV, Env } from '../config/env';
import { Db } from '../db/db.service';
import { MediaService } from '../media/media.service';
import { VideoProvider } from '../media/video';
import { FlutterwaveGateway, StripeGateway } from '../payments/gateways';
import { OrdersService } from '../orders/orders.service';
import { WalletService } from '../gifts/wallet.service';

// Providers call these URLs, not the app. Every one proves who it is before we act on it.
@Controller()
@SkipThrottle()
export class WebhooksController {
  private log = new Logger('Webhooks');
  constructor(
    private db: Db, private orders: OrdersService, private stripe: StripeGateway, private flw: FlutterwaveGateway,
    private media: MediaService, private video: VideoProvider, @Inject(ENV) private env: Env, private wallet: WalletService,
  ) {}

  private async audit(provider: string, eventId: string, payload: unknown) {
    await this.db.query(`insert into payment_events (provider, event_id, payload) values ($1,$2,$3) on conflict do nothing`, [provider, eventId, JSON.stringify(payload)]);
  }

  @Post('webhooks/stripe') @HttpCode(200)
  async stripeHook(@Req() req: RawBodyRequest<Request>, @Headers('stripe-signature') sig?: string) {
    let event;
    try {
      event = this.stripe.parseWebhook(req.rawBody ?? Buffer.alloc(0), sig);
    } catch (e: any) {
      this.log.warn(`rejected Stripe webhook: ${e.message}`);
      throw new BadRequestException('Invalid signature');
    }
    // Handlers are safe to run twice, so a retried delivery cannot double-charge or double-count.
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      const s = event.data.object;
      if (s.payment_status === 'paid') {
        const order = await this.orders.byProviderRef('stripe', s.id);
        const coins = order ? null : await this.wallet.byProviderRef('stripe', s.id);
        if (coins) await this.wallet.markPaid(coins.id, { totalMinor: s.amount_total ?? -1, currency: (s.currency ?? '').toUpperCase() });
        else if (!order) this.log.warn(`Stripe session ${s.id} matches no order`);
        else await this.orders.markPaid(order.id, { totalMinor: s.amount_total ?? -1, currency: (s.currency ?? '').toUpperCase() });
      }
    } else if (event.type === 'checkout.session.expired' || event.type === 'checkout.session.async_payment_failed') {
      const status = event.type.endsWith('expired') ? 'cancelled' : 'failed';
      const order = await this.orders.byProviderRef('stripe', event.data.object.id);
      if (order) await this.orders.release(order.id, status);
      else { const c = await this.wallet.byProviderRef('stripe', event.data.object.id); if (c) await this.wallet.release(c.id, status); }
    }
    await this.audit('stripe', event.id, event);
    return { received: true };
  }

  @Post('webhooks/flutterwave') @HttpCode(200)
  async flutterwaveHook(@Req() req: Request, @Headers('verif-hash') hash?: string) {
    if (!this.flw.isValidWebhook(hash)) throw new BadRequestException('Invalid signature');
    const body: any = req.body;
    if (body?.event === 'charge.completed' && body.data?.id) {
      // Ask Flutterwave directly rather than trusting what the webhook says happened.
      const tx = await this.flw.verify(body.data.id);
      if (!tx) throw new ServiceUnavailableException('Could not verify the transaction yet'); // makes Flutterwave retry
      const order = await this.orders.byProviderRef('flutterwave', tx.txRef);
      const coins = order ? null : await this.wallet.byProviderRef('flutterwave', tx.txRef);
      if (coins) {
        if (tx.status === 'successful') await this.wallet.markPaid(coins.id, { totalMinor: Math.round(tx.amount * 100), currency: tx.currency });
        else if (tx.status === 'failed') await this.wallet.release(coins.id, 'failed');
      } else if (!order) this.log.warn(`Flutterwave tx ${tx.txRef} matches no order`);
      else if (tx.status === 'successful') await this.orders.markPaid(order.id, { totalMinor: Math.round(tx.amount * 100), currency: tx.currency });
      else if (tx.status === 'failed') await this.orders.release(order.id, 'failed');
      await this.audit('flutterwave', `charge.completed:${body.data.id}`, body);
    }
    return { received: true };
  }

  @Post('webhooks/stream') @HttpCode(200)
  async streamHook(@Req() req: RawBodyRequest<Request>, @Headers('webhook-signature') sig?: string) {
    if (!this.video.verifyWebhook(req.rawBody ?? Buffer.alloc(0), sig)) throw new BadRequestException('Invalid signature');
    const v: any = req.body;
    if (v?.uid) {
      if (v.readyToStream) await this.media.markVideoReady(v.uid, this.video.fromVideoObject(v));
      else if (v.status?.state === 'error') await this.media.markVideoFailed(v.uid);
    }
    return { received: true };
  }

  // The payment page sends the buyer back here, and we hand them on to the app.
  @Get('checkout/return')
  back(@Query() q: Record<string, string>, @Res() res: Response) {
    const params = new URLSearchParams();
    for (const k of ['order', 'status', 'tx_ref', 'transaction_id']) if (typeof q[k] === 'string') params.set(k, q[k].slice(0, 100));
    const target = this.env.CHECKOUT_RETURN_URL;
    res.redirect(302, `${target}${target.includes('?') ? '&' : '?'}${params}`);
  }
}
