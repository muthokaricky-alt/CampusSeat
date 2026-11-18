import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../db.js';
import { AppError, asyncHandler } from '../utils/errors.js';
import * as v from '../utils/validate.js';
import { audit } from '../utils/audit.js';
import { requireAuth } from '../middleware/auth.js';
import * as twoFactor from '../twoFactor.js';

/** The logged-in person's own security settings. Two-factor login is offered to administrators. */
const router = Router();
router.use(requireAuth);

const adminOnly = (req, _res, next) =>
  next(req.user.role === 'admin' ? undefined : new AppError(403, 'FORBIDDEN', 'Two-factor login is available for administrator accounts.'));

/** Sensitive changes need the current password again (someone at an unlocked computer cannot do them). */
async function confirmPassword(req) {
  const [u] = await query('SELECT password_hash FROM users WHERE user_id = ?', [req.user.user_id]);
  if (!(await bcrypt.compare(String(req.body?.password ?? ''), u.password_hash)))
    throw new AppError(400, 'WRONG_PASSWORD', 'Your password is incorrect.', { field: 'password' });
}
async function confirmCode(req) {
  if (!(await twoFactor.verifySecondFactor(req.user.user_id, req.body?.code)))
    throw new AppError(400, 'INVALID_2FA_CODE', 'That code is not right.', { field: 'code' });
}

/* ---------- Profile ---------- */
const norm = (s) => String(s ?? '').trim().replace(/\s+/g, ' ');

router.patch('/profile', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const [cur] = await query('SELECT full_name, student_number, school_id FROM users WHERE user_id = ?', [req.user.user_id]);
  const next = {
    full_name: b.full_name === undefined ? cur.full_name : v.str(norm(b.full_name), 'full_name', { min: 2, max: 100, label: 'Full name' }),
    student_number: b.student_number === undefined ? cur.student_number : v.str(norm(b.student_number).toUpperCase(), 'student_number', { min: 3, max: 30, label: 'Student/staff number' }),
    school_id: b.school_id === undefined ? cur.school_id : v.int(b.school_id, 'school_id', { label: 'School' }),
  };
  const identityChanged = next.student_number.toLowerCase() !== String(cur.student_number).toLowerCase() || next.school_id !== cur.school_id;
  // Student number and school are institutional identity and decide eligibility: confirm with the password.
  if (identityChanged) await confirmPassword(req);
  if (next.school_id !== cur.school_id) {
    if (!(await query('SELECT 1 FROM schools WHERE school_id = ?', [next.school_id])).length)
      throw new AppError(400, 'VALIDATION_ERROR', 'Please choose a valid school.', { field: 'school_id' });
    const [{ n }] = await query(`SELECT
        (SELECT COUNT(*) FROM bookings b JOIN events e ON e.event_id = b.event_id WHERE b.user_id = ? AND e.ends_at >= UTC_TIMESTAMP())
      + (SELECT COUNT(*) FROM waitlist w JOIN events e ON e.event_id = w.event_id WHERE w.user_id = ? AND w.status = 'waiting' AND e.ends_at >= UTC_TIMESTAMP()) AS n`,
      [req.user.user_id, req.user.user_id]);
    // Otherwise someone could switch school to get into a restricted event, then switch back.
    if (Number(n)) throw new AppError(409, 'HAS_UPCOMING_BOOKINGS', 'You can change your school once you have no upcoming bookings or waitlist places. Cancel them first, or ask an administrator.', { field: 'school_id' });
  }
  const before = {}; const after = {};
  for (const k of Object.keys(next)) if (String(next[k]) !== String(cur[k])) { before[k] = cur[k]; after[k] = next[k]; }
  if (!Object.keys(after).length) return res.json({ ok: true, changed: [] });
  try {
    await query('UPDATE users SET full_name = ?, student_number = ?, school_id = ? WHERE user_id = ?',
      [next.full_name, next.student_number, next.school_id, req.user.user_id]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw new AppError(409, 'DUPLICATE_ACCOUNT', 'Another account already uses this student/staff number.', { field: 'student_number' });
    throw err;
  }
  await audit(req, 'PROFILE_UPDATE', { entity: ['user', req.user.user_id], before, after, details: `Changed ${Object.keys(after).join(', ')}` });
  res.json({ ok: true, changed: Object.keys(after) });
}));

router.get('/2fa', asyncHandler(async (req, res) => {
  res.json({ ...(await twoFactor.status(req.user.user_id)), available: req.user.role === 'admin' });
}));

// Step 1: password -> QR code and secret for the authenticator app.
router.post('/2fa/setup', adminOnly, asyncHandler(async (req, res) => {
  if ((await twoFactor.status(req.user.user_id)).enabled) throw new AppError(409, 'ALREADY_ENABLED', 'Two-factor login is already on. Turn it off first to set up a new device.');
  await confirmPassword(req);
  res.json(await twoFactor.beginSetup(req.user));
}));

// Step 2: a code from the app proves it is set up; returns the backup codes, shown only this once.
router.post('/2fa/enable', adminOnly, asyncHandler(async (req, res) => {
  const codes = await twoFactor.confirmSetup(req.user.user_id, req.body?.code);
  if (!codes) throw new AppError(400, 'INVALID_2FA_CODE', 'That code is not right. Scan the QR code again and enter the current 6-digit code.', { field: 'code' });
  await audit(req, '2FA_ENABLE', { actorId: req.user.user_id, entity: ['user', req.user.user_id], details: 'Two-factor login turned on' });
  res.json({ ok: true, backup_codes: codes });
}));

router.post('/2fa/disable', asyncHandler(async (req, res) => {
  if (!(await twoFactor.status(req.user.user_id)).enabled) throw new AppError(409, 'NOT_ENABLED', 'Two-factor login is not on.');
  await confirmPassword(req);
  await confirmCode(req);
  await twoFactor.disable(req.user.user_id);
  await audit(req, '2FA_DISABLE', { actorId: req.user.user_id, entity: ['user', req.user.user_id], details: 'Two-factor login turned off' });
  res.json({ ok: true });
}));

router.post('/2fa/backup-codes', asyncHandler(async (req, res) => {
  if (!(await twoFactor.status(req.user.user_id)).enabled) throw new AppError(409, 'NOT_ENABLED', 'Two-factor login is not on.');
  await confirmPassword(req);
  await confirmCode(req);
  const codes = await twoFactor.regenerateBackupCodes(req.user.user_id);
  await audit(req, '2FA_BACKUP_REGENERATED', { actorId: req.user.user_id, entity: ['user', req.user.user_id], details: 'New backup codes; the old ones stopped working' });
  res.json({ ok: true, backup_codes: codes });
}));

export default router;
