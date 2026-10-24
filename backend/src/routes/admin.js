import { Router } from 'express';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { query } from '../db.js';
import { AppError, asyncHandler } from '../utils/errors.js';
import * as v from '../utils/validate.js';
import { audit } from '../utils/audit.js';
import { requireAdmin } from '../middleware/auth.js';
import { buildReport, toCsv } from '../utils/pdf.js';

const router = Router();
router.use(requireAdmin);

router.get('/stats', asyncHandler(async (_req, res) => {
  const [totals] = await query(`SELECT
      (SELECT COUNT(*) FROM events WHERE TIMESTAMP(event_date, end_time) >= NOW()) AS upcoming_events,
      (SELECT COUNT(*) FROM bookings) AS total_bookings,
      (SELECT COUNT(*) FROM users) AS total_users,
      (SELECT COUNT(*) FROM events) AS total_events`);
  const almostFull = await query(`
    SELECT e.event_id, e.title, e.event_date, e.capacity,
           (SELECT COUNT(*) FROM bookings b WHERE b.event_id = e.event_id) AS booked
    FROM events e
    WHERE TIMESTAMP(e.event_date, e.end_time) >= NOW()
      AND (SELECT COUNT(*) FROM bookings b WHERE b.event_id = e.event_id) >= e.capacity * 0.8
    ORDER BY e.event_date LIMIT 10`);
  const recent = await query(`
    SELECT b.booking_id, b.booking_ref, b.booked_at, u.full_name, e.title
    FROM bookings b JOIN users u ON u.user_id = b.user_id JOIN events e ON e.event_id = b.event_id
    ORDER BY b.booked_at DESC, b.booking_id DESC LIMIT 8`);
  const perDay = await query(`
    SELECT DATE(booked_at) AS day, COUNT(*) AS n FROM bookings
    WHERE booked_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY) GROUP BY DATE(booked_at) ORDER BY day`);
  const num = (o) => Object.fromEntries(Object.entries(o).map(([k, x]) => [k, Number(x)]));
  res.json({ totals: num(totals), almost_full: almostFull.map((r) => ({ ...r, booked: Number(r.booked) })), recent, per_day: perDay.map((r) => ({ day: r.day, n: Number(r.n) })) });
}));

/* ---------- Users ---------- */
router.get('/users', asyncHandler(async (req, res) => {
  const params = []; let where = '';
  if (req.query.search) {
    const p = v.likePattern(String(req.query.search).slice(0, 100));
    where = 'WHERE u.full_name LIKE ? OR u.email LIKE ? OR u.student_number LIKE ?'; params.push(p, p, p);
  }
  const users = await query(`
    SELECT u.user_id, u.full_name, u.student_number, u.email, u.role, u.created_at, s.school_name,
           (SELECT COUNT(*) FROM bookings b WHERE b.user_id = u.user_id) AS bookings
    FROM users u JOIN schools s ON s.school_id = u.school_id ${where} ORDER BY u.created_at DESC LIMIT 500`, params);
  res.json({ users: users.map((u) => ({ ...u, bookings: Number(u.bookings) })) });
}));

router.patch('/users/:id', asyncHandler(async (req, res) => {
  const id = v.int(req.params.id, 'id');
  const role = req.body?.role;
  if (!['user', 'admin'].includes(role)) throw new AppError(400, 'VALIDATION_ERROR', 'Role must be "user" or "admin".', { field: 'role' });
  if (id === req.user.user_id) throw new AppError(400, 'SELF_CHANGE', 'You cannot change your own role.');
  const [u] = await query('SELECT email FROM users WHERE user_id = ?', [id]);
  if (!u) throw new AppError(404, 'NOT_FOUND', 'User not found.');
  await query('UPDATE users SET role = ? WHERE user_id = ?', [role, id]);
  await audit(req.user.user_id, 'CHANGE_ROLE', `${u.email} is now ${role}`);
  res.json({ ok: true });
}));

router.post('/users/:id/reset-password', asyncHandler(async (req, res) => {
  const id = v.int(req.params.id, 'id');
  const [u] = await query('SELECT email FROM users WHERE user_id = ?', [id]);
  if (!u) throw new AppError(404, 'NOT_FOUND', 'User not found.');
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const temp = Array.from(crypto.randomBytes(10), (b) => alphabet[b % alphabet.length]).join('') + '7a';
  await query('UPDATE users SET password_hash = ? WHERE user_id = ?', [await bcrypt.hash(temp, 12), id]);
  await audit(req.user.user_id, 'ADMIN_RESET_PASSWORD', `Reset password for ${u.email}`);
  res.json({ temporary_password: temp });
}));

router.delete('/users/:id', asyncHandler(async (req, res) => {
  const id = v.int(req.params.id, 'id');
  if (id === req.user.user_id) throw new AppError(400, 'SELF_CHANGE', 'You cannot delete your own account.');
  const [u] = await query('SELECT email FROM users WHERE user_id = ?', [id]);
  if (!u) throw new AppError(404, 'NOT_FOUND', 'User not found.');
  try {
    await query('DELETE FROM users WHERE user_id = ?', [id]);
  } catch (err) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2' || err.errno === 1451)
      throw new AppError(409, 'IN_USE', 'This user has bookings or created events, so the account cannot be deleted. Cancel their bookings first.');
    throw err;
  }
  await audit(req.user.user_id, 'DELETE_USER', `Deleted ${u.email}`);
  res.json({ ok: true });
}));

/* ---------- Audit logs ---------- */
router.get('/audit-logs', asyncHandler(async (req, res) => {
  const where = []; const params = [];
  if (req.query.action) { where.push('a.action = ?'); params.push(String(req.query.action).slice(0, 100)); }
  if (req.query.search) {
    const p = v.likePattern(String(req.query.search).slice(0, 100));
    where.push('(u.full_name LIKE ? OR u.email LIKE ? OR a.details LIKE ?)'); params.push(p, p, p);
  }
  if (req.query.from) { where.push('a.logged_at >= ?'); params.push(`${v.date(req.query.from, 'from')} 00:00:00`); }
  if (req.query.to) { where.push('a.logged_at <= ?'); params.push(`${v.date(req.query.to, 'to')} 23:59:59`); }
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const page = Math.max(Number(req.query.page) || 1, 1);
  const base = `FROM audit_logs a LEFT JOIN users u ON u.user_id = a.user_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`;
  const [{ total }] = await query(`SELECT COUNT(*) AS total ${base}`, params);
  const logs = await query(
    `SELECT a.log_id, a.action, a.details, a.logged_at, u.full_name, u.email ${base} ORDER BY a.logged_at DESC, a.log_id DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`, params);
  const actions = (await query('SELECT DISTINCT action FROM audit_logs ORDER BY action')).map((r) => r.action);
  res.json({ logs, total: Number(total), page, limit, actions });
}));

/* ---------- Reports (PDF / CSV / JSON), with filtering and sorting ---------- */
const BOOKING_COLS = [
  { key: 'booking_ref', label: 'Booking ref', w: 1.3 }, { key: 'full_name', label: 'Name', w: 1.6 },
  { key: 'student_number', label: 'Student no.', w: 1.1 }, { key: 'school_name', label: 'School', w: 1.8 },
  { key: 'title', label: 'Event', w: 1.8 }, { key: 'event_date', label: 'Event date', w: 1.1 }, { key: 'booked_at', label: 'Booked at', w: 1.3 },
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
    if (from) { where.push('DATE(b.booked_at) >= ?'); params.push(from); }
    if (to) { where.push('DATE(b.booked_at) <= ?'); params.push(to); }
    if (from || to) filters.push(`Booked between: ${from || 'start'} and ${to || 'today'}`);
    rows = await query(`
      SELECT b.booking_ref, u.full_name, u.student_number, s.school_name, e.title, e.event_date, b.booked_at
      FROM bookings b JOIN users u ON u.user_id = b.user_id JOIN schools s ON s.school_id = u.school_id JOIN events e ON e.event_id = b.event_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${sortCol} ${dir}, b.booking_id`, params);
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
  await audit(req.user.user_id, 'GENERATE_REPORT', `${type} report (${format})`);
  const stamp = new Date().toISOString().slice(0, 10);
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
