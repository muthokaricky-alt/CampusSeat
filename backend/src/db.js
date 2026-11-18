import mysql from 'mysql2/promise';
import { dbConfig } from './db-config.js';

// All queries use placeholders (?) via pool.execute(), i.e. prepared statements,
// so user input never gets concatenated into SQL (protects against SQL injection).
export const pool = mysql.createPool({
  ...dbConfig,
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: true, // DATE/TIME/DATETIME come back as plain strings; utils/time.js converts them
  timezone: 'Z',
});

// Every session runs in UTC whatever the server default is, so CURRENT_TIMESTAMP, UTC_TIMESTAMP()
// and stored DATETIMEs are all UTC. Conversion to Nairobi time happens in the app (utils/time.js).
pool.pool.on('connection', (conn) => conn.query("SET time_zone = '+00:00'"));

export async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

/** Run fn(conn) inside one transaction; commits on success, rolls back on any error. */
export async function withTransaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}