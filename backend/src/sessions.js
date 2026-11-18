import crypto from 'node:crypto';
import { pool, query } from './db.js';
import { config } from './config.js';
import { logger } from './logger.js';

/**
 * Server-side sessions.
 * - The cookie holds a random 256-bit token. The database keeps only sha256(token).
 * - Sliding expiry: each use pushes idle_expires_at forward, never past absolute_expires_at.
 * - Revoking (logout, password change, role change) takes effect on the very next request.
 */
export const SESSION_COOKIE = config.cookieSecure ? '__Host-cs_sid' : 'cs_sid';
const TOUCH_EVERY_MS = 60_000; // write last_seen at most once a minute per session

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const random = () => crypto.randomBytes(32).toString('base64url');
const plusMs = (ms) => new Date(Date.now() + ms);
const sql = (d) => d.toISOString().slice(0, 19).replace('T', ' ');

export const cookieOptions = (maxAgeMs) => ({
  httpOnly: true,
  secure: config.cookieSecure,
  sameSite: 'lax',
  path: '/',
  ...(maxAgeMs !== undefined ? { maxAge: maxAgeMs } : {}),
});

/** Creates a session for a user and sets the cookie. Returns the CSRF token the page must echo. */
export async function startSession(res, userId, req, conn = pool) {
  const token = random();
  const csrf = crypto.randomBytes(32).toString('hex');
  const idle = config.sessionIdleMinutes * 60_000;
  const absolute = config.sessionMaxDays * 864e5;
  await conn.execute(
    `INSERT INTO sessions (token_hash, user_id, csrf_token, last_seen_at, idle_expires_at, absolute_expires_at, ip, user_agent)
     VALUES (?, ?, ?, UTC_TIMESTAMP(), ?, ?, ?, ?)`,
    [sha256(token), userId, csrf, sql(plusMs(Math.min(idle, absolute))), sql(plusMs(absolute)), req.ip?.slice(0, 45) ?? null,
      String(req.get('user-agent') || '').slice(0, 255) || null]);
  res.cookie(SESSION_COOKIE, token, cookieOptions(absolute));
  return csrf;
}

export function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, cookieOptions());
}

/** Reads the session cookie and returns { user, session } or null. Expired or revoked sessions return null. */
export async function loadSession(req) {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token || token.length > 100) return null;
  const hash = sha256(token);
  const [row] = await query(
    `SELECT s.token_hash, s.csrf_token, s.last_seen_at, s.absolute_expires_at,
            (s.revoked_at IS NULL AND s.idle_expires_at > UTC_TIMESTAMP() AND s.absolute_expires_at > UTC_TIMESTAMP()) AS live,
            u.user_id, u.full_name, u.student_number, u.email, u.school_id, u.role
       FROM sessions s JOIN users u ON u.user_id = s.user_id WHERE s.token_hash = ?`, [hash]);
  if (!row) return { expired: true };
  if (!Number(row.live)) return { expired: true };
  const lastSeen = new Date(`${row.last_seen_at.replace(' ', 'T')}Z`).getTime();
  if (Date.now() - lastSeen > TOUCH_EVERY_MS) {
    // Slide the idle window (bounded by the absolute expiry). Not awaited: it must not slow the request.
    pool.execute(
      `UPDATE sessions SET last_seen_at = UTC_TIMESTAMP(),
         idle_expires_at = LEAST(absolute_expires_at, UTC_TIMESTAMP() + INTERVAL ? MINUTE) WHERE token_hash = ?`,
      [config.sessionIdleMinutes, hash]).catch((err) => logger.warn({ err }, 'session touch failed'));
  }
  const { token_hash, csrf_token, last_seen_at, absolute_expires_at, live, ...user } = row;
  return { user, session: { hash: token_hash, csrf: csrf_token } };
}

export const revokeSession = (hash, conn = pool) =>
  conn.execute('UPDATE sessions SET revoked_at = UTC_TIMESTAMP() WHERE token_hash = ? AND revoked_at IS NULL', [hash]);

/** Ends every session of a user, optionally keeping one (the one making the request). Returns how many ended. */
export async function revokeUserSessions(userId, { except = null, conn = pool } = {}) {
  const [r] = await conn.execute(
    'UPDATE sessions SET revoked_at = UTC_TIMESTAMP() WHERE user_id = ? AND revoked_at IS NULL AND token_hash <> ?',
    [userId, except ?? '']);
  return r.affectedRows;
}

/** Deletes sessions that ended more than a day ago. Runs hourly. */
export async function pruneSessions() {
  const [r] = await pool.execute(
    `DELETE FROM sessions WHERE absolute_expires_at < UTC_TIMESTAMP() - INTERVAL 1 DAY
        OR idle_expires_at < UTC_TIMESTAMP() - INTERVAL 1 DAY OR revoked_at < UTC_TIMESTAMP() - INTERVAL 1 DAY`);
  if (r.affectedRows) logger.info({ removed: r.affectedRows }, 'pruned old sessions');
}

/** Minimal cookie reader (avoids a dependency). Returns the decoded value or null. */
export function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return null; }
    }
  }
  return null;
}
