import crypto from 'node:crypto';
import { config } from '../config.js';
import { AppError, asyncHandler } from '../utils/errors.js';
import { clearSessionCookie, loadSession } from '../sessions.js';

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Loads the logged-in user from the session cookie (once per request).
 * Only the httpOnly cookie is accepted: Authorization headers are ignored on purpose.
 */
async function loadUser(req, res) {
  if (req.authLoaded) return req.user;
  req.authLoaded = true;
  const s = await loadSession(req);
  if (s?.expired) {
    clearSessionCookie(res);
    req.sessionExpired = true;
    return (req.user = null);
  }
  req.user = s?.user ?? null;
  req.session = s?.session ?? null;
  return req.user;
}

const sameToken = (a, b) => typeof a === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * CSRF protection for cookie sessions, two layers:
 * 1. Origin check on every unsafe request: a browser always sends Origin on cross-site POSTs, so a
 *    foreign Origin (or Referer) is refused. Requests without either (curl, tests) cannot carry a
 *    victim's cookies, so they pass this layer.
 * 2. Synchronizer token: an unsafe request made with a session must send X-CSRF-Token equal to the
 *    session's secret token, which a page on another site cannot read.
 */
export function originCheck(req, _res, next) {
  if (!UNSAFE.has(req.method)) return next();
  const origin = req.get('origin') || (req.get('referer') ? safeOrigin(req.get('referer')) : null);
  if (!origin) return next();
  const own = `${req.protocol}://${req.get('host')}`;
  const allowed = new Set([config.appUrl, own, ...(config.isProd ? [] : [config.clientOrigin])]);
  if (!allowed.has(origin)) return next(new AppError(403, 'CSRF_FAILED', 'This request came from another website and was blocked.'));
  next();
}
const safeOrigin = (u) => { try { return new URL(u).origin; } catch { return 'invalid'; } };

function csrfCheck(req) {
  if (!UNSAFE.has(req.method) || !req.session) return;
  if (!sameToken(req.get('x-csrf-token'), req.session.csrf)) {
    throw new AppError(403, 'CSRF_FAILED', 'Your session security token is missing or out of date. Reload the page and try again.');
  }
}

export const requireAuth = asyncHandler(async (req, res, next) => {
  const user = await loadUser(req, res);
  if (!user) {
    throw req.sessionExpired
      ? new AppError(401, 'SESSION_EXPIRED', 'Your session has expired. Please log in again.')
      : new AppError(401, 'AUTH_REQUIRED', 'Please log in to continue.');
  }
  csrfCheck(req);
  next();
});

export const optionalAuth = asyncHandler(async (req, res, next) => {
  await loadUser(req, res);
  csrfCheck(req);
  next();
});

export const requireAdmin = [
  requireAuth,
  (req, _res, next) => {
    if (req.user.role !== 'admin') return next(new AppError(403, 'FORBIDDEN', 'Administrator access required.'));
    next();
  },
];
