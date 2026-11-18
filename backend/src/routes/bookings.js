import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { AppError, asyncHandler } from '../utils/errors.js';
import * as v from '../utils/validate.js';
import { audit } from '../utils/audit.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { buildCard } from '../utils/pdf.js';
import { isoFields } from '../utils/time.js';
import { listParams } from '../utils/list.js';
import * as seats from '../seats.js';
import { config } from '../config.js';

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
      const event = await seats.lockEvent(conn, eventId); // first statement: see seats.js
      if (!event) throw new AppError(404, 'NOT_FOUND', 'Event not found.');
      if (event.is_past) throw new AppError(409, 'EVENT_PAST', 'This event has already taken place.');

      const [dup] = await conn.execute('SELECT booking_id FROM bookings WHERE user_id = ? AND event_id = ?', [me.user_id, eventId]);
      if (dup.length) throw new AppError(409, 'DUPLICATE_BOOKING', 'You have already booked a seat for this event.');

      const allowed = await seats.allowedSchools(conn, eventId);
      if (allowed.length && !allowed.some((s) => s.school_id === me.school_id))
        throw new AppError(403, 'NOT_ELIGIBLE', `This event is open to ${allowed.map((s) => s.school_name).join(', ')} only.`);

      const n = await seats.bookedCount(conn, eventId);
      if (n >= event.capacity) throw new AppError(409, 'EVENT_FULL', 'Sorry, this event is full. You can join the waitlist and get the next free seat.', { waitlist: true });

      const b = await seats.insertBooking(conn, me.user_id, eventId);
      await audit(req, 'BOOK_SEAT', { entity: ['booking', b.booking_id], after: { event_id: eventId, user_id: me.user_id, booking_ref: b.booking_ref }, details: `Event #${eventId} "${event.title}", ref ${b.booking_ref}`, conn });
      return { ...b, event_id: eventId, seats_remaining: event.capacity - n - 1 };
    });
    res.status(201).json({ booking });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw new AppError(409, 'DUPLICATE_BOOKING', 'You have already booked a seat for this event.');
    throw err;
  }
}));

const BOOKING_SELECT = `
  SELECT b.booking_id, b.booking_ref, b.booked_at, b.event_id,
         e.title, e.venue, e.event_date, e.start_time, e.end_time, e.starts_at, e.ends_at,
         u.user_id, u.full_name, u.student_number, u.email, s.school_name
  FROM bookings b
  JOIN events e ON e.event_id = b.event_id
  JOIN users u ON u.user_id = b.user_id
  JOIN schools s ON s.school_id = u.school_id`;

router.get('/mine', requireAuth, asyncHandler(async (req, res) => {
  const lp = listParams(req.query, { sorts: { date: 'e.starts_at', booked_at: 'b.booked_at' }, defaultSort: 'date', defaultDir: 'desc', tiebreak: 'b.booking_id' });
  const where = ['b.user_id = ?']; const params = [req.user.user_id];
  if (req.query.event_id) { where.push('b.event_id = ?'); params.push(v.int(req.query.event_id, 'event_id')); }
  const [{ total }] = await query(`SELECT COUNT(*) AS total FROM bookings b WHERE ${where.join(' AND ')}`, params);
  const rows = await query(`${BOOKING_SELECT} WHERE ${where.join(' AND ')} ${lp.orderBy} ${lp.limitSql}`, params);
  res.json({ bookings: rows.map((r) => isoFields(r)), meta: lp.meta(total) });
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
  const lp = listParams(req.query, {
    sorts: { booked_at: 'b.booked_at', name: 'u.full_name', event: 'e.title', ref: 'b.booking_ref', school: 's.school_name' },
    defaultSort: 'booked_at', defaultDir: 'desc', tiebreak: 'b.booking_id',
  });
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const [{ total }] = await query(`SELECT COUNT(*) AS total FROM bookings b JOIN users u ON u.user_id = b.user_id ${whereSql}`, params);
  const rows = await query(`${BOOKING_SELECT} ${whereSql} ${lp.orderBy} ${lp.limitSql}`, params);
  res.json({ bookings: rows.map((r) => isoFields(r)), meta: lp.meta(total) });
}));

/**
 * Cancel a booking: its owner (until CANCEL_CUTOFF_HOURS before the start) or an admin (any time).
 * The freed seat goes to the first person on the waitlist in the same transaction.
 */
router.delete('/:id', requireAuth, asyncHandler(async (req, res) => {
  const id = v.int(req.params.id, 'id');
  const isAdmin = req.user.role === 'admin';
  // Find the event OUTSIDE the transaction (see rule 2 in seats.js), then lock it first.
  const [found] = await query('SELECT event_id, user_id FROM bookings WHERE booking_id = ?', [id]);
  if (!found || (found.user_id !== req.user.user_id && !isAdmin)) throw new AppError(404, 'NOT_FOUND', 'Booking not found.');
  const result = await withTransaction(async (conn) => {
    const event = await seats.lockEvent(conn, found.event_id);
    const [[b]] = await conn.execute('SELECT booking_id, booking_ref, user_id FROM bookings WHERE booking_id = ? FOR UPDATE', [id]);
    if (!event || !b) throw new AppError(404, 'NOT_FOUND', 'Booking not found.'); // cancelled meanwhile
    const own = b.user_id === req.user.user_id;
    if (!isAdmin) {
      if (event.is_past) throw new AppError(409, 'EVENT_PAST', 'This event has already taken place.');
      const cut = seats.cancelCutoff(event);
      if (!cut.allowed) {
        throw new AppError(409, 'CANCEL_CUTOFF', `Bookings can be cancelled up to ${config.cancelCutoffHours} hour${config.cancelCutoffHours === 1 ? '' : 's'} before the event starts. Please contact the organisers.`, { deadline: cut.deadline });
      }
    }
    await conn.execute('DELETE FROM bookings WHERE booking_id = ?', [id]);
    await audit(req, 'CANCEL_BOOKING', {
      entity: ['booking', id], before: { event_id: event.event_id, user_id: b.user_id, booking_ref: b.booking_ref },
      details: `Booking ${b.booking_ref} for event #${event.event_id} "${event.title}" cancelled ${own ? 'by its owner' : 'by admin'}`, conn });
    const promoted = await seats.promoteWaitlist(conn, event, req);
    return { event, promoted };
  });
  seats.notifyPromoted(result.event, result.promoted);
  res.json({ ok: true, promoted: result.promoted.length });
}));

// My waitlist places, with my position in each queue.
router.get('/waitlist', requireAuth, asyncHandler(async (req, res) => {
  const rows = await query(
    `SELECT w.waitlist_id, w.event_id, w.created_at, e.title, e.venue, e.event_date, e.start_time, e.end_time, e.starts_at, e.ends_at,
            (SELECT COUNT(*) FROM waitlist w2 WHERE w2.event_id = w.event_id AND w2.status = 'waiting' AND w2.waitlist_id <= w.waitlist_id) AS position
       FROM waitlist w JOIN events e ON e.event_id = w.event_id
      WHERE w.user_id = ? AND w.status = 'waiting' AND e.ends_at >= UTC_TIMESTAMP() ORDER BY e.starts_at LIMIT 100`, [req.user.user_id]);
  res.json({ waitlist: rows.map((r) => isoFields({ ...r, position: Number(r.position) })), meta: { page: 1, limit: 100, total: rows.length, pages: 1, sort: 'date', dir: 'asc' } });
}));

export default router;
