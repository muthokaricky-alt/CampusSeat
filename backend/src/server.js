import { createApp } from './app.js';
import { config } from './config.js';
import { pool } from './db.js';
import { dbTarget } from './db-config.js';

try {
  await pool.query('SELECT 1');
} catch (err) {
  console.error(`Cannot connect to MySQL (${dbTarget()}): ${err.message}`);
  console.error('Check backend/.env and run: npm run migrate');
  process.exit(1);
}
createApp().listen(config.port, () => console.log(`CampusSeat API running on http://localhost:${config.port}`));
