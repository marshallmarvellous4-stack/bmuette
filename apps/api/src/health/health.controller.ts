import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Db } from '../db/db.service';

@Controller('health')
@SkipThrottle()
export class HealthController {
  constructor(private db: Db) {}
  @Get()
  async check() {
    try {
      await this.db.query('select 1');
      return { status: 'ok' };
    } catch {
      throw new ServiceUnavailableException({ status: 'database unreachable' });
    }
  }
}
