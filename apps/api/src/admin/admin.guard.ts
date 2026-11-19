import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Db } from '../db/db.service';
import { AuthGuard } from '../common/auth.guard';

// Signed in AND flagged as an admin in the database. Checked on every request, so removing the flag takes effect at once.
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private auth: AuthGuard, private db: Db) {}
  async canActivate(ctx: ExecutionContext) {
    await this.auth.canActivate(ctx); // throws 401 if not signed in
    const uid = ctx.switchToHttp().getRequest().userId as string;
    const u = await this.db.one(`select 1 from users where id = $1 and is_admin and deleted_at is null`, [uid]);
    if (!u) throw new ForbiddenException('This account is not an admin');
    return true;
  }
}
