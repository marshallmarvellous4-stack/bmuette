import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { join } from 'node:path';
import { raw, static as serveStatic } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { loadEnv } from './config/env';
import { LOCAL_DIR } from './media/storage';

async function bootstrap() {
  const env = loadEnv();
  // rawBody keeps the exact bytes Stripe and Cloudflare signed, which signature checks need.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.use(helmet());
  // We usually sit behind a load balancer; this makes rate limits see the real client address.
  (app.getHttpAdapter().getInstance() as any).set('trust proxy', 1);

  // The admin dashboard: plain files in admin-ui/, plus the admin-only data endpoints under /admin/api.
  app.use('/admin', (_req: any, res: any, next: any) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  app.use('/admin', serveStatic(join(__dirname, '..', 'admin-ui'), { index: 'index.html' }));

  // The starter music library (original loops made for BMUETTE).
  app.use('/assets/sounds', serveStatic(join(__dirname, '..', 'assets', 'sounds'), { maxAge: '7d', index: false }));

  if (env.STORAGE_DRIVER === 'local' || env.VIDEO_DRIVER === 'local') {
    app.use('/dev/upload', raw({ type: () => true, limit: '210mb' }));
    app.use('/files', serveStatic(LOCAL_DIR));
  }
  app.enableShutdownHooks();
  await app.listen(env.PORT, '0.0.0.0');
  new Logger('Bootstrap').log(`BMUETTE API listening on :${env.PORT} (${env.NODE_ENV})`);
}
bootstrap().catch((e) => { console.error(e); process.exit(1); });
