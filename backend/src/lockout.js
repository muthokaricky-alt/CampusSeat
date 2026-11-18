import { pool } from './db.js';
import { config } from './config.js';

/**
 * Account lockout after repeated failed logins (on top of the per-IP rate limits).
 * After LOCKOUT_THRESHOLD failures in a row the account is locked for LOCKOUT_MINUTES; each later
 * lock doubles, up to 24 h, until a successful login. Locks expire by themselves (so an attacker
 * cannot lock someone out for good) and an admin can unlock early.
 *
 * Emails without an account get the same treatment, tracked in memory, so the "locked" answer
 * never reveals whether an address is registered.
 */
const MAX_MINUTES = 24 * 60;
const minutesFor = (lockCount) => Math.min(MAX_MINUTES, config.lockoutMinutes * 2 ** lockCount);

/** Seconds left on a lock, or 0. Uses the database clock (UTC). */
export async function lockRemaining(userId) {
  const [[r]] = await pool.execute(
    'SELECT GREATEST(0, TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), locked_until)) AS s FROM users WHERE user_id = ?', [userId]);
  return Number(r?.s || 0);
}

/** Records a failure. Returns { locked: true, minutes } when this failure triggered a lock. */
export async function recordFailure(userId) {
  const t = config.lockoutThreshold;
  // MySQL applies SET assignments left to right, so locked_until and lock_count read the old values.
  await pool.execute(
    `UPDATE users SET
       locked_until  = IF(failed_logins + 1 >= ?, UTC_TIMESTAMP() + INTERVAL LEAST(?, ? * POW(2, lock_count)) MINUTE, locked_until),
       lock_count    = IF(failed_logins + 1 >= ?, lock_count + 1, lock_count),
       failed_logins = IF(failed_logins + 1 >= ?, 0, failed_logins + 1)
     WHERE user_id = ?`, [t, MAX_MINUTES, config.lockoutMinutes, t, t, userId]);
  const [[u]] = await pool.execute('SELECT failed_logins, lock_count, locked_until > UTC_TIMESTAMP() AS locked FROM users WHERE user_id = ?', [userId]);
  return { locked: Number(u.locked) === 1 && u.failed_logins === 0, minutes: minutesFor(u.lock_count - 1) };
}

export const recordSuccess = (userId) =>
  pool.execute('UPDATE users SET failed_logins = 0, lock_count = 0, locked_until = NULL WHERE user_id = ?', [userId]);

export const unlock = (userId) => recordSuccess(userId);

// ---- unknown emails: same behaviour, in memory (bounded, so it cannot grow without limit)
const ghosts = new Map(); // email -> { fails, lockCount, until }
const MAX_GHOSTS = 10_000;

export function ghostRemaining(email) {
  const g = ghosts.get(email);
  return g && g.until > Date.now() ? Math.ceil((g.until - Date.now()) / 1000) : 0;
}

export function ghostFailure(email) {
  let g = ghosts.get(email);
  if (!g) {
    if (ghosts.size >= MAX_GHOSTS) ghosts.delete(ghosts.keys().next().value); // drop the oldest
    g = { fails: 0, lockCount: 0, until: 0 };
    ghosts.set(email, g);
  }
  g.fails += 1;
  if (g.fails >= config.lockoutThreshold) {
    g.until = Date.now() + minutesFor(g.lockCount) * 60_000;
    g.lockCount += 1;
    g.fails = 0;
    return { locked: true };
  }
  return { locked: false };
}

export const lockedMessage = (seconds) => {
  const m = Math.max(1, Math.ceil(seconds / 60));
  return `Too many failed attempts. For your security, logging in to this account is paused for ${m} minute${m === 1 ? '' : 's'}. You can also reset your password by email.`;
};
