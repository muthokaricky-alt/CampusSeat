import crypto from 'node:crypto';
import QRCode from 'qrcode';
import { pool } from './db.js';
import { keyedHash, open, seal } from './secretBox.js';
import { newSecret, otpauthUri, base32Encode, verifyTotp } from './totp.js';

/** Two-factor login (TOTP + one-time backup codes). Optional, for administrators. */
const BACKUP_COUNT = 10;
const CHALLENGE_MINUTES = 5;
export const CHALLENGE_MAX_ATTEMPTS = 5;
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export async function status(userId) {
  const [[u]] = await pool.execute('SELECT totp_enabled_at FROM users WHERE user_id = ?', [userId]);
  const [[{ left }]] = await pool.execute('SELECT COUNT(*) AS `left` FROM backup_codes WHERE user_id = ? AND used_at IS NULL', [userId]);
  return { enabled: !!u?.totp_enabled_at, backup_codes_left: Number(left) };
}

/** Step 1: a new secret, stored encrypted but not active until a code from the app confirms it. */
export async function beginSetup(user) {
  const secret = newSecret();
  await pool.execute('UPDATE users SET totp_secret_enc = ?, totp_enabled_at = NULL, totp_last_step = NULL WHERE user_id = ?', [seal(secret), user.user_id]);
  const uri = otpauthUri({ secret, account: user.email });
  // QR as a data: URL (allowed by the CSP's img-src 'self' data:) so no third-party QR service sees the secret.
  const qr = await QRCode.toDataURL(uri, { margin: 1, width: 240, errorCorrectionLevel: 'M' });
  return { otpauth_uri: uri, qr_data_url: qr, secret: base32Encode(secret).match(/.{1,4}/g).join(' ') };
}

async function secretOf(userId) {
  const [[u]] = await pool.execute('SELECT totp_secret_enc, totp_enabled_at, totp_last_step FROM users WHERE user_id = ?', [userId]);
  if (!u?.totp_secret_enc) return null;
  return { secret: open(u.totp_secret_enc), enabled: !!u.totp_enabled_at, lastStep: u.totp_last_step === null ? null : Number(u.totp_last_step) };
}

/** Accepts a TOTP code once: the time step is claimed atomically, so a replay (or a race) fails. */
async function acceptTotp(userId, s, code) {
  const step = verifyTotp(s.secret, code, { lastStep: s.lastStep });
  if (step === null) return false;
  const [r] = await pool.execute(
    'UPDATE users SET totp_last_step = ? WHERE user_id = ? AND (totp_last_step IS NULL OR totp_last_step < ?)', [step, userId, step]);
  return r.affectedRows === 1;
}

/** Step 2: confirm with a code from the app. Turns 2FA on and returns the backup codes (shown once). */
export async function confirmSetup(userId, code) {
  const s = await secretOf(userId);
  if (!s || s.enabled) return null;
  if (!(await acceptTotp(userId, s, code))) return null;
  await pool.execute('UPDATE users SET totp_enabled_at = UTC_TIMESTAMP() WHERE user_id = ?', [userId]);
  return regenerateBackupCodes(userId);
}

export async function disable(userId) {
  await pool.execute('UPDATE users SET totp_secret_enc = NULL, totp_enabled_at = NULL, totp_last_step = NULL WHERE user_id = ?', [userId]);
  await pool.execute('DELETE FROM backup_codes WHERE user_id = ?', [userId]);
}

const normCode = (c) => String(c ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export async function regenerateBackupCodes(userId) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I mix-ups; 10 chars = 50 bits
  const codes = Array.from({ length: BACKUP_COUNT }, () => {
    const raw = Array.from(crypto.randomBytes(10), (b) => alphabet[b % 32]).join('');
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
  await pool.execute('DELETE FROM backup_codes WHERE user_id = ?', [userId]);
  for (const c of codes) await pool.execute('INSERT INTO backup_codes (user_id, code_hash) VALUES (?, ?)', [userId, keyedHash(normCode(c))]);
  return codes;
}

/**
 * Checks a second factor for an enabled account: a 6-digit app code, or a backup code
 * (spaces, dashes and case are ignored). Returns 'totp', 'backup' or null.
 */
export async function verifySecondFactor(userId, code) {
  const s = await secretOf(userId);
  if (!s?.enabled) return null;
  const clean = String(code ?? '').replace(/\s/g, '');
  if (/^\d{6}$/.test(clean)) return (await acceptTotp(userId, s, clean)) ? 'totp' : null;
  const n = normCode(code);
  if (n.length !== 10) return null;
  const [r] = await pool.execute(
    'UPDATE backup_codes SET used_at = UTC_TIMESTAMP() WHERE user_id = ? AND code_hash = ? AND used_at IS NULL', [userId, keyedHash(n)]);
  return r.affectedRows === 1 ? 'backup' : null;
}

// ---- login challenges (password accepted, second factor pending)
export async function createChallenge(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  await pool.execute('DELETE FROM login_challenges WHERE expires_at < UTC_TIMESTAMP()');
  await pool.execute('INSERT INTO login_challenges (challenge_hash, user_id, expires_at) VALUES (?, ?, UTC_TIMESTAMP() + INTERVAL ? MINUTE)',
    [sha256(token), userId, CHALLENGE_MINUTES]);
  return token;
}

/** Returns { userId, attempts } for a live challenge, or null. */
export async function findChallenge(token) {
  if (typeof token !== 'string' || token.length > 100) return null;
  const [[c]] = await pool.execute(
    'SELECT user_id, attempts FROM login_challenges WHERE challenge_hash = ? AND expires_at > UTC_TIMESTAMP()', [sha256(token)]);
  return c ? { userId: c.user_id, attempts: c.attempts } : null;
}

/** Counts a wrong code; the challenge is dropped after CHALLENGE_MAX_ATTEMPTS. Returns attempts left. */
export async function failChallenge(token) {
  await pool.execute('UPDATE login_challenges SET attempts = attempts + 1 WHERE challenge_hash = ?', [sha256(token)]);
  const [[c]] = await pool.execute('SELECT attempts FROM login_challenges WHERE challenge_hash = ?', [sha256(token)]);
  const left = CHALLENGE_MAX_ATTEMPTS - Number(c?.attempts ?? CHALLENGE_MAX_ATTEMPTS);
  if (left <= 0) await endChallenge(token);
  return left;
}

export const endChallenge = (token) => pool.execute('DELETE FROM login_challenges WHERE challenge_hash = ?', [sha256(token)]);
