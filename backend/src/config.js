import 'dotenv/config';

/**
 * Environment variables are validated once at startup. Every problem is reported together,
 * with a hint, and the process exits before anything listens on a port.
 */
const env = process.env;
const NODE_ENV = env.NODE_ENV || 'development';
const isProd = NODE_ENV === 'production';
const problems = [];

/** Reads one variable. Options: required (always), prodRequired, def, oneOf, minLength, int, url, hint. */
function read(name, o = {}) {
  const raw = env[name];
  const has = raw !== undefined && raw !== '';
  if (!has) {
    if (o.required || (o.prodRequired && isProd)) {
      problems.push(`${name} is missing${o.prodRequired && !o.required ? ' (required in production)' : ''}.${o.hint ? ' ' + o.hint : ''}`);
    }
    return o.def;
  }
  if (o.oneOf && !o.oneOf.includes(raw)) problems.push(`${name} must be one of: ${o.oneOf.join(', ')} (got "${raw}").`);
  if (o.minLength && raw.length < o.minLength && (isProd || o.alwaysMin)) {
    problems.push(`${name} must be at least ${o.minLength} characters.${o.hint ? ' ' + o.hint : ''}`);
  }
  if (o.int) {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < (o.min ?? -Infinity) || n > (o.max ?? Infinity)) {
      problems.push(`${name} must be a whole number${o.min !== undefined ? ` between ${o.min} and ${o.max}` : ''} (got "${raw}").`);
    }
    return n;
  }
  if (o.url) {
    try { const u = new URL(raw); if (!/^https?:$/.test(u.protocol)) throw new Error(); return u.origin; } catch { problems.push(`${name} must be a full http(s) URL, e.g. https://campusseat.onrender.com (got "${raw}").`); }
  }
  return raw;
}


read('NODE_ENV', { oneOf: ['development', 'test', 'production'] });
export const config = {
  env: NODE_ENV,
  isProd,
  isTest: NODE_ENV === 'test',
  port: read('PORT', { def: 4000, int: true, min: 1, max: 65535 }),
  logLevel: read('LOG_LEVEL', { def: isProd ? 'info' : 'debug', oneOf: ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] }),
  // Public address of the site. Used for links in emails and the CSRF origin check.
  appUrl: read('APP_URL', { prodRequired: true, url: true, def: 'http://localhost:4000', hint: 'Set it to the public site address, e.g. https://campusseat.onrender.com' }),
  // Frontend dev server origin (Vite). Only used outside production.
  clientOrigin: read('CLIENT_ORIGIN', { def: 'http://localhost:5173', url: true }),
  // Login sessions (httpOnly cookie). Secure cookies are mandatory in production (HTTPS).
  cookieSecure: read('COOKIE_SECURE', { def: isProd ? 'true' : 'false', oneOf: ['true', 'false'] }) === 'true',
  sessionIdleMinutes: read('SESSION_IDLE_MINUTES', { def: 120, int: true, min: 5, max: 7 * 24 * 60 }),
  sessionMaxDays: read('SESSION_MAX_DAYS', { def: 7, int: true, min: 1, max: 90 }),
  // Account lockout after repeated failed logins (on top of the per-IP rate limits).
  lockoutThreshold: read('LOCKOUT_THRESHOLD', { def: 5, int: true, min: 3, max: 50 }),
  lockoutMinutes: read('LOCKOUT_MINUTES', { def: 15, int: true, min: 1, max: 1440 }),
  // Encrypts administrators' two-factor secrets at rest: 32 random bytes, base64.
  totpEncKey: read('TOTP_ENC_KEY', { prodRequired: true,
    hint: `Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` }),
  // Password reset links expire after this many minutes.
  resetTokenMinutes: read('RESET_TOKEN_MINUTES', { def: 30, int: true, min: 5, max: 24 * 60 }),
  // Raises every rate limit by this factor. Only for automated tests: refused in production.
  rateLimitScale: read('RATE_LIMIT_SCALE', { def: 1, int: true, min: 1, max: 1000 }),
};

// Outgoing email (password resets, waitlist news). See src/mail/index.js for the drivers.
const mailDriver = read('MAIL_DRIVER', { prodRequired: true, def: NODE_ENV === 'test' ? 'memory' : 'console', oneOf: ['console', 'memory', 'smtp', 'resend'],
  hint: 'Use "smtp" or "resend" in production.' });
config.mail = {
  driver: mailDriver,
  from: read('MAIL_FROM', { def: 'CampusSeat <no-reply@campusseat.local>', required: ['smtp', 'resend'].includes(mailDriver),
    hint: 'e.g. MAIL_FROM="CampusSeat <no-reply@your-domain>" (the domain must be verified with your provider).' }),
  smtp: mailDriver === 'smtp' ? {
    host: read('SMTP_HOST', { required: true }),
    port: read('SMTP_PORT', { def: 587, int: true, min: 1, max: 65535 }),
    secure: read('SMTP_SECURE', { def: 'false', oneOf: ['true', 'false'] }) === 'true',
    user: read('SMTP_USER'),
    pass: read('SMTP_PASS'),
  } : null,
  resendKey: mailDriver === 'resend' ? read('RESEND_API_KEY', { required: true, hint: 'Create one at resend.com > API keys.' }) : null,
};
if (isProd && mailDriver === 'console') problems.push('MAIL_DRIVER=console is for development only: it prints reset links to the log. Use smtp or resend.');
if (mailDriver === 'memory' && NODE_ENV !== 'test') problems.push('MAIL_DRIVER=memory is only allowed when NODE_ENV=test.');

// Database variables are read by db-config.js; validate them here so startup fails clearly.
read('DB_HOST', { prodRequired: true });
read('DB_USER', { prodRequired: true });
read('DB_PASSWORD', { prodRequired: true });
read('DB_NAME', { prodRequired: true });
read('DB_PORT', { int: true, min: 1, max: 65535 });
read('DB_SSL', { oneOf: ['true', 'false'] });

if (config.totpEncKey !== undefined && Buffer.from(config.totpEncKey, 'base64').length !== 32) {
  problems.push('TOTP_ENC_KEY must be 32 random bytes encoded as base64 (44 characters).');
}
if (isProd && !config.cookieSecure) problems.push('COOKIE_SECURE must not be false in production (session cookies need HTTPS).');
if (isProd && config.rateLimitScale !== 1) problems.push('RATE_LIMIT_SCALE must not be set in production (it weakens the login rate limits).');

if (problems.length) {
  console.error(`\nCampusSeat cannot start: ${problems.length} configuration problem(s) (NODE_ENV=${NODE_ENV}):\n${problems.map((p) => `  - ${p}`).join('\n')}\n\nSee backend/.env.example for every setting.\n`);
  process.exit(1);
}
