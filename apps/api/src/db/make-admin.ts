import { Pool } from 'pg';

// Usage: node dist/db/make-admin.js you@example.com [--remove]
async function main() {
  try { process.loadEnvFile('.env'); } catch {}
  const [email, flag] = process.argv.slice(2);
  if (!email || !process.env.DATABASE_URL) throw new Error('Usage: node dist/db/make-admin.js <email> [--remove]   (DATABASE_URL must be set)');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const r = await pool.query(`update users set is_admin = $2 where lower(email) = lower($1) and deleted_at is null returning username`, [email.trim(), flag !== '--remove']);
  await pool.end();
  if (!r.rowCount) throw new Error(`No account with the email ${email}. Sign up in the app first, then run this again.`);
  console.log(`${r.rows[0].username} is ${flag === '--remove' ? 'no longer' : 'now'} an admin.`);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
