import { createApp } from './app.js';
import { config } from './config.js';
import { pool } from './db.js';

try {
  await pool.query('SELECT 1');
} catch (err) {
  console.error(`Cannot connect to MySQL (${config.db.user}@${config.db.host}/${config.db.database}): ${err.message}`);
  console.error('Check backend/.env and that you ran database/schema.sql');
  process.exit(1);
}
createApp().listen(config.port, () => console.log(`CampusSeat API running on http://localhost:${config.port}`));
