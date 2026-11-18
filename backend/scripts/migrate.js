// Numbered database migrations.
//   npm run migrate              apply pending migrations
//   npm run migrate -- status    list applied / pending migrations
//   npm run migrate -- --dry-run show what would run; JS migrations report what they would change
//
// Files live in backend/migrations and are named NNN_description.sql or NNN_description.js.
// A .js migration exports `async function up(conn, ctx)`; ctx = { dryRun, log, env }.
// Applied migrations are recorded in schema_migrations with a checksum, so an edited file is detected.
// Note: MySQL DDL cannot be rolled back, so each migration should be safe to re-run after a partial failure.
import mysql from 'mysql2/promise';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dbConfig, dbTarget } from '../src/db-config.js';

export const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');
const LOCK = 'campusseat_migrate';

export async function listMigrations() {
  const files = (await fs.readdir(MIGRATIONS_DIR)).filter((f) => /^\d{3}_[\w-]+\.(sql|js)$/.test(f)).sort();
  return Promise.all(files.map(async (file) => {
    const body = await fs.readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
    return { version: file.slice(0, 3), file, checksum: crypto.createHash('sha256').update(body.replace(/\r\n/g, '\n')).digest('hex'), body };
  }));
}

async function ensureTable(conn) {
  await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    CHAR(3) PRIMARY KEY,
    file       VARCHAR(255) NOT NULL,
    checksum   CHAR(64) NOT NULL,
    baselined  TINYINT(1) NOT NULL DEFAULT 0,
    applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`);
}

/** Returns { applied: Map, pending: [], changed: [] } for the connected database. */
export async function migrationState(conn) {
  const all = await listMigrations();
  let rows = [];
  try { [rows] = await conn.query('SELECT version, file, checksum FROM schema_migrations'); } catch (err) {
    if (err.code !== 'ER_NO_SUCH_TABLE') throw err;
  }
  const applied = new Map(rows.map((r) => [r.version, r]));
  return {
    all,
    applied,
    pending: all.filter((m) => !applied.has(m.version)),
    changed: all.filter((m) => applied.has(m.version) && applied.get(m.version).checksum !== m.checksum),
  };
}

export async function runMigrations({ dryRun = false, log = console.log } = {}) {
  const conn = await mysql.createConnection({ ...dbConfig, multipleStatements: true, timezone: 'Z' });
  try {
    await conn.query("SET time_zone = '+00:00'");
    const [[{ got }]] = await conn.query('SELECT GET_LOCK(?, 30) AS got', [LOCK]);
    if (!Number(got)) throw new Error('Another migration is running (could not get the lock within 30 s).');
    await ensureTable(conn);
    let { pending, changed } = await migrationState(conn);
    if (changed.length) log(`WARNING: these applied migrations were edited afterwards: ${changed.map((m) => m.file).join(', ')}`);

    // Existing database created from the old schema.sql: record the baseline without running it.
    const base = pending.find((m) => m.version === '001');
    if (base) {
      const [[{ n }]] = await conn.query(
        "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN ('users','events','bookings')");
      if (Number(n) === 3) {
        log(`001 baseline: tables already exist, marking as applied${dryRun ? ' (dry run)' : ''}.`);
        if (!dryRun) await conn.query('INSERT INTO schema_migrations (version, file, checksum, baselined) VALUES (?, ?, ?, 1)', [base.version, base.file, base.checksum]);
        pending = pending.filter((m) => m !== base);
      }
    }
    if (!pending.length) { log(`Database ${dbTarget()} is up to date.`); return { applied: [] }; }

    const done = [];
    for (const m of pending) {
      log(`${dryRun ? 'Would apply' : 'Applying'} ${m.file}`);
      if (m.file.endsWith('.sql')) {
        if (!dryRun) await conn.query(m.body);
      } else {
        const mod = await import(pathToFileURL(path.join(MIGRATIONS_DIR, m.file)).href);
        await mod.up(conn, { dryRun, log: (s) => log(`  ${s}`), env: process.env });
      }
      if (!dryRun) await conn.query('INSERT INTO schema_migrations (version, file, checksum) VALUES (?, ?, ?)', [m.version, m.file, m.checksum]);
      done.push(m.file);
    }
    log(dryRun ? `Dry run: ${done.length} migration(s) would be applied.` : `Applied ${done.length} migration(s).`);
    return { applied: done };
  } finally {
    await conn.query('SELECT RELEASE_LOCK(?)', [LOCK]).catch(() => {});
    await conn.end();
  }
}

async function status() {
  const conn = await mysql.createConnection(dbConfig);
  try {
    const { all, applied, changed } = await migrationState(conn);
    console.log(`Database: ${dbTarget()}`);
    for (const m of all) {
      const a = applied.get(m.version);
      console.log(`  ${a ? (changed.includes(m) ? 'CHANGED ' : 'applied ') : 'pending '} ${m.file}`);
    }
  } finally { await conn.end(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  try {
    if (args.includes('status')) await status();
    else await runMigrations({ dryRun: args.includes('--dry-run') });
  } catch (err) {
    console.error(`Migration failed on ${dbTarget()}: ${err.message}`);
    process.exitCode = 1;
  }
}
