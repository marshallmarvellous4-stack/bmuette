import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import Stripe from 'stripe';
import { ENV, Env } from '../config/env';

export type CheckoutOrder = {
  id: string; currency: string; totalMinor: number; buyerEmail: string; buyerName: string;
  items: { title: string; qty: number; unitMinor: number }[];
  /** Already taken off totalMinor. Stripe needs it shown as a coupon so the line items still add up. */
  discountMinor?: number;
};
export type Checkout = { provider: 'stripe' | 'flutterwave'; url: string; providerRef: string };

@Injectable()
export class StripeGateway {
  private client?: Stripe;
  constructor(@Inject(ENV) private env: Env) {
    if (env.STRIPE_SECRET_KEY) this.client = new Stripe(env.STRIPE_SECRET_KEY);
  }
  get configured() { return !!this.client; }

  async createCheckout(o: CheckoutOrder): Promise<Checkout> {
    if (!this.client) throw new ServiceUnavailableException('Card payments in this currency are not switched on yet');
    const back = (status: string) => `${this.env.PUBLIC_BASE_URL}/checkout/return?order=${o.id}&status=${status}`;
    const session = await this.client.checkout.sessions.create({
      mode: 'payment',
      client_reference_id: o.id,
      customer_email: o.buyerEmail,
      metadata: { order_id: o.id },
      line_items: o.items.map((i) => ({
        quantity: i.qty,
        price_data: { currency: o.currency.toLowerCase(), unit_amount: i.unitMinor, product_data: { name: i.title } },
      })),
      ...(o.discountMinor ? { discounts: [{ coupon: (await this.client.coupons.create({ amount_off: o.discountMinor, currency: o.currency.toLowerCase(), duration: 'once', name: 'Discount code' })).id }] } : {}),
      success_url: back('success'),
      cancel_url: back('cancelled'),
      expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
    });
    if (!session.url) throw new ServiceUnavailableException('Could not start checkout');
    return { provider: 'stripe', url: session.url, providerRef: session.id };
  }

  /** Give money back. The amount is in minor units. */
  async refund(sessionId: string, amountMinor: number): Promise<void> {
    if (!this.client) throw new ServiceUnavailableException('Card payments are not switched on');
    const session = await this.client.checkout.sessions.retrieve(sessionId);
    const pi = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
    if (!pi) throw new Error('No payment found for this order');
    await this.client.refunds.create({ payment_intent: pi, amount: amountMinor });
  }

  /** Throws when the signature does not match, so forged webhooks are rejected. */
  parseWebhook(rawBody: Buffer, signature: string | undefined): Stripe.Event {
    if (!this.client || !this.env.STRIPE_WEBHOOK_SECRET || !signature) throw new Error('Stripe webhook is not configured');
    return this.client.webhooks.constructEvent(rawBody, signature, this.env.STRIPE_WEBHOOK_SECRET);
  }
}

@Injectable()
export class FlutterwaveGateway {
  private log = new Logger('Flutterwave');
  constructor(@Inject(ENV) private env: Env) {}
  get configured() { return !!this.env.FLW_SECRET_KEY; }

  private headers() {
    return { Authorization: `Bearer ${this.env.FLW_SECRET_KEY}`, 'Content-Type': 'application/json' };
  }

  async createCheckout(o: CheckoutOrder): Promise<Checkout> {
    if (!this.configured) throw new ServiceUnavailableException('Local payments are not switched on yet');
    const txRef = `bmuette-${o.id}`;
    const res = await fetch(`${this.env.FLW_BASE_URL}/v3/payments`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        tx_ref: txRef,
        amount: o.totalMinor / 100,
        currency: o.currency,
        redirect_url: `${this.env.PUBLIC_BASE_URL}/checkout/return?order=${o.id}`,
        customer: { email: o.buyerEmail, name: o.buyerName },
        customizations: { title: 'BMUETTE', description: `Order ${o.id.slice(0, 8)}` },
        meta: { order_id: o.id },
      }),
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok || body.status !== 'success' || !body.data?.link) {
      this.log.error(`create payment failed: ${res.status} ${JSON.stringify(body)}`);
      throw new ServiceUnavailableException('Could not start checkout');
    }
    return { provider: 'flutterwave', url: body.data.link, providerRef: txRef };
  }

  async refund(txRef: string, amountMinor: number): Promise<void> {
    const found = await fetch(`${this.env.FLW_BASE_URL}/v3/transactions/verify_by_reference?tx_ref=${encodeURIComponent(txRef)}`, { headers: this.headers() });
    const fb: any = await found.json().catch(() => ({}));
    const id = fb?.data?.id;
    if (!found.ok || !id) throw new Error('Could not find the payment to refund');
    const res = await fetch(`${this.env.FLW_BASE_URL}/v3/transactions/${id}/refund`, { method: 'POST', headers: this.headers(), body: JSON.stringify({ amount: amountMinor / 100 }) });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok || body.status !== 'success') throw new Error(`Flutterwave refused the refund: ${body.message ?? res.status}`);
  }

  isValidWebhook(header: string | undefined): boolean {
    return !!this.env.FLW_WEBHOOK_HASH && header === this.env.FLW_WEBHOOK_HASH;
  }

  /** Never trust the webhook body alone: ask Flutterwave directly what happened to this transaction. */
  async verify(transactionId: string | number): Promise<{ status: string; txRef: string; amount: number; currency: string } | null> {
    const res = await fetch(`${this.env.FLW_BASE_URL}/v3/transactions/${encodeURIComponent(String(transactionId))}/verify`, { headers: this.headers() });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok || body.status !== 'success' || !body.data) return null;
    return { status: body.data.status, txRef: body.data.tx_ref, amount: Number(body.data.amount), currency: body.data.currency };
  }
}
