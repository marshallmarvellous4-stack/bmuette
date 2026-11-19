import { ArgumentsHost, Catch, HttpException, Injectable, Logger } from '@nestjs/common';
import { BaseExceptionFilter, HttpAdapterHost } from '@nestjs/core';
import { Db } from '../db/db.service';

// Normal error handling, plus a copy of every server error (5xx) into error_log for the dashboard.
// Only the method, path (no query string), status and a short message are kept. Never request bodies.
@Catch()
@Injectable()
export class ErrorLogFilter extends BaseExceptionFilter {
  private log = new Logger('Errors');
  constructor(hosts: HttpAdapterHost, private db: Db) { super(hosts.httpAdapter); }

  catch(exception: unknown, host: ArgumentsHost) {
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    if (status >= 500 && host.getType() === 'http') {
      const req = host.switchToHttp().getRequest();
      const message = String((exception as any)?.message ?? exception).slice(0, 300);
      const path = String(req?.originalUrl ?? req?.url ?? '').split('?')[0].slice(0, 200);
      void this.db
        .query(`insert into error_log (method, path, status, message, user_id) values ($1,$2,$3,$4,$5)`, [req?.method ?? '?', path, status, message, req?.userId ?? null])
        .then(() => (Math.random() < 0.01 ? this.db.query(`delete from error_log where at < now() - interval '30 days'`) : null))
        .catch((e) => this.log.warn(`could not record error: ${e.message}`));
    }
    super.catch(exception, host);
  }
}
