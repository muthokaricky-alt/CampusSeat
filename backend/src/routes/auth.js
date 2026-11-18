import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { query, pool, withTransaction } from '../db.js';
import { hashToken, issueReset } from '../passwordReset.js';
import { AppError, asyncHandler } from '../utils/errors.js';
import * as v from '../utils/validate.js';
import { audit } from '../utils/audit.js';
import { requireAuth } from '../middleware/auth.js';
import { clearSessionCookie, loadSession, revokeSession, revokeUserSessions, startSession } from '../sessions.js';
import { config } from '../config.js';
import * as lockout from '../lockout.js';

const router = Router();
// Rate limits slow down password guessing and mass sign-ups. RATE_LIMIT_SCALE lets tests raise them.
const scale = config.rateLimitScale;
const makeLimiter = (limit, opts = {}) => rateLimit({
  windowMs: 15 * 60 * 1000, limit: limit * scale, standardHeaders: true, legacyHeaders: false, ...opts,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please wait a few minutes and try again.' } },
});
const loginLimiter = makeLimiter(20, { skipSuccessfulRequests: true }); // only failed logins count
const registerLimiter = makeLimiter(30);
const resetLimiter = makeLimiter(10); // every request counts: they all answer 200
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10); // keeps login timing similar for unknown emails

const publicUser = (u) => ({
  user_id: u.user_id, full_name: u.full_name, student_number: u.student_number,
  email: u.email, school_id: u.school_id, school_name: u.school_name, role: u.role,
});
const loadFull = async (id) =>
  (await query('SELECT u.*, s.school_name FROM users u JOIN schools s ON s.school_id = u.school_id WHERE u.user_id = ?', [id]))[0];

router.post('/register', registerLimiter, asyncHandler(async (req, res) => {
  const b = req.body || {};
  const full_name = v.str(b.full_name, 'full_name', { min: 2, max: 100, label: 'Full name' });
  const student_number = v.str(b.student_number, 'student_number', { min: 3, max: 30, label: 'Student/staff number' });
  const email = v.email(b.email);
  const pw = v.password(b.password);
  const school_id = v.int(b.school_id, 'school_id', { label: 'School' });
  if (!(await query('SELECT 1 FROM schools WHERE school_id = ?', [school_id])).length)
    throw new AppError(400, 'VALIDATION_ERROR', 'Please choose a valid school.', { field: 'school_id' });
  const hash = await bcrypt.hash(pw, 12);
  let id;
  try {
    const [r] = await pool.execute(
      "INSERT INTO users (full_name, student_number, email, password_hash, school_id, role) VALUES (?, ?, ?, ?, ?, 'user')",
      [full_name, student_number, email, hash, school_id]);
    id = r.insertId;
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      const field = /email/i.test(err.message) ? 'email' : 'student_number';
      throw new AppError(409, 'DUPLICATE_ACCOUNT', field === 'email' ? 'An account with this email already exists.' : 'An account with this student/staff number already exists.', { field });
    }
    throw err;
  }
  await audit(id, 'REGISTER', `New account ${email}`);
  const user = await loadFull(id);
  const csrf_token = await startSession(res, id, req);
  res.status(201).json({ user: publicUser(user), csrf_token });
}));

router.post('/login', loginLimiter, asyncHandler(async (req, res) => {
  const em = v.email(req.body?.email);
  const pw = typeof req.body?.password === 'string' ? req.body.password : '';
  const rows = await query('SELECT u.*, s.school_name FROM users u JOIN schools s ON s.school_id = u.school_id WHERE u.email = ?', [em]);
  const user = rows[0];
  // Always run bcrypt (even when locked or unknown) so response times do not reveal anything.
  const ok = await bcrypt.compare(pw, user ? user.password_hash : DUMMY_HASH);
  const lockedFor = user ? await lockout.lockRemaining(user.user_id) : lockout.ghostRemaining(em);
  if (lockedFor > 0) {
    await audit(user?.user_id ?? null, 'LOGIN_FAILED', `Login refused for ${em}: account locked`);
    throw new AppError(429, 'ACCOUNT_LOCKED', lockout.lockedMessage(lockedFor), { retry_after_s: lockedFor });
  }
  if (!user || !ok) {
    const r = user ? await lockout.recordFailure(user.user_id) : lockout.ghostFailure(em);
    await audit(user?.user_id ?? null, 'LOGIN_FAILED', `Failed login for ${em}`);
    if (r.locked && user) await audit(user.user_id, 'ACCOUNT_LOCKED', `Locked for ${r.minutes} min after ${config.lockoutThreshold} failed logins`);
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password.');
  }
  if (user.failed_logins || user.lock_count) await lockout.recordSuccess(user.user_id);
  await audit(user.user_id, 'LOGIN');
  // Logging in from a browser that still holds another session ends that one first.
  const previous = await loadSession(req);
  if (previous?.session) await revokeSession(previous.session.hash);
  const csrf_token = await startSession(res, user.user_id, req);
  res.json({ user: publicUser(user), csrf_token });
}));

router.post('/logout', requireAuth, asyncHandler(async (req, res) => {
  await revokeSession(req.session.hash);
  clearSessionCookie(res);
  await audit(req.user.user_id, 'LOGOUT');
  res.json({ ok: true });
}));

// Ends every session of this account, on every device.
router.post('/logout-all', requireAuth, asyncHandler(async (req, res) => {
  const n = await revokeUserSessions(req.user.user_id);
  clearSessionCookie(res);
  await audit(req.user.user_id, 'LOGOUT_ALL', `Ended ${n} session(s)`);
  res.json({ ok: true, ended: n });
}));

router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  res.json({ user: publicUser(await loadFull(req.user.user_id)), csrf_token: req.session.csrf });
}));

// For the page on load: who is logged in (if anyone) and the CSRF token. Always 200.
router.get('/session', asyncHandler(async (req, res) => {
  const s = await loadSession(req);
  if (s?.expired) clearSessionCookie(res);
  if (!s?.user) return res.json({ user: null });
  res.json({ user: publicUser(await loadFull(s.user.user_id)), csrf_token: s.session.csrf });
}));

// Forgot password: emails a single-use link. The answer is the same whether or not the account
// exists, and the email is sent in the background so the response time does not tell either.
router.post('/forgot-password', resetLimiter, asyncHandler(async (req, res) => {
  const em = v.email(req.body?.email);
  const [user] = await query('SELECT user_id, full_name, email FROM users WHERE email = ?', [em]);
  if (user) {
    const r = await issueReset(user, req.ip);
    await audit(user.user_id, 'PASSWORD_RESET_REQUEST', r ? 'Reset link emailed' : 'Ignored: 3 requests in the last hour');
  }
  res.json({ ok: true, message: 'If an account uses that email, we have sent it a link to reset the password. Check your inbox (and spam folder).' });
}));

const findReset = async (conn, token, lock = false) => {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  const [[row]] = await conn.execute(
    `SELECT reset_id, user_id FROM password_resets
      WHERE token_hash = ? AND used_at IS NULL AND expires_at > UTC_TIMESTAMP()${lock ? ' FOR UPDATE' : ''}`, [hashToken(token)]);
  return row || null;
};
const BAD_TOKEN = () => new AppError(400, 'INVALID_RESET_TOKEN', 'This reset link is invalid, has already been used or has expired. Request a new one.');

// Lets the reset page say up front whether the link still works.
router.post('/reset-password/verify', resetLimiter, asyncHandler(async (req, res) => {
  res.json({ valid: !!(await findReset(pool, req.body?.token)) });
}));

router.post('/reset-password', resetLimiter, asyncHandler(async (req, res) => {
  const pw = v.password(req.body?.new_password, 'new_password'); // validate first: a weak password does not use up the link
  const hash = await bcrypt.hash(pw, 12);
  const userId = await withTransaction(async (conn) => {
    const row = await findReset(conn, req.body?.token, true); // row lock: the same link cannot be used twice at once
    if (!row) throw BAD_TOKEN();
    await conn.execute('UPDATE password_resets SET used_at = UTC_TIMESTAMP() WHERE user_id = ? AND used_at IS NULL', [row.user_id]);
    await conn.execute('UPDATE users SET password_hash = ?, failed_logins = 0, lock_count = 0, locked_until = NULL WHERE user_id = ?', [hash, row.user_id]);
    await revokeUserSessions(row.user_id, { conn }); // log out everywhere: whoever knew the old password is out
    return row.user_id;
  });
  await audit(userId, 'PASSWORD_RESET', 'Password reset with an emailed link');
  res.json({ ok: true });
}));

router.post('/change-password', requireAuth, asyncHandler(async (req, res) => {
  const cur = (await query('SELECT password_hash FROM users WHERE user_id = ?', [req.user.user_id]))[0];
  if (!(await bcrypt.compare(String(req.body?.current_password ?? ''), cur.password_hash)))
    throw new AppError(400, 'WRONG_PASSWORD', 'Your current password is incorrect.', { field: 'current_password' });
  const pw = v.password(req.body?.new_password, 'new_password');
  await query('UPDATE users SET password_hash = ? WHERE user_id = ?', [await bcrypt.hash(pw, 12), req.user.user_id]);
  const ended = await revokeUserSessions(req.user.user_id, { except: req.session.hash }); // other devices are logged out
  await audit(req.user.user_id, 'PASSWORD_CHANGE', ended ? `Ended ${ended} other session(s)` : null);
  res.json({ ok: true, other_sessions_ended: ended });
}));

export default router;
