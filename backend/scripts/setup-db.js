// Kept for old instructions: setting up the database is now "npm run migrate".
import { runMigrations } from './migrate.js';

try {
  await runMigrations();
} catch (err) {
  console.error('Database setup failed:', err.message);
  process.exitCode = 1;
}
