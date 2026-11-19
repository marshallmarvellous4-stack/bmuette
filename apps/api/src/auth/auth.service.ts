import { BadRequestException, ConflictException, ForbiddenException, HttpException, Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomInt, randomUUID, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { ENV, Env } from '../config/env';
import { Db } from '../db/db.service';
import { Mailer } from '../mail/mail.service';
import { TERMS_VERSION } from '../legal/legal.pages';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length);
  return timingSafeEqual(expected, actual);
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
// A real hash, so unknown emails cost the same time as wrong passwords.
const DUMMY_HASH = 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(64).toString('base64');

/** Whole years between a YYYY-MM-DD birth date and today. Only used at sign-up; the date itself is never stored. */
export function ageOn(birthDate: string, today = new Date()): number {
  const [y, m, d] = birthDate.split('-').map(Number);
  let age = today.getUTCFullYear() - y;
  if (today.getUTCMonth() + 1 < m || (today.getUTCMonth() + 1 === m && today.getUTCDate() < d)) age--;
  return age;
}

export type PublicUser = {
  id: string; username: string; displayName: string; bio: string; avatarUrl: string | null;
  country: string | null; isMerchant: boolean; followerCount: number; followingCount: number;
};

export function toPublicUser(r: any): PublicUser {
  return {
    id: r.id, username: r.username, displayName: r.display_name, bio: r.bio, avatarUrl: r.avatar_url,
    country: r.country, isMerchant: r.is_merchant, followerCount: r.follower_count, followingCount: r.following_count,
  };
}

@Injectable()
export class AuthService {
  private log = new Logger('Auth');
  constructor(private db: Db, private jwt: JwtService, private mail: Mailer, @Inject(ENV) private env: Env) {}

  async register(input: { email: string; password: string; username: string; displayName: string; country?: string; birthDate: string; acceptTerms: true }) {
    const age = ageOn(input.birthDate);
    if (!(age >= 0 && age < 120)) throw new BadRequestException('Enter a real birth date');
    if (age < this.env.MIN_AGE) throw new ForbiddenException(`BMUETTE is for people ${this.env.MIN_AGE} and over`);
    const hash = await hashPassword(input.password);
    try {
      const row = await this.db.one(
        `insert into users (email, password_hash, username, display_name, country, is_adult, terms_version, terms_accepted_at)
         values ($1,$2,$3,$4,$5,$6,$7, now()) returning *`,
        [input.email.trim(), hash, input.username, input.displayName.trim(), input.country?.toUpperCase() ?? null, age >= 18, TERMS_VERSION],
      );
      void this.sendVerification(row!.id).catch((e) => this.log.warn(`verification email: ${e.message}`));
      return { user: toPublicUser(row), ...(await this.issue(row!.id)) };
    } catch (e: any) {
      if (e.code === '23505') {
        throw new ConflictException(e.constraint === 'users_username_uq' ? 'That username is taken' : 'An account with that email already exists');
      }
      throw e;
    }
  }

  async login(email: string, password: string) {
    const row = await this.db.one(`select * from users where lower(email) = lower($1) and deleted_at is null`, [email.trim()]);
    const ok = await verifyPassword(password, row?.password_hash ?? DUMMY_HASH);
    if (!row || !ok) throw new UnauthorizedException('Wrong email or password');
    if (row.banned_at) throw new ForbiddenException('This account has been suspended. Contact support if you think this is a mistake.');
    return { user: toPublicUser(row), ...(await this.issue(row.id)) };
  }

  async refresh(refreshToken: string) {
    const row = await this.db.one(`select * from refresh_tokens where token_hash = $1`, [sha256(refreshToken)]);
    if (!row) throw new UnauthorizedException('Invalid session');
    if (row.revoked_at) {
      // A used token came back: someone may have copied it. End the whole session family.
      await this.db.query(`update refresh_tokens set revoked_at = now() where family_id = $1 and revoked_at is null`, [row.family_id]);
      throw new UnauthorizedException('Session expired, sign in again');
    }
    if (new Date(row.expires_at) < new Date()) throw new UnauthorizedException('Session expired, sign in again');
    const user = await this.db.one(`select id from users where id = $1 and deleted_at is null and banned_at is null`, [row.user_id]);
    if (!user) throw new UnauthorizedException('Invalid session');
    await this.db.query(`update refresh_tokens set revoked_at = now() where id = $1`, [row.id]);
    return this.issue(row.user_id, row.family_id);
  }

  async logout(refreshToken: string) {
    await this.db.query(
      `update refresh_tokens set revoked_at = now()
       where family_id = (select family_id from refresh_tokens where token_hash = $1) and revoked_at is null`,
      [sha256(refreshToken)],
    );
  }

  async revokeAll(userId: string) {
    await this.db.query(`update refresh_tokens set revoked_at = now() where user_id = $1 and revoked_at is null`, [userId]);
  }

  // ---------------------------------------------------------------- email codes
  private codeHash(userId: string, kind: string, code: string) {
    return sha256(`${this.env.JWT_ACCESS_SECRET}:${userId}:${kind}:${code}`);
  }

  /** Creates a fresh 6 digit code, replacing any older unused one. At most one per minute per person. */
  private async newCode(userId: string, kind: 'verify_email' | 'reset_password'): Promise<string | null> {
    const recent = await this.db.one(`select 1 from auth_codes where user_id = $1 and kind = $2 and created_at > now() - interval '60 seconds'`, [userId, kind]);
    if (recent) return null;
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.db.tx(async (tx) => {
      await tx.query(`update auth_codes set used_at = now() where user_id = $1 and kind = $2 and used_at is null`, [userId, kind]);
      await tx.query(`insert into auth_codes (user_id, kind, code_hash, expires_at) values ($1,$2,$3, now() + interval '15 minutes')`, [userId, kind, this.codeHash(userId, kind, code)]);
    });
    return code;
  }

  /** Checks a code. Five wrong tries burns it. Returns true and marks it used when it is right. */
  private async useCode(userId: string, kind: 'verify_email' | 'reset_password', code: string): Promise<boolean> {
    const row = await this.db.one(
      `select * from auth_codes where user_id = $1 and kind = $2 and used_at is null and expires_at > now() order by created_at desc limit 1`, [userId, kind]);
    if (!row) return false;
    if (row.attempts >= 5) return false;
    const a = Buffer.from(this.codeHash(userId, kind, code)); const b = Buffer.from(row.code_hash);
    const good = a.length === b.length && timingSafeEqual(a, b);
    if (!good) {
      await this.db.query(`update auth_codes set attempts = attempts + 1 where id = $1`, [row.id]);
      return false;
    }
    await this.db.query(`update auth_codes set used_at = now() where id = $1`, [row.id]);
    return true;
  }

  async sendVerification(userId: string) {
    const u = await this.db.one(`select email, display_name, email_verified_at from users where id = $1 and deleted_at is null`, [userId]);
    if (!u) throw new UnauthorizedException();
    if (u.email_verified_at) return { sent: false, alreadyVerified: true };
    const code = await this.newCode(userId, 'verify_email');
    if (!code) throw new HttpException('Wait a minute before asking for another code', 429);
    await this.mail.send(u.email, `${code} is your BMUETTE code`,
      `Hi ${u.display_name},\n\nYour BMUETTE verification code is ${code}.\nIt works for 15 minutes. If you did not create a BMUETTE account, ignore this email.`);
    return { sent: true, alreadyVerified: false };
  }

  async verifyEmail(userId: string, code: string) {
    if (!(await this.useCode(userId, 'verify_email', code))) throw new BadRequestException('That code is wrong or has expired');
    await this.db.query(`update users set email_verified_at = now() where id = $1 and email_verified_at is null`, [userId]);
    return { verified: true };
  }

  /** Always answers the same way, so nobody can use this to find out which emails have accounts. */
  async forgotPassword(email: string) {
    const u = await this.db.one(`select id, display_name, email from users where lower(email) = lower($1) and deleted_at is null and banned_at is null`, [email.trim()]);
    if (u) {
      const code = await this.newCode(u.id, 'reset_password');
      if (code) {
        await this.mail.send(u.email, `${code} is your BMUETTE password reset code`,
          `Hi ${u.display_name},\n\nYour BMUETTE password reset code is ${code}.\nIt works for 15 minutes. If you did not ask for this, you can ignore this email and your password stays the same.`);
      }
    }
    return { ok: true };
  }

  async resetPassword(email: string, code: string, newPassword: string) {
    const u = await this.db.one(`select id, email, display_name from users where lower(email) = lower($1) and deleted_at is null and banned_at is null`, [email.trim()]);
    if (!u || !(await this.useCode(u.id, 'reset_password', code))) throw new BadRequestException('That code is wrong or has expired');
    await this.db.query(`update users set password_hash = $2, email_verified_at = coalesce(email_verified_at, now()) where id = $1`, [u.id, await hashPassword(newPassword)]);
    await this.revokeAll(u.id);
    await this.mail.send(u.email, 'Your BMUETTE password was changed', `Hi ${u.display_name},\n\nYour password was just changed. If this was not you, reset it again now and contact ${this.env.SUPPORT_EMAIL}.`);
    return { ok: true };
  }

  async changePassword(userId: string, current: string, next: string) {
    const u = await this.db.one(`select password_hash from users where id = $1 and deleted_at is null`, [userId]);
    if (!u || !(await verifyPassword(current, u.password_hash))) throw new UnauthorizedException('Your current password is wrong');
    await this.db.query(`update users set password_hash = $2 where id = $1`, [userId, await hashPassword(next)]);
    // Every other device is signed out; this one gets a fresh session.
    await this.revokeAll(userId);
    return this.issue(userId);
  }

  async checkPassword(userId: string, password: string) {
    const u = await this.db.one(`select password_hash from users where id = $1 and deleted_at is null`, [userId]);
    if (!u || !(await verifyPassword(password, u.password_hash))) throw new UnauthorizedException('Wrong password');
  }

  private async issue(userId: string, familyId: string = randomUUID()) {
    const accessToken = await this.jwt.signAsync({ sub: userId }, { secret: this.env.JWT_ACCESS_SECRET, expiresIn: this.env.ACCESS_TTL_SECONDS });
    const refreshToken = randomBytes(48).toString('base64url');
    await this.db.query(
      `insert into refresh_tokens (user_id, token_hash, family_id, expires_at)
       values ($1,$2,$3, now() + make_interval(days => $4))`,
      [userId, sha256(refreshToken), familyId, this.env.REFRESH_TTL_DAYS],
    );
    return { accessToken, refreshToken, expiresIn: this.env.ACCESS_TTL_SECONDS };
  }
}
