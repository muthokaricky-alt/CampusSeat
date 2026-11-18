import { Router } from 'express';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { query } from '../db.js';
import { AppError, asyncHandler } from '../utils/errors.js';
import * as v from '../utils/validate.js';
import { audit } from '../utils/audit.js';
import { requireAdmin } from '../middleware/auth.js';
import { revokeUserSessions } from '../sessions.js';
import { unlock } from '../lockout.js';
import { issueReset } from '../passwordReset.js';
import { listParams } from '../utils/list.js';
import { buildReport, toCsv } from '../utils/pdf.js';
import { isoFields, localDayRangeUtc, localToday, offsetString, sqlToLocal } from '../utils/time.js';

const router = Router();
const shiftDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
router.use(requireAdmin);

router.get('/stats', asyncHandler(async (_req, res) => {
  const tz = offsetString();
  const today = localToday();
  // Day boundaries are Nairobi days, compared in UTC.
  const { start: start14 } = localDayRangeUtc(shiftDays(today, -13), null); // 14 days for sparklines
  const { start: start7 } = localDayRangeUtc(shiftDays(today, -6), null); // this week (last 7 days)
  const [totals] = await query(`SELECT
      (SELECT COUNT(*) FROM events WHERE ends_at >= UTC_TIMESTAMP()) AS upcoming_events,
      (SELECT COUNT(*) FROM bookings) AS total_bookings,
      (SELECT COUNT(*) FROM users) AS total_users,
      (SELECT COUNT(*) FROM events) AS total_events,
      (SELECT COUNT(*) FROM waitlist w JOIN events e ON e.event_id = w.event_id WHERE w.status = 'waiting' AND e.ends_at >= UTC_TIMESTAMP()) AS waiting,
      (SELECT COALESCE(SUM(capacity), 0) FROM events WHERE ends_at >= UTC_TIMESTAMP()) AS upcoming_seats,
      (SELECT COUNT(*) FROM bookings b JOIN events e ON e.event_id = b.event_id WHERE e.ends_at >= UTC_TIMESTAMP()) AS upcoming_booked`);
  const [week] = await query(`SELECT
      SUM(booked_at >= ?) AS bookings, SUM(booked_at < ?) AS bookings_prev
    FROM bookings WHERE booked_at >= ?`, [start7, start7, start14]);
  const [users] = await query(`SELECT
      SUM(created_at >= ?) AS users, SUM(created_at < ?) AS users_prev
    FROM users WHERE created_at >= ?`, [start7, start7, start14]);
  const almostFull = await query(`
    SELECT e.event_id, e.title, e.event_date, e.capacity,
           (SELECT COUNT(*) FROM bookings b WHERE b.event_id = e.event_id) AS booked,
           (SELECT COUNT(*) FROM waitlist w WHERE w.event_id = e.event_id AND w.status = 'waiting') AS waiting
    FROM events e
    WHERE e.ends_at >= UTC_TIMESTAMP()
      AND (SELECT COUNT(*) FROM bookings b WHERE b.event_id = e.event_id) >= e.capacity * 0.8
    ORDER BY e.starts_at LIMIT 10`);
  const recent = await query(`
    SELECT b.booking_id, b.booking_ref, b.booked_at, u.full_name, e.title, e.event_id
    FROM bookings b JOIN users u ON u.user_id = b.user_id JOIN events e ON e.event_id = b.event_id
    ORDER BY b.booked_at DESC, b.booking_id DESC LIMIT 8`);
  // Bookings and sign-ups per Nairobi calendar day, last 14 days, with empty days filled in.
  const perDayRows = await query(`
    SELECT DATE(CONVERT_TZ(booked_at, '+00:00', ?)) AS day, COUNT(*) AS n FROM bookings
    WHERE booked_at >= ? GROUP BY day ORDER BY day`, [tz, start14]);
  const signupRows = await query(`
    SELECT DATE(CONVERT_TZ(created_at, '+00:00', ?)) AS day, COUNT(*) AS n FROM users
    WHERE created_at >= ? GROUP BY day ORDER BY day`, [tz, start14]);
  const series = (rows) => {
    const m = new Map(rows.map((r) => [String(r.day).slice(0, 10), Number(r.n)]));
    return Array.from({ length: 14 }, (_, i) => { const day = shiftDays(today, i - 13); return { day, n: m.get(day) || 0 }; });
  };
  const num = (o) => Object.fromEntries(Object.entries(o).map(([k, x]) => [k, Number(x ?? 0)]));
  const perDay = series(perDayRows);
  res.json({
    totals: num(totals),
    week: { ...num(week), ...num(users) },
    almost_full: almostFull.map((r) => ({ ...r, booked: Number(r.booked), waiting: Number(r.waiting) })),
    recent: recent.map((r) => isoFields(r)),
    per_day: perDay.slice(-7), // kept for older clients: the last 7 days
    per_day_14: perDay,
    signups_14: series(signupRows),
  });
}));

/* ---------- Event picker for admin filters (id, title, date of every event, newest first) ---------- */
router.get('/event-options', asyncHandler(async (_req, res) => {
  const events = await query('SELECT event_id, title, event_date FROM events ORDER BY starts_at DESC, event_id DESC LIMIT 2000');
  res.json({ events, meta: { page: 1, limit: 2000, total: events.length, pages: 1, sort: 'date', dir: 'desc' } });
}));

/* ---------- Users ---------- */
router.get('/users', asyncHandler(async (req, res) => {
  const params = []; let where = '';
  if (req.query.search) {
    const p = v.likePattern(String(req.query.search).slice(0, 100));
    where = 'WHERE u.full_name LIKE ? OR u.email LIKE ? OR u.student_number LIKE ?'; params.push(p, p, p);
  }
  const lp = listParams(req.query, {
    sorts: { created: 'u.created_at', name: 'u.full_name', email: 'u.email', bookings: 'bookings', role: 'u.role' },
    defaultSort: 'created', defaultDir: 'desc', tiebreak: 'u.user_id',
  });
  const [{ total }] = await query(`SELECT COUNT(*) AS total FROM users u ${where}`, params);
  const users = await query(`
    SELECT u.user_id, u.full_name, u.student_number, u.email, u.role, u.created_at, s.school_name,
           IF(u.locked_until > UTC_TIMESTAMP(), u.locked_until, NULL) AS locked_until, (u.totp_enabled_at IS NOT NULL) AS two_factor,
           (SELECT COUNT(*) FROM bookings b WHERE b.user_id = u.user_id) AS bookings
    FROM users u JOIN schools s ON s.school_id = u.school_id ${where} ${lp.orderBy} ${lp.limitSql}`, params);
  res.json({
    users: users.map((u) => isoFields({ ...u, bookings: Number(u.bookings), two_factor: !!Number(u.two_factor) }, ['created_at', 'locked_until'])),
    meta: lp.meta(total),
  });
}));

router.patch('/users/:id', asyncHandler(async (req, res) => {
  const id = v.int(req.params.id, 'id');
  const role = req.body?.role;
  if (!['user', 'admin'].includes(role)) throw new AppError(400, 'VALIDATION_ERROR', 'Role must be "user" or "admin".', { field: 'role' });
  if (id === req.user.user_id) throw new AppError(400, 'SELF_CHANGE', 'You cannot change your own role.');
  const [u] = await query('SELECT email, role FROM users WHERE user_id = ?', [id]);
  if (!u) throw new AppError(404, 'NOT_FOUND', 'User not found.');
  await query('UPDATE users SET role = ? WHERE user_id = ?', [role, id]);
  await revokeUserSessions(id); // the person logs in again under the new role
  await audit(req, 'CHANGE_ROLE', { entity: ['user', id], before: { role: u.role }, after: { role }, details: `${u.email} is now ${role}` });
  res.json({ ok: true });
}));

router.post('/users/:id/unlock', asyncHandler(async (req, res) => {
  const id = v.int(req.params.id, 'id');
  const [u] = await query('SELECT email FROM users WHERE user_id = ?', [id]);
  if (!u) throw new AppError(404, 'NOT_FOUND', 'User not found.');
  await unlock(id);
  await audit(req, 'ACCOUNT_UNLOCK', { entity: ['user', id], details: `Unlocked ${u.email}` });
  res.json({ ok: true });
}));

// Preferred over a temporary password: the person picks their own via an emailed link.
router.post('/users/:id/send-reset-email', asyncHandler(async (req, res) => {
  const id = v.int(req.params.id, 'id');
  const [u] = await query('SELECT user_id, full_name, email FROM users WHERE user_id = ?', [id]);
  if (!u) throw new AppError(404, 'NOT_FOUND', 'User not found.');
  const r = await issueReset(u, req.ip);
  if (!r) throw new AppError(429, 'TOO_MANY_RESETS', 'A reset link was already sent 3 times in the last hour. Try again later.');
  await audit(req, 'ADMIN_SEND_RESET', { entity: ['user', id], details: `Sent a password reset link to ${u.email}` });
  res.json({ ok: true, sent: await r.sent });
}));

router.post('/users/:id/reset-password', asyncHandler(async (req, res) => {
  const id = v.int(req.params.id, 'id');
  const [u] = await query('SELECT email FROM users WHERE user_id = ?', [id]);
  if (!u) throw new AppError(404, 'NOT_FOUND', 'User not found.');
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const temp = Array.from(crypto.randomBytes(10), (b) => alphabet[b % alphabet.length]).join('') + '7a';
  await query('UPDATE users SET password_hash = ? WHERE user_id = ?', [await bcrypt.hash(temp, 12), id]);
  await revokeUserSessions(id); // whoever was logged in with the old password is logged out
  await unlock(id);
  await audit(req, 'ADMIN_RESET_PASSWORD', { entity: ['user', id], details: `Set a temporary password for ${u.email}` });
  res.json({ temporary_password: temp });
}));

router.delete('/users/:id', asyncHandler(async (req, res) => {
  const id = v.int(req.params.id, 'id');
  if (id === req.user.user_id) throw new AppError(400, 'SELF_CHANGE', 'You cannot delete your own account.');
  const [u] = await query('SELECT email, full_name, student_number, role, school_id FROM users WHERE user_id = ?', [id]);
  if (!u) throw new AppError(404, 'NOT_FOUND', 'User not found.');
  try {
    await query('DELETE FROM users WHERE user_id = ?', [id]);
  } catch (err) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2' || err.errno === 1451)
      throw new AppError(409, 'IN_USE', 'This user has bookings or created events, so the account cannot be deleted. Cancel their bookings first.');
    throw err;
  }
  await audit(req, 'DELETE_USER', { entity: ['user', id], before: u, details: `Deleted ${u.email}` });
  res.json({ ok: true });
}));

/* Audit logs: see routes/audit.js */

/* ---------- Reports (PDF / CSV / JSON), with filtering and sorting ---------- */
const BOOKING_COLS = [
  { key: 'booking_ref', label: 'Booking ref', w: 1.3 }, { key: 'full_name', label: 'Name', w: 1.6 },
  { key: 'student_number', label: 'Student no.', w: 1.1 }, { key: 'school_name', label: 'School', w: 1.8 },
  { key: 'title', label: 'Event', w: 1.8 }, { key: 'event_date', label: 'Event date', w: 1.1 }, { key: 'booked_at', label: 'Booked at (EAT)', w: 1.3 },
];
const EVENT_COLS = [
  { key: 'title', label: 'Event', w: 2.2 }, { key: 'event_date', label: 'Date', w: 1 }, { key: 'venue', label: 'Venue', w: 1.5 },
  { key: 'capacity', label: 'Capacity', w: 0.8 }, { key: 'booked', label: 'Booked', w: 0.8 }, { key: 'remaining', label: 'Seats left', w: 0.9 },
  { key: 'fill', label: 'Filled', w: 0.8 }, { key: 'restriction', label: 'Open to', w: 1.6 },
];
const SORTS = {
  bookings: { booked_at: 'b.booked_at', name: 'u.full_name', event: 'e.title', school: 's.school_name', ref: 'b.booking_ref' },
  events: { date: 'e.event_date', title: 'e.title', booked: 'booked', capacity: 'e.capacity' },
};

router.get('/reports/:type', asyncHandler(async (req, res) => {
  const type = req.params.type;
  if (!['bookings', 'events'].includes(type)) throw new AppError(404, 'NOT_FOUND', 'Unknown report.');
  const format = ['pdf', 'csv', 'json'].includes(req.query.format) ? req.query.format : 'json';
  const dir = req.query.dir === 'asc' ? 'ASC' : 'DESC';
  const sortCol = SORTS[type][req.query.sort] || Object.values(SORTS[type])[0];
  const filters = []; const where = []; const params = [];
  const from = req.query.from ? v.date(req.query.from, 'from', 'From date') : null;
  const to = req.query.to ? v.date(req.query.to, 'to', 'To date') : null;
  let rows; let columns; let totals;

  if (type === 'bookings') {
    columns = BOOKING_COLS;
    if (req.query.event_id) { const id = v.int(req.query.event_id, 'event_id'); where.push('b.event_id = ?'); params.push(id);
      const [e] = await query('SELECT title FROM events WHERE event_id = ?', [id]); filters.push(`Event: ${e ? e.title : '#' + id}`); }
    if (req.query.school_id) { const id = v.int(req.query.school_id, 'school_id'); where.push('u.school_id = ?'); params.push(id);
      const [s] = await query('SELECT school_name FROM schools WHERE school_id = ?', [id]); filters.push(`School: ${s ? s.school_name : '#' + id}`); }
    const range = localDayRangeUtc(from, to); // Nairobi days -> UTC range
    if (range.start) { where.push('b.booked_at >= ?'); params.push(range.start); }
    if (range.end) { where.push('b.booked_at < ?'); params.push(range.end); }
    if (from || to) filters.push(`Booked between: ${from || 'start'} and ${to || 'today'}`);
    rows = await query(`
      SELECT b.booking_ref, u.full_name, u.student_number, s.school_name, e.title, e.event_date, b.booked_at
      FROM bookings b JOIN users u ON u.user_id = b.user_id JOIN schools s ON s.school_id = u.school_id JOIN events e ON e.event_id = b.event_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${sortCol} ${dir}, b.booking_id`, params);
    // Reports are read by people: show booking times in Nairobi time (the JSON format keeps ISO UTC).
    rows = rows.map((r) => ({ ...r, booked_at: format === 'json' ? isoFields({ booked_at: r.booked_at }).booked_at : sqlToLocal(r.booked_at) }));
    totals = [`Total bookings: ${rows.length}`];
  } else {
    columns = EVENT_COLS;
    if (from) { where.push('e.event_date >= ?'); params.push(from); }
    if (to) { where.push('e.event_date <= ?'); params.push(to); }
    if (from || to) filters.push(`Event dates: ${from || 'start'} to ${to || 'end'}`);
    const raw = await query(`
      SELECT e.title, e.event_date, e.venue, e.capacity,
        (SELECT COUNT(*) FROM bookings b WHERE b.event_id = e.event_id) AS booked,
        (SELECT GROUP_CONCAT(s.school_name SEPARATOR ', ') FROM event_schools es JOIN schools s ON s.school_id = es.school_id WHERE es.event_id = e.event_id) AS restriction
      FROM events e ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${sortCol} ${dir}`, params);
    rows = raw.map((r) => ({ ...r, booked: Number(r.booked), remaining: r.capacity - Number(r.booked),
      fill: `${Math.round((Number(r.booked) / r.capacity) * 100)}%`, restriction: r.restriction || 'Everyone' }));
    const seats = rows.reduce((a, r) => a + r.capacity, 0); const booked = rows.reduce((a, r) => a + r.booked, 0);
    totals = [`Events: ${rows.length}`, `Seats booked: ${booked} of ${seats}${seats ? ` (${Math.round((booked / seats) * 100)}%)` : ''}`];
  }
  const { format: _f, ...usedFilters } = req.query;
  await audit(req, 'GENERATE_REPORT', { entity: ['report', type], after: { format, filters: usedFilters, rows: rows.length }, details: `${type} report (${format}), ${rows.length} row(s)` });
  const stamp = localToday();
  const title = type === 'bookings' ? 'Bookings report' : 'Events summary report';
  if (format === 'pdf') return buildReport(res, { title, filters, columns, rows, totals, filename: `campusseat-${type}-${stamp}.pdf`, orientation: 'landscape' });
  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="campusseat-${type}-${stamp}.csv"`);
    return res.send('﻿' + toCsv(columns, rows));
  }
  res.json({ title, filters, columns, rows, totals });
}));

export default router;
