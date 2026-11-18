import crypto from 'node:crypto';
import { config } from './config.js';
import { logger } from './logger.js';

/**
 * AES-256-GCM encryption for small secrets stored in the database (two-factor secrets).
 * Format: v1.<iv>.<tag>.<ciphertext>, all base64url. The key (TOTP_ENC_KEY) lives only in the
 * environment, so a copy of the database alone does not reveal anyone's second factor.
 */
let key;
function getKey() {
  if (key) return key;
  if (config.totpEncKey) key = Buffer.from(config.totpEncKey, 'base64');
  else {
    // Development convenience only: production refuses to start without TOTP_ENC_KEY (config.js).
    logger.warn('TOTP_ENC_KEY is not set: using a fixed development key. Never do this in production.');
    key = crypto.createHash('sha256').update('campusseat-development-only-key').digest();
  }
  return key;
}

export function seal(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const data = Buffer.concat([c.update(plain), c.final()]);
  return ['v1', iv, c.getAuthTag(), data].map((x) => (typeof x === 'string' ? x : x.toString('base64url'))).join('.');
}

export function open(sealed) {
  const [v, iv, tag, data] = String(sealed).split('.');
  if (v !== 'v1') throw new Error('unknown secret format');
  const d = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]);
}

/** Keyed hash (HMAC-SHA256) for one-time codes: useless without the key even if the table leaks. */
export const keyedHash = (s) => crypto.createHmac('sha256', getKey()).update(s).digest('hex');
