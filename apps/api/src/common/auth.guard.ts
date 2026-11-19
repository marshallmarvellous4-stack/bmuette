import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException, createParamDecorator } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Cache } from '../cache/cache.service';
import { ENV, Env } from '../config/env';

export type AuthedRequest = { userId?: string; headers: Record<string, string | undefined> };

async function readUser(jwt: JwtService, env: Env, cache: Cache, req: AuthedRequest): Promise<string | null> {
  const header = req.headers['authorization'];
  if (!header?.startsWith('Bearer ')) return null;
  try {
    const payload = await jwt.verifyAsync<{ sub: string }>(header.slice(7), { secret: env.JWT_ACCESS_SECRET });
    // Suspended accounts are flagged for as long as an access token could still be alive.
    if (await cache.hasFlag(`banned:${payload.sub}`)) return null;
    return payload.sub;
  } catch {
    return null;
  }
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private jwt: JwtService, @Inject(ENV) private env: Env, private cache: Cache) {}
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const id = await readUser(this.jwt, this.env, this.cache, req);
    if (!id) throw new UnauthorizedException('Sign in required');
    req.userId = id;
    return true;
  }
}

// Lets signed-out visitors through, but still identifies signed-in ones.
@Injectable()
export class OptionalAuthGuard implements CanActivate {
  constructor(private jwt: JwtService, @Inject(ENV) private env: Env, private cache: Cache) {}
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    req.userId = (await readUser(this.jwt, this.env, this.cache, req)) ?? undefined;
    return true;
  }
}

export const UserId = createParamDecorator((_: unknown, ctx: ExecutionContext): string =>
  ctx.switchToHttp().getRequest<AuthedRequest>().userId as string);

export const MaybeUserId = createParamDecorator((_: unknown, ctx: ExecutionContext): string | undefined =>
  ctx.switchToHttp().getRequest<AuthedRequest>().userId);
