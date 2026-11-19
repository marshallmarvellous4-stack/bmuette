import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';

// Plain SQL migrations, applied in filename order, each in its own transaction.
async function main() {
  try { process.loadEnvFile('.env'); } catch {}
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const pool = new Pool({ connectionString: url });
  const dir = join(__dirname, '..', '..', 'migrations');
  await pool.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
  const done = new Set((await pool.query('select name from schema_migrations')).rows.map((r) => r.name));
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(file)) continue;
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(readFileSync(join(dir, file), 'utf8'));
      await client.query('insert into schema_migrations(name) values ($1)', [file]);
      await client.query('commit');
      console.log('applied', file);
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
  }
  await pool.end();
  console.log('migrations up to date');
}
main().catch((e) => { console.error(e); process.exit(1); });
