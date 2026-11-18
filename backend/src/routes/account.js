import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../db.js';
import { AppError, asyncHandler } from '../utils/errors.js';
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
  await audit(req.user.user_id, '2FA_ENABLE', 'Two-factor login turned on');
  res.json({ ok: true, backup_codes: codes });
}));

router.post('/2fa/disable', asyncHandler(async (req, res) => {
  if (!(await twoFactor.status(req.user.user_id)).enabled) throw new AppError(409, 'NOT_ENABLED', 'Two-factor login is not on.');
  await confirmPassword(req);
  await confirmCode(req);
  await twoFactor.disable(req.user.user_id);
  await audit(req.user.user_id, '2FA_DISABLE', 'Two-factor login turned off');
  res.json({ ok: true });
}));

router.post('/2fa/backup-codes', asyncHandler(async (req, res) => {
  if (!(await twoFactor.status(req.user.user_id)).enabled) throw new AppError(409, 'NOT_ENABLED', 'Two-factor login is not on.');
  await confirmPassword(req);
  await confirmCode(req);
  const codes = await twoFactor.regenerateBackupCodes(req.user.user_id);
  await audit(req.user.user_id, '2FA_BACKUP_REGENERATED', 'New backup codes; the old ones stopped working');
  res.json({ ok: true, backup_codes: codes });
}));

export default router;
