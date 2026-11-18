import crypto from 'node:crypto';

/**
 * Time-based one-time passwords (RFC 6238, the codes shown by Google Authenticator, Microsoft
 * Authenticator, 1Password, ...). HMAC-SHA1, 30-second steps, 6 digits: what every app supports.
 * Implemented on node:crypto directly; checked against the RFC test vectors in the e2e tests.
 */
export const STEP_S = 30;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0, value = 0; const out = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error('invalid base32');
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

/** HOTP (RFC 4226) for a counter. */
export function hotp(secret, counter, digits = 6, algorithm = 'sha1') {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac(algorithm, secret).update(msg).digest();
  const o = h[h.length - 1] & 0xf;
  const bin = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export const stepAt = (ms = Date.now()) => Math.floor(ms / 1000 / STEP_S);
export const totp = (secret, ms = Date.now(), digits = 6, algorithm = 'sha1') => hotp(secret, stepAt(ms), digits, algorithm);

/**
 * Checks a code, allowing one step of clock drift either way. Returns the matched time step, or null.
 * Pass lastStep (the step of the last accepted code) to refuse replays of an already used code.
 */
export function verifyTotp(secret, code, { lastStep = null, window = 1, now = Date.now() } = {}) {
  const c = String(code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const cur = stepAt(now);
  let match = null;
  for (let s = cur - window; s <= cur + window; s++) {
    // Compare every candidate (no early exit) and in constant time.
    if (crypto.timingSafeEqual(Buffer.from(hotp(secret, s)), Buffer.from(c)) && match === null) match = s;
  }
  if (match === null || (lastStep !== null && match <= lastStep)) return null;
  return match;
}

export const newSecret = () => crypto.randomBytes(20); // 160 bits, the RFC 4226 recommendation

export const otpauthUri = ({ secret, account, issuer = 'CampusSeat' }) =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${base32Encode(secret)}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP_S}`;
