import { Global, Inject, Logger, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient, QueryResultRow } from 'pg';
import { ENV, Env } from '../config/env';

export type Tx = { query<T extends QueryResultRow = any>(sql: string, params?: unknown[]): Promise<T[]> };

@Injectable()
export class Db implements OnModuleDestroy {
  readonly pool: Pool;
  constructor(@Inject(ENV) env: Env) {
    this.pool = new Pool({ connectionString: env.DATABASE_URL, max: 20 });
    // A database restart or failover drops idle connections. Without this handler Node treats that as a crash;
    // with it, the pool just opens fresh connections on the next request.
    this.pool.on('error', (e) => new Logger('Db').warn(`idle connection dropped: ${e.message}`));
  }

  async query<T extends QueryResultRow = any>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await this.pool.query<T>(sql, params as any[])).rows;
  }

  async one<T extends QueryResultRow = any>(sql: string, params: unknown[] = []): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows[0] ?? null;
  }

  async tx<R>(fn: (tx: Tx) => Promise<R>): Promise<R> {
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await fn({ query: async (sql, params = []) => (await client.query(sql, params as any[])).rows });
      await client.query('commit');
      return result;
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
  }

  onModuleDestroy() {
    return this.pool.end();
  }
}

@Global()
@Module({ providers: [Db], exports: [Db] })
export class DbModule {}
