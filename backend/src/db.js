import mysql from 'mysql2/promise';
import { config } from './config.js';

// All queries use placeholders (?) via pool.execute(), i.e. prepared statements,
// so user input never gets concatenated into SQL (protects against SQL injection).
export const pool = mysql.createPool({
  ...config.db,
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: true, // keep DATE/TIME/DATETIME as plain strings (no timezone surprises)
  charset: 'utf8mb4',
});

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
