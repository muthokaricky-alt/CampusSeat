import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { AppError, asyncHandler } from '../utils/errors.js';
import * as v from '../utils/validate.js';
import { audit } from '../utils/audit.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { buildCard } from '../utils/pdf.js';

const router = Router();
const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * THE MAIN TRANSACTION: book a seat.
 * Everything runs in ONE database transaction and starts by locking the event row
 * (SELECT ... FOR UPDATE), so two people booking the last seat at the same moment are
 * processed one after the other and an event can never be overbooked.
 */
router.post('/', requireAuth, asyncHandler(async (req, res) => {
  const b = req.body || {};
  const eventId = v.int(b.event_id, 'event_id', { label: 'Event' });
  const full_name = v.str(b.full_name, 'full_name', { min: 2, max: 100, label: 'Full name' });
  const student_number = v.str(b.student_number, 'student_number', { min: 3, max: 30, label: 'Student/staff number' });
  const school_id = v.int(b.school_id, 'school_id', { label: 'School' });

  const me = (await query('SELECT user_id, full_name, student_number, school_id FROM users WHERE user_id = ?', [req.user.user_id]))[0];
  // The submitted credentials must match the logged-in account.
  if (norm(full_name) !== norm(me.full_name) || norm(student_number) !== norm(me.student_number) || school_id !== me.school_id)
    throw new AppError(400, 'CREDENTIALS_MISMATCH', 'The name, student number or school you entered does not match your account.');

  try {
    const booking = await withTransaction(async (conn) => {
      const [[event]] = await conn.execute('SELECT * FROM events WHERE event_id = ? FOR UPDATE', [eventId]);
      if (!event) throw new AppError(404, 'NOT_FOUND', 'Event not found.');
      const [[past]] = await conn.execute('SELECT TIMESTAMP(?, ?) < NOW() AS p', [event.event_date, event.end_time]);
      if (Number(past.p)) throw new AppError(409, 'EVENT_PAST', 'This event has already taken place.');

      const [dup] = await conn.execute('SELECT booking_id FROM bookings WHERE user_id = ? AND event_id = ?', [me.user_id, eventId]);
      if (dup.length) throw new AppError(409, 'DUPLICATE_BOOKING', 'You have already booked a seat for this event.');

      const [allowed] = await conn.execute(
        'SELECT s.school_id, s.school_name FROM event_schools es JOIN schools s ON s.school_id = es.school_id WHERE es.event_id = ?', [eventId]);
      if (allowed.length && !allowed.some((s) => s.school_id === me.school_id))
        throw new AppError(403, 'NOT_ELIGIBLE', `This event is open to ${allowed.map((s) => s.school_name).join(', ')} only.`);

      const [[{ n }]] = await conn.execute('SELECT COUNT(*) AS n FROM bookings WHERE event_id = ?', [eventId]);
      if (n >= event.capacity) throw new AppError(409, 'EVENT_FULL', 'Sorry, this event is full. No seats remain.');

      const tmp = `TMP${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`.slice(0, 20);
      const [ins] = await conn.execute('INSERT INTO bookings (booking_ref, user_id, event_id) VALUES (?, ?, ?)', [tmp, me.user_id, eventId]);
      const ref = `CS-${new Date().getFullYear()}-${String(ins.insertId).padStart(5, '0')}`;
      await conn.execute('UPDATE bookings SET booking_ref = ? WHERE booking_id = ?', [ref, ins.insertId]);
      await audit(me.user_id, 'BOOK_SEAT', `Event #${eventId} "${event.title}", ref ${ref}`, conn);
      return { booking_id: ins.insertId, booking_ref: ref, event_id: eventId, seats_remaining: event.capacity - n - 1 };
    });
    res.status(201).json({ booking });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw new AppError(409, 'DUPLICATE_BOOKING', 'You have already booked a seat for this event.');
    throw err;
  }
}));

const BOOKING_SELECT = `
  SELECT b.booking_id, b.booking_ref, b.booked_at, b.event_id,
         e.title, e.venue, e.event_date, e.start_time, e.end_time,
         u.user_id, u.full_name, u.student_number, u.email, s.school_name
  FROM bookings b
  JOIN events e ON e.event_id = b.event_id
  JOIN users u ON u.user_id = b.user_id
  JOIN schools s ON s.school_id = u.school_id`;

router.get('/mine', requireAuth, asyncHandler(async (req, res) => {
  const rows = await query(`${BOOKING_SELECT} WHERE b.user_id = ? ORDER BY e.event_date DESC, e.start_time DESC`, [req.user.user_id]);
  res.json({ bookings: rows });
}));

router.get('/:id/card', requireAuth, asyncHandler(async (req, res) => {
  const id = v.int(req.params.id, 'id');
  const row = (await query(`${BOOKING_SELECT} WHERE b.booking_id = ?`, [id]))[0];
  if (!row || (row.user_id !== req.user.user_id && req.user.role !== 'admin')) throw new AppError(404, 'NOT_FOUND', 'Booking not found.');
  await buildCard(res, row, `registration-card-${row.booking_ref}.pdf`);
}));

// Admin: bookings per event, with search
router.get('/', requireAdmin, asyncHandler(async (req, res) => {
  const where = []; const params = [];
  if (req.query.event_id) { where.push('b.event_id = ?'); params.push(v.int(req.query.event_id, 'event_id')); }
  if (req.query.search) {
    const p = v.likePattern(String(req.query.search).slice(0, 100));
    where.push('(u.full_name LIKE ? OR u.student_number LIKE ? OR b.booking_ref LIKE ? OR u.email LIKE ?)'); params.push(p, p, p, p);
  }
  const rows = await query(`${BOOKING_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY b.booked_at DESC LIMIT 1000`, params);
  res.json({ bookings: rows });
}));

router.delete('/:id', requireAdmin, asyncHandler(async (req, res) => {
  const id = v.int(req.params.id, 'id');
  const row = (await query('SELECT booking_ref, event_id FROM bookings WHERE booking_id = ?', [id]))[0];
  if (!row) throw new AppError(404, 'NOT_FOUND', 'Booking not found.');
  await query('DELETE FROM bookings WHERE booking_id = ?', [id]);
  await audit(req.user.user_id, 'CANCEL_BOOKING', `Booking ${row.booking_ref} for event #${row.event_id} cancelled by admin`);
  res.json({ ok: true });
}));

export default router;
