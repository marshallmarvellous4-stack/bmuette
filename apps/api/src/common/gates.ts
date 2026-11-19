import { ForbiddenException } from '@nestjs/common';
import type { Db } from '../db/db.service';

/** Buying and selling need a confirmed email address and an adult account. */
export async function requireTrading(db: Db, userId: string, what: 'buy' | 'sell') {
  const u = await db.one(`select email_verified_at, is_adult, banned_at from users where id = $1 and deleted_at is null`, [userId]);
  if (!u || u.banned_at) throw new ForbiddenException('This account cannot do that');
  if (!u.email_verified_at) throw new ForbiddenException({ message: `Verify your email before you ${what === 'sell' ? 'open a shop' : 'check out'}`, code: 'EMAIL_NOT_VERIFIED' });
  if (!u.is_adult) throw new ForbiddenException({ message: `You must be 18 or over to ${what === 'sell' ? 'sell' : 'buy'} on BMUETTE`, code: 'ADULT_ONLY' });
}
