import { BadGatewayException, BadRequestException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ENV, Env } from '../config/env';
import { requireTrading } from '../common/gates';
import { Db } from '../db/db.service';
import { Notifications } from '../notifications/notifications.service';
import { FlutterwaveGateway, StripeGateway } from '../payments/gateways';
import { providerFor } from '../payments/currencies';

/** Coin packs. Prices are in minor units (kobo, cents). Change them here. */
export const PACKS = [
  { id: 'coins_100', coins: 100, prices: { NGN: 150_000, USD: 149 } },
  { id: 'coins_500', coins: 500, prices: { NGN: 700_000, USD: 699 } },
  { id: 'coins_1500', coins: 1500, prices: { NGN: 2_000_000, USD: 1999 } },
  { id: 'coins_5000', coins: 5000, prices: { NGN: 6_500_000, USD: 6499 } },
] as const;
type Cur = 'NGN' | 'USD';

@Injectable()
export class WalletService {
  private log = new Logger('Wallet');
  constructor(private db: Db, private stripe: StripeGateway, private flw: FlutterwaveGateway, private notes: Notifications, @Inject(ENV) private env: Env) {}

  async balance(userId: string) {
    const w = await this.db.one<{ coins: number }>(`select coins from wallets where user_id = $1`, [userId]);
    return { coins: w?.coins ?? 0 };
  }

  packs() { return PACKS.map((p) => ({ id: p.id, coins: p.coins, prices: p.prices })); }

  async startPurchase(userId: string, packId: string, currency: Cur) {
    await requireTrading(this.db, userId, 'buy');
    const pack = PACKS.find((p) => p.id === packId);
    if (!pack) throw new BadRequestException('Unknown coin pack');
    const amount = pack.prices[currency];
    const provider = providerFor(currency);
    if (provider === 'stripe' ? !this.stripe.configured : !this.flw.configured) throw new ServiceUnavailableException(`Payments in ${currency} are not switched on yet`);
    const u = await this.db.one(`select email, display_name from users where id = $1`, [userId]);
    const [row] = await this.db.query(
      `insert into coin_purchases (user_id, pack_id, coins, currency, amount_minor, provider) values ($1,$2,$3,$4,$5,$6) returning id`,
      [userId, pack.id, pack.coins, currency, amount, provider]);
    try {
      const gw = provider === 'stripe' ? this.stripe : this.flw;
      const co = await gw.createCheckout({ id: row.id, currency, totalMinor: amount, buyerEmail: u!.email, buyerName: u!.display_name, items: [{ title: `${pack.coins} BMUETTE coins`, qty: 1, unitMinor: amount }] });
      await this.db.query(`update coin_purchases set provider_ref = $2 where id = $1`, [row.id, co.providerRef]);
      return { purchaseId: row.id, coins: pack.coins, checkout: { provider: co.provider, url: co.url } };
    } catch (e) {
      await this.release(row.id, 'cancelled');
      if (e instanceof ServiceUnavailableException) throw e;
      this.log.error(`coin checkout failed: ${(e as Error).message}`);
      throw new BadGatewayException('The payment provider did not respond. Please try again.');
    }
  }

  async getPurchase(userId: string, id: string) {
    const p = await this.db.one(`select id, coins, currency, amount_minor, status, created_at, paid_at from coin_purchases where id = $1 and user_id = $2`, [id, userId]);
    if (!p) throw new NotFoundException('Purchase not found');
    return { id: p.id, packCoins: p.coins, currency: p.currency, amountMinor: Number(p.amount_minor), status: p.status, createdAt: p.created_at, paidAt: p.paid_at, ...(await this.balance(userId)) };
  }

  async history(userId: string) {
    const rows = await this.db.query(`select id, delta, kind, created_at from coin_ledger where user_id = $1 order by id desc limit 50`, [userId]);
    return { items: rows.map((r) => ({ id: Number(r.id), delta: r.delta, kind: r.kind, createdAt: r.created_at })) };
  }

  // ---- webhooks
  async byProviderRef(provider: string, ref: string) {
    return this.db.one<{ id: string }>(`select id from coin_purchases where provider = $1 and provider_ref = $2`, [provider, ref]);
  }

  async markPaid(id: string, expect: { totalMinor: number; currency: string }): Promise<boolean> {
    const done = await this.db.tx(async (tx) => {
      const p = (await tx.query(`select * from coin_purchases where id = $1 for update`, [id]))[0];
      if (!p) throw new NotFoundException('Purchase not found');
      if (p.status === 'paid') return null; // webhooks repeat
      if (Number(p.amount_minor) !== expect.totalMinor || p.currency !== expect.currency) {
        this.log.error(`Amount mismatch on coin purchase ${id}`);
        throw new BadRequestException('Amount mismatch');
      }
      await tx.query(`update coin_purchases set status = 'paid', paid_at = now() where id = $1`, [id]);
      await tx.query(`insert into wallets (user_id, coins) values ($1,$2) on conflict (user_id) do update set coins = wallets.coins + $2`, [p.user_id, p.coins]);
      await tx.query(`insert into coin_ledger (user_id, delta, kind, ref) values ($1,$2,'purchase',$3)`, [p.user_id, p.coins, id]);
      return p;
    });
    if (done) await this.notes.notify({ userId: done.user_id, type: 'system', title: 'Coins added', body: `${done.coins} coins are in your wallet.` });
    return !!done;
  }

  async release(id: string, status: 'failed' | 'cancelled') {
    await this.db.query(`update coin_purchases set status = $2 where id = $1 and status = 'pending'`, [id, status]);
  }
}
