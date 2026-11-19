import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { AuthGuard, UserId } from '../common/auth.guard';
import { ZodPipe } from '../common/zod.pipe';
import { AuthService } from './auth.service';

const register = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(128),
  username: z.string().regex(/^[a-zA-Z0-9_.]{3,20}$/, '3 to 20 letters, numbers, dots or underscores'),
  displayName: z.string().trim().min(1).max(60),
  country: z.string().length(2).optional(),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  acceptTerms: z.literal(true, { message: 'You need to accept the Terms and Privacy Policy' }),
});
const code = z.object({ code: z.string().regex(/^\d{6}$/, 'The code is 6 digits') });
const forgot = z.object({ email: z.string().email() });
const reset = z.object({ email: z.string().email(), code: z.string().regex(/^\d{6}$/, 'The code is 6 digits'), password: z.string().min(8).max(128) });
const change = z.object({ currentPassword: z.string().min(1).max(128), newPassword: z.string().min(8).max(128) });
const login = z.object({ email: z.string().email(), password: z.string().min(1).max(128) });
const token = z.object({ refreshToken: z.string().min(20).max(200) });

@Controller('auth')
@Throttle({ default: { limit: 10, ttl: 60_000 } })
export class AuthController {
  constructor(private auth: AuthService) {}

  @Post('register')
  register(@Body(new ZodPipe(register)) body: z.infer<typeof register>) {
    return this.auth.register(body);
  }

  @Post('login')
  @HttpCode(200)
  login(@Body(new ZodPipe(login)) body: z.infer<typeof login>) {
    return this.auth.login(body.email, body.password);
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body(new ZodPipe(token)) body: z.infer<typeof token>) {
    return this.auth.refresh(body.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Body(new ZodPipe(token)) body: z.infer<typeof token>) {
    await this.auth.logout(body.refreshToken);
  }

  @Post('verify-email/send') @UseGuards(AuthGuard) @HttpCode(200)
  sendVerification(@UserId() id: string) { return this.auth.sendVerification(id); }

  @Post('verify-email') @UseGuards(AuthGuard) @HttpCode(200)
  verifyEmail(@UserId() id: string, @Body(new ZodPipe(code)) b: z.infer<typeof code>) { return this.auth.verifyEmail(id, b.code); }

  @Post('forgot-password') @HttpCode(200)
  forgot(@Body(new ZodPipe(forgot)) b: z.infer<typeof forgot>) { return this.auth.forgotPassword(b.email); }

  @Post('reset-password') @HttpCode(200)
  reset(@Body(new ZodPipe(reset)) b: z.infer<typeof reset>) { return this.auth.resetPassword(b.email, b.code, b.password); }

  @Post('change-password') @UseGuards(AuthGuard) @HttpCode(200)
  change(@UserId() id: string, @Body(new ZodPipe(change)) b: z.infer<typeof change>) { return this.auth.changePassword(id, b.currentPassword, b.newPassword); }
}
