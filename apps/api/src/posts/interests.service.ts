import { Injectable } from '@nestjs/common';
import { Db } from '../db/db.service';

// Turns behaviour into a per-person tag profile. This is the "collect signals" stage of the recommender.
@Injectable()
export class InterestService {
  constructor(private db: Db) {}

  async bump(userId: string | undefined, tags: string[], delta: number) {
    if (!userId || tags.length === 0 || delta === 0) return;
    // Old weight fades slightly each time, so interests follow what you watch now, not a year ago.
    await this.db.query(
      `insert into user_interests (user_id, tag, weight)
       select $1, t, greatest($3::real, 0) from unnest($2::text[]) as t
       on conflict (user_id, tag) do update
         set weight = greatest(least(user_interests.weight * 0.98 + $3::real, 20), 0), updated_at = now()`,
      [userId, tags.slice(0, 10), delta],
    );
  }

  async top(userId: string, n = 30): Promise<Map<string, number>> {
    const rows = await this.db.query(`select tag, weight from user_interests where user_id = $1 order by weight desc limit ${n}`, [userId]);
    return new Map(rows.map((r) => [r.tag as string, r.weight as number]));
  }
}
