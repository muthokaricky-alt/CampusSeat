import { pool } from './db.js';
import { listMigrations } from '../scripts/migrate.js';

let shuttingDown = false;
export const markShuttingDown = () => { shuttingDown = true; };

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timed out after ${ms} ms`)), ms))]);

export async function checkDb(timeoutMs = 2000) {
  const t = performance.now();
  try {
    await withTimeout(pool.query('SELECT 1'), timeoutMs);
    return { ok: true, latency_ms: Math.round(performance.now() - t) };
  } catch (err) {
    return { ok: false, error: err.code || err.message };
  }
}

let known; // migration files are fixed for the life of the process
export async function checkMigrations() {
  known ??= (await listMigrations()).map((m) => m.version);
  try {
    const [rows] = await pool.query('SELECT version FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.version));
    const pending = known.filter((v) => !applied.has(v));
    return { ok: pending.length === 0, pending };
  } catch (err) {
    return { ok: false, error: err.code === 'ER_NO_SUCH_TABLE' ? 'migrations never run' : err.code || err.message };
  }
}

/** Liveness: the process is up; also reports database reachability. 503 when the database is down. */
export async function health(_req, res) {
  const db = await checkDb();
  res.status(db.ok ? 200 : 503).json({ ok: db.ok, uptime_s: Math.round(process.uptime()), db });
}

/** Readiness: safe to send traffic (database reachable, schema up to date, not shutting down). */
export async function ready(_req, res) {
  const [db, migrations] = await Promise.all([checkDb(), checkMigrations()]);
  const ok = db.ok && migrations.ok && !shuttingDown;
  res.status(ok ? 200 : 503).json({ ok, db, migrations, shutting_down: shuttingDown });
}
