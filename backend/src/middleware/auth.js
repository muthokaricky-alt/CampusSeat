import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../db.js';
import { AppError, asyncHandler } from '../utils/errors.js';

export const signToken = (user) =>
  jwt.sign({ sub: user.user_id }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });

async function loadUser(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  let payload;
  try {
    payload = jwt.verify(header.slice(7), config.jwtSecret);
  } catch {
    throw new AppError(401, 'INVALID_TOKEN', 'Your session has expired. Please log in again.');
  }
  // Read the user fresh each time so role changes and deletions take effect immediately.
  const rows = await query(
    'SELECT user_id, full_name, student_number, email, school_id, role FROM users WHERE user_id = ?',
    [payload.sub],
  );
  if (!rows.length) throw new AppError(401, 'INVALID_TOKEN', 'Account no longer exists.');
  return rows[0];
}

export const requireAuth = asyncHandler(async (req, _res, next) => {
  const user = await loadUser(req);
  if (!user) throw new AppError(401, 'AUTH_REQUIRED', 'Please log in to continue.');
  req.user = user;
  next();
});

export const optionalAuth = asyncHandler(async (req, _res, next) => {
  req.user = (await loadUser(req)) || null;
  next();
});

export const requireAdmin = [
  requireAuth,
  (req, _res, next) => {
    if (req.user.role !== 'admin') return next(new AppError(403, 'FORBIDDEN', 'Administrator access required.'));
    next();
  },
];
