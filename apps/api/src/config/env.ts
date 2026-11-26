import { Global, Module } from '@nestjs/common';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().optional(),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  ACCESS_TTL_SECONDS: z.coerce.number().default(900),
  REFRESH_TTL_DAYS: z.coerce.number().default(60),

  // Public URL of this API (used to build links for local storage and return URLs).
  PUBLIC_BASE_URL: z.string().default('http://localhost:3000'),

  // Images: "local" stores on disk (development only). "s3" works with Cloudflare R2, AWS S3, MinIO.
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_PUBLIC_BASE_URL: z.string().optional(),

  // Video: "local" is development only. "cloudflare" uses Cloudflare Stream.
  VIDEO_DRIVER: z.enum(['local', 'cloudflare']).default('local'),
  CF_ACCOUNT_ID: z.string().optional(),
  CF_STREAM_API_TOKEN: z.string().optional(),
  CF_STREAM_CUSTOMER_CODE: z.string().optional(),
  CF_STREAM_WEBHOOK_SECRET: z.string().optional(),

  // Payments
  PLATFORM_FEE_BPS: z.coerce.number().int().min(0).max(5000).default(500),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  FLW_SECRET_KEY: z.string().optional(),
  FLW_WEBHOOK_HASH: z.string().optional(),
  FLW_BASE_URL: z.string().default('https://api.flutterwave.com'),
  CHECKOUT_RETURN_URL: z.string().default('bmuette://checkout'),

  // Email (verification codes, password reset). "log" only records emails in the database (development).
  EMAIL_DRIVER: z.enum(['log', 'resend']).default('log'),
  CREATOR_COIN_MINOR: z.coerce.number().int().min(0).max(100000).default(900),
  GIFT_HOLD_DAYS: z.coerce.number().int().min(0).max(60).default(14),
  PAYOUT_HOLD_DAYS: z.coerce.number().int().min(0).max(60).default(7),
  RETURN_WINDOW_DAYS: z.coerce.number().int().min(0).max(90).default(14),
  PUSH_DRIVER: z.enum(['log', 'expo']).default('log'),
  EXPO_ACCESS_TOKEN: z.string().optional(),
  EXPO_PUSH_URL: z.string().default('https://exp.host/--/api/v2/push/send'),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('BMUETTE <no-reply@bmuette.app>'),
  SUPPORT_EMAIL: z.string().default('support@bmuette.app'),
  LEGAL_ENTITY_NAME: z.string().default('BMUETTE'),
  MIN_AGE: z.coerce.number().int().min(10).max(18).default(13),

  // Optional Python AI service (CLIP-style embeddings). Without it, search is text-only.
  AI_SERVICE_URL: z.string().optional(),
});

export type Env = z.infer<typeof schema>;
export const ENV = 'ENV';

export function loadEnv(): Env {
  try {
    process.loadEnvFile('.env');
  } catch {
    // no .env file: use the real environment
  }
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment:\n${lines}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === 'production') {
    if (env.STORAGE_DRIVER === 'local' || env.VIDEO_DRIVER === 'local') {
      throw new Error('STORAGE_DRIVER and VIDEO_DRIVER must not be "local" in production.');
    }
    if (env.EMAIL_DRIVER === 'log') throw new Error('EMAIL_DRIVER must be "resend" in production (people could not receive codes otherwise).');
    if (env.EMAIL_DRIVER === 'resend' && !env.RESEND_API_KEY) throw new Error('EMAIL_DRIVER=resend needs RESEND_API_KEY');
  }
  return env;
}

@Global()
@Module({ providers: [{ provide: ENV, useFactory: loadEnv }], exports: [ENV] })
export class EnvModule {}
