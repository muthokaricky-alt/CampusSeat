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

const SECRET_HINT = 'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"';

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
  jwtSecret: read('JWT_SECRET', { required: true, minLength: 32, hint: SECRET_HINT }),
  jwtExpiresIn: read('JWT_EXPIRES_IN', { def: '8h' }),
  // Raises every rate limit by this factor. Only for automated tests: refused in production.
  rateLimitScale: read('RATE_LIMIT_SCALE', { def: 1, int: true, min: 1, max: 1000 }),
};

// Database variables are read by db-config.js; validate them here so startup fails clearly.
read('DB_HOST', { prodRequired: true });
read('DB_USER', { prodRequired: true });
read('DB_PASSWORD', { prodRequired: true });
read('DB_NAME', { prodRequired: true });
read('DB_PORT', { int: true, min: 1, max: 65535 });
read('DB_SSL', { oneOf: ['true', 'false'] });

if (isProd && config.rateLimitScale !== 1) problems.push('RATE_LIMIT_SCALE must not be set in production (it weakens the login rate limits).');

if (problems.length) {
  console.error(`\nCampusSeat cannot start: ${problems.length} configuration problem(s) (NODE_ENV=${NODE_ENV}):\n${problems.map((p) => `  - ${p}`).join('\n')}\n\nSee backend/.env.example for every setting.\n`);
  process.exit(1);
}
