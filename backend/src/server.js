import { createApp } from './app.js';
import { config } from './config.js';
import { pool } from './db.js';
import { dbTarget } from './db-config.js';
import { logger } from './logger.js';
import { checkMigrations, markShuttingDown } from './health.js';

try {
  await pool.query('SELECT 1');
} catch (err) {
  logger.fatal(`Cannot connect to MySQL (${dbTarget()}): ${err.message}. Check backend/.env, then run: npm run migrate`);
  process.exit(1);
}
const mig = await checkMigrations();
if (!mig.ok) logger.warn({ migrations: mig }, 'Database schema is not up to date: run "npm run migrate". /api/ready will report 503.');

const server = createApp().listen(config.port, () => logger.info(`CampusSeat API (${config.env}) listening on http://localhost:${config.port}`));

// Graceful shutdown: Render sends SIGTERM on deploy. Stop taking traffic, finish in-flight requests, close the pool.
let stopping = false;
function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  markShuttingDown();
  logger.info(`${signal} received, shutting down`);
  const force = setTimeout(() => { logger.error('Forced exit after 10 s'); process.exit(1); }, 10_000);
  force.unref();
  server.close(async () => {
    await pool.end().catch(() => {});
    logger.info('Shutdown complete');
    process.exit(0);
  });
  server.closeIdleConnections?.();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandled promise rejection'));
