import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { AppError, asyncHandler } from '../utils/errors.js';
import * as v from '../utils/validate.js';
import { audit } from '../utils/audit.js';
import { requireAdmin } from '../middleware/auth.js';
import { isoFields } from '../utils/time.js';

/**
 * Door check-in. The registration card's QR code holds the booking reference (CS-2026-00081);
 * staff scan it, or type it, and the person is marked as attended.
 */
const router = Router();
router.use(requireAdmin);

// Check-in is open from 3 hours before the start until 3 hours after the end.
const OPEN_BEFORE_H = 3;
const OPEN_AFTER_H = 3;

/** Accepts what people actually type or scanners send: case, spaces and missing dashes do not matter. */
export function normaliseRef(raw) {
  const s = String(raw ?? '').toUpperCase().replace(/[\s_]/g, '');
  const m = /^CS-?(\d{4})-?(\d{3,})$/.exec(s);
  return m ? `CS-${m[1]}-${m[2].padStart(5, '0')}` : null;
}

const DETAIL = `
  SELECT b.booking_id, b.booking_ref, b.event_id, u.full_name, u.student_number, s.school_name,
         e.title AS event_title, e.starts_at, e.ends_at,
         e.starts_at - INTERVAL ${OPEN_BEFORE_H} HOUR <= UTC_TIMESTAMP() AS opened,
         e.ends_at + INTERVAL ${OPEN_AFTER_H} HOUR >= UTC_TIMESTAMP() AS not_closed,
         c.checked_in_at, cu.full_name AS checked_in_by_name
    FROM bookings b
    JOIN users u ON u.user_id = b.user_id
    JOIN schools s ON s.school_id = u.school_id
    JOIN events e ON e.event_id = b.event_id
    LEFT JOIN check_ins c ON c.booking_id = b.booking_id
    LEFT JOIN users cu ON cu.user_id = c.checked_in_by`;

const counts = async (eventId) => {
  const [r] = await query(
    `SELECT (SELECT COUNT(*) FROM bookings WHERE event_id = ?) AS booked,
            (SELECT COUNT(*) FROM check_ins c JOIN bookings b ON b.booking_id = c.booking_id WHERE b.event_id = ?) AS checked_in`, [eventId, eventId]);
  return { booked: Number(r.booked), checked_in: Number(r.checked_in) };
};
const person = (r) => isoFields({
  booking_id: r.booking_id, booking_ref: r.booking_ref, event_id: r.event_id, event_title: r.event_title,
  full_name: r.full_name, student_number: r.student_number, school_name: r.school_name,
  checked_in_at: r.checked_in_at, checked_in_by: r.checked_in_by_name || null,
}, ['checked_in_at']);

router.post('/check-in', asyncHandler(async (req, res) => {
  const ref = normaliseRef(req.body?.ref);
  if (!ref) throw new AppError(400, 'VALIDATION_ERROR', 'That does not look like a booking reference (CS-2026-00081).', { field: 'ref' });
  const eventId = req.body?.event_id ? v.int(req.body.event_id, 'event_id') : null;
  const [b] = await query(`${DETAIL} WHERE b.booking_ref = ?`, [ref]);
  if (!b) throw new AppError(404, 'NOT_FOUND', `No booking ${ref}. It may have been cancelled, or the reference is mistyped.`);
  if (eventId && b.event_id !== eventId) {
    throw new AppError(409, 'WRONG_EVENT', `This ticket is for "${b.event_title}", not this event.`, { person: person(b) });
  }
  if (!Number(b.opened)) throw new AppError(409, 'NOT_OPEN_YET', `Check-in for "${b.event_title}" opens ${OPEN_BEFORE_H} hours before it starts.`, { person: person(b) });
  if (!Number(b.not_closed)) throw new AppError(409, 'CHECK_IN_CLOSED', `"${b.event_title}" has finished; check-in is closed.`, { person: person(b) });
  if (b.checked_in_at) {
    throw new AppError(409, 'ALREADY_CHECKED_IN', `${b.full_name} was already checked in.`, { person: person(b), counts: await counts(b.event_id) });
  }
  try {
    await withTransaction(async (conn) => {
      await conn.execute('INSERT INTO check_ins (booking_id, checked_in_by) VALUES (?, ?)', [b.booking_id, req.user.user_id]);
      await audit(req, 'CHECK_IN', { entity: ['booking', b.booking_id], after: { booking_ref: ref, event_id: b.event_id }, details: `${b.full_name} checked in to "${b.event_title}" (${ref})`, conn });
    });
  } catch (err) {
    // Two scanners at the same door: the second one loses the race and is told so.
    if (err.code === 'ER_DUP_ENTRY') throw new AppError(409, 'ALREADY_CHECKED_IN', `${b.full_name} was already checked in.`, { person: person(b) });
    throw err;
  }
  const [after] = await query(`${DETAIL} WHERE b.booking_id = ?`, [b.booking_id]);
  res.status(201).json({ check_in: person(after), counts: await counts(b.event_id) });
}));

// Undo a mistaken check-in.
router.delete('/check-in/:bookingId', asyncHandler(async (req, res) => {
  const id = v.int(req.params.bookingId, 'bookingId');
  const [b] = await query(`${DETAIL} WHERE b.booking_id = ?`, [id]);
  if (!b || !b.checked_in_at) throw new AppError(404, 'NOT_CHECKED_IN', 'This booking is not checked in.');
  await query('DELETE FROM check_ins WHERE booking_id = ?', [id]);
  await audit(req, 'CHECK_IN_UNDO', { entity: ['booking', id], before: { booking_ref: b.booking_ref, checked_in_at: b.checked_in_at }, details: `Check-in undone for ${b.full_name} at "${b.event_title}" (${b.booking_ref})` });
  res.json({ ok: true, counts: await counts(b.event_id) });
}));

// Events where check-in is open right now (for the door screen's event picker).
router.get('/check-in/events', asyncHandler(async (_req, res) => {
  const rows = await query(`
    SELECT e.event_id, e.title, e.event_date, e.start_time, e.end_time, e.venue,
           (SELECT COUNT(*) FROM bookings b WHERE b.event_id = e.event_id) AS booked,
           (SELECT COUNT(*) FROM check_ins c JOIN bookings b ON b.booking_id = c.booking_id WHERE b.event_id = e.event_id) AS checked_in
      FROM events e
     WHERE e.starts_at - INTERVAL ${OPEN_BEFORE_H} HOUR <= UTC_TIMESTAMP() AND e.ends_at + INTERVAL ${OPEN_AFTER_H} HOUR >= UTC_TIMESTAMP()
     ORDER BY e.starts_at`);
  res.json({ events: rows.map((r) => ({ ...r, booked: Number(r.booked), checked_in: Number(r.checked_in) })) });
}));

export default router;
