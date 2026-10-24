import { pool } from '../db.js';

/** Writes an audit-trail row. Never throws: a logging failure must not break the user's action. */
export async function audit(userId, action, details = null, conn = pool) {
  try {
    await conn.execute('INSERT INTO audit_logs (user_id, action, details) VALUES (?, ?, ?)', [
      userId ?? null,
      action,
      details,
    ]);
  } catch (err) {
    console.error('Audit log failed:', err.message);
  }
}
