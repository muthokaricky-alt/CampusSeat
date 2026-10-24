import { AppError } from './errors.js';

const fail = (field, message) => {
  throw new AppError(400, 'VALIDATION_ERROR', message, { field });
};

export const str = (v, field, { min = 1, max = 255, label = field } = {}) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.length < min) fail(field, `${label} is required${min > 1 ? ` (at least ${min} characters)` : ''}.`);
  if (s.length > max) fail(field, `${label} must be at most ${max} characters.`);
  return s;
};

export const optionalStr = (v, field, { max = 5000, label = field } = {}) => {
  if (v === undefined || v === null || v === '') return null;
  return str(v, field, { max, label });
};

export const email = (v, field = 'email') => {
  const s = str(v, field, { max: 100, label: 'Email' }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) fail(field, 'Enter a valid email address.');
  return s;
};

export const password = (v, field = 'password') => {
  if (typeof v !== 'string' || v.length < 8) fail(field, 'Password must be at least 8 characters.');
  if (v.length > 72) fail(field, 'Password must be at most 72 characters.');
  if (!/[A-Za-z]/.test(v) || !/\d/.test(v)) fail(field, 'Password must contain at least one letter and one number.');
  return v;
};

export const int = (v, field, { min = 1, max = 1_000_000, label = field } = {}) => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (!Number.isInteger(n) || n < min || n > max) fail(field, `${label} must be a whole number between ${min} and ${max}.`);
  return n;
};

export const date = (v, field, label = field) => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) fail(field, `${label} must be a valid date (YYYY-MM-DD).`);
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) fail(field, `${label} is not a real calendar date.`);
  return v;
};

export const time = (v, field, label = field) => {
  if (typeof v !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(v)) fail(field, `${label} must be a valid time (HH:MM).`);
  return v.length === 5 ? `${v}:00` : v;
};

export const idList = (v, field) => {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) fail(field, `${field} must be a list.`);
  return [...new Set(v.map((x) => int(x, field)))];
};

/** Escape % and _ so user text is matched literally inside LIKE. */
export const likePattern = (s) => `%${String(s).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
