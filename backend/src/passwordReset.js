import crypto from 'node:crypto';
import { pool } from './db.js';
import { config } from './config.js';
import { send } from './mail/index.js';
import { passwordReset } from './mail/templates.js';

export const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

/**
 * Creates a single-use reset token for a user (earlier unused tokens stop working) and emails the link.
 * The token is put in the URL fragment (#token=...), which browsers never send to servers,
 * so it cannot leak through access logs, proxies or the Referer header.
 * Returns false when the user already asked 3 times in the last hour (nothing is sent).
 */
export async function issueReset(user, ip) {
  const [[{ n }]] = await pool.execute(
    'SELECT COUNT(*) AS n FROM password_resets WHERE user_id = ? AND created_at > UTC_TIMESTAMP() - INTERVAL 1 HOUR', [user.user_id]);
  if (Number(n) >= 3) return false;
  const token = crypto.randomBytes(32).toString('base64url');
  await pool.execute('UPDATE password_resets SET used_at = UTC_TIMESTAMP() WHERE user_id = ? AND used_at IS NULL', [user.user_id]);
  await pool.execute(
    'INSERT INTO password_resets (user_id, token_hash, expires_at, request_ip) VALUES (?, ?, UTC_TIMESTAMP() + INTERVAL ? MINUTE, ?)',
    [user.user_id, hashToken(token), config.resetTokenMinutes, ip?.slice(0, 45) ?? null]);
  const link = `${config.appUrl}/reset-password#token=${token}`;
  const mail = passwordReset({ name: user.full_name, link, minutes: config.resetTokenMinutes });
  // Not awaited by callers that must answer in constant time; send() never throws.
  return { sent: send({ to: user.email, kind: 'password_reset', ...mail }) };
}
