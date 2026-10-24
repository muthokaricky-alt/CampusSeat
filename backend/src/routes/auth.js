import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { query, pool } from '../db.js';
import { AppError, asyncHandler } from '../utils/errors.js';
import * as v from '../utils/validate.js';
import { audit } from '../utils/audit.js';
import { requireAuth, signToken } from '../middleware/auth.js';

const router = Router();
// Rate limits slow down password guessing and mass sign-ups. RATE_LIMIT_SCALE lets tests raise them.
const scale = Number(process.env.RATE_LIMIT_SCALE || 1);
const makeLimiter = (limit, opts = {}) => rateLimit({
  windowMs: 15 * 60 * 1000, limit: limit * scale, standardHeaders: true, legacyHeaders: false, ...opts,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please wait a few minutes and try again.' } },
});
const loginLimiter = makeLimiter(20, { skipSuccessfulRequests: true }); // only failed logins count
const registerLimiter = makeLimiter(30);
const resetLimiter = makeLimiter(10, { skipSuccessfulRequests: true });
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
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
}));

router.post('/login', loginLimiter, asyncHandler(async (req, res) => {
  const em = v.email(req.body?.email);
  const pw = typeof req.body?.password === 'string' ? req.body.password : '';
  const rows = await query('SELECT u.*, s.school_name FROM users u JOIN schools s ON s.school_id = u.school_id WHERE u.email = ?', [em]);
  const user = rows[0];
  const ok = await bcrypt.compare(pw, user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok) {
    await audit(user?.user_id ?? null, 'LOGIN_FAILED', `Failed login for ${em}`);
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password.');
  }
  await audit(user.user_id, 'LOGIN');
  res.json({ token: signToken(user), user: publicUser(user) });
}));

router.post('/logout', requireAuth, asyncHandler(async (req, res) => {
  await audit(req.user.user_id, 'LOGOUT');
  res.json({ ok: true });
}));

router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  res.json({ user: publicUser(await loadFull(req.user.user_id)) });
}));

// Forgot password: the person proves who they are with the email AND student number on the account.
router.post('/forgot-password', resetLimiter, asyncHandler(async (req, res) => {
  const em = v.email(req.body?.email);
  const sn = v.str(req.body?.student_number, 'student_number', { min: 3, max: 30, label: 'Student/staff number' });
  const pw = v.password(req.body?.new_password, 'new_password');
  const rows = await query('SELECT user_id FROM users WHERE email = ? AND student_number = ?', [em, sn]);
  if (!rows.length) throw new AppError(404, 'NO_MATCH', 'No account matches that email and student/staff number.');
  await query('UPDATE users SET password_hash = ? WHERE user_id = ?', [await bcrypt.hash(pw, 12), rows[0].user_id]);
  await audit(rows[0].user_id, 'PASSWORD_RESET', 'Password reset via forgot-password');
  res.json({ ok: true });
}));

router.post('/change-password', requireAuth, asyncHandler(async (req, res) => {
  const cur = (await query('SELECT password_hash FROM users WHERE user_id = ?', [req.user.user_id]))[0];
  if (!(await bcrypt.compare(String(req.body?.current_password ?? ''), cur.password_hash)))
    throw new AppError(400, 'WRONG_PASSWORD', 'Your current password is incorrect.', { field: 'current_password' });
  const pw = v.password(req.body?.new_password, 'new_password');
  await query('UPDATE users SET password_hash = ? WHERE user_id = ?', [await bcrypt.hash(pw, 12), req.user.user_id]);
  await audit(req.user.user_id, 'PASSWORD_CHANGE');
  res.json({ ok: true });
}));

export default router;
