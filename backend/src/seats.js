import { config } from './config.js';
import { localToday } from './utils/time.js';
import { audit } from './utils/audit.js';
import { send } from './mail/index.js';
import { waitlistPromoted } from './mail/templates.js';
import { logger } from './logger.js';

/**
 * Seats, cancellations and the waitlist. Concurrency rules, followed by every caller:
 *
 *  1. Lock order is always: the event row (SELECT ... FOR UPDATE) first, then bookings, then
 *     waitlist rows. Everything that changes who holds a seat for an event (book, cancel, join or
 *     leave the waitlist, change capacity) takes the event lock first, so these run one at a time
 *     per event and cannot deadlock each other.
 *  2. Inside the transaction, do NOT run a plain (non-locking) SELECT before taking the event lock.
 *     Under InnoDB's REPEATABLE READ the first plain read fixes the snapshot; a snapshot taken
 *     before the lock could miss a booking committed while we waited, and the seat count would be
 *     stale. Look things up outside the transaction, then lock the event, then read.
 */

/** Locks and returns the event row (or null). Must be the first statement of the transaction. */
export async function lockEvent(conn, eventId) {
  const [[event]] = await conn.execute(
    'SELECT event_id, title, capacity, starts_at, ends_at, event_date, start_time, ends_at < UTC_TIMESTAMP() AS is_past FROM events WHERE event_id = ? FOR UPDATE',
    [eventId]);
  return event ? { ...event, is_past: !!Number(event.is_past) } : null;
}

export async function bookedCount(conn, eventId) {
  const [[{ n }]] = await conn.execute('SELECT COUNT(*) AS n FROM bookings WHERE event_id = ?', [eventId]);
  return Number(n);
}

/** Schools allowed to book (empty = everyone). */
export async function allowedSchools(conn, eventId) {
  const [rows] = await conn.execute(
    'SELECT s.school_id, s.school_name FROM event_schools es JOIN schools s ON s.school_id = es.school_id WHERE es.event_id = ?', [eventId]);
  return rows;
}

/** Inserts a booking and gives it its reference (CS-<year>-<id>). Caller holds the event lock. */
export async function insertBooking(conn, userId, eventId) {
  const tmp = `TMP${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`.slice(0, 20);
  const [ins] = await conn.execute('INSERT INTO bookings (booking_ref, user_id, event_id) VALUES (?, ?, ?)', [tmp, userId, eventId]);
  const ref = `CS-${localToday().slice(0, 4)}-${String(ins.insertId).padStart(5, '0')}`;
  await conn.execute('UPDATE bookings SET booking_ref = ? WHERE booking_id = ?', [ref, ins.insertId]);
  // Someone who books directly is no longer waiting.
  await conn.execute("DELETE FROM waitlist WHERE event_id = ? AND user_id = ? AND status = 'waiting'", [eventId, userId]);
  return { booking_id: ins.insertId, booking_ref: ref };
}

/**
 * Fills free seats from the waitlist, first come first served. Caller holds the event lock.
 * People no longer eligible (the event was restricted to other schools after they joined) are
 * skipped and taken off the list. Returns the people promoted, for emails after commit.
 */
export async function promoteWaitlist(conn, event, req = null) {
  if (event.is_past) return [];
  let free = event.capacity - (await bookedCount(conn, event.event_id));
  if (free <= 0) return [];
  const allowed = (await allowedSchools(conn, event.event_id)).map((s) => s.school_id);
  const promoted = [];
  while (free > 0) {
    const [[next]] = await conn.execute(
      `SELECT w.waitlist_id, w.user_id, u.full_name, u.email, u.school_id FROM waitlist w JOIN users u ON u.user_id = w.user_id
        WHERE w.event_id = ? AND w.status = 'waiting' ORDER BY w.waitlist_id LIMIT 1 FOR UPDATE`, [event.event_id]);
    if (!next) break;
    if (allowed.length && !allowed.includes(next.school_id)) {
      await conn.execute("UPDATE waitlist SET status = 'removed', updated_at = UTC_TIMESTAMP() WHERE waitlist_id = ?", [next.waitlist_id]);
      continue;
    }
    const b = await insertBooking(conn, next.user_id, event.event_id);
    await conn.execute("UPDATE waitlist SET status = 'promoted', promoted_booking_id = ?, updated_at = UTC_TIMESTAMP() WHERE waitlist_id = ?",
      [b.booking_id, next.waitlist_id]);
    await audit(req, 'WAITLIST_PROMOTE', {
      entity: ['booking', b.booking_id], after: { event_id: event.event_id, user_id: next.user_id, booking_ref: b.booking_ref, waitlist_id: next.waitlist_id },
      details: `Event #${event.event_id} "${event.title}": seat from the waitlist for ${next.email}, ref ${b.booking_ref}`, conn });
    promoted.push({ ...b, user_id: next.user_id, full_name: next.full_name, email: next.email });
    free -= 1;
  }
  return promoted;
}

/** Emails the promoted people. Call after the transaction committed (never inside it). */
export function notifyPromoted(event, promoted) {
  for (const p of promoted) {
    const mail = waitlistPromoted({ name: p.full_name, title: event.title, date: event.event_date, time: event.start_time, ref: p.booking_ref, link: `${config.appUrl}/my-bookings?new=${p.booking_ref}` });
    send({ to: p.email, kind: 'waitlist_promoted', ...mail }).catch((err) => logger.error({ err }, 'promotion email failed'));
  }
}

/** Position in the queue (1 = next) of a waiting entry. */
export async function waitlistPosition(conn, eventId, waitlistId) {
  const [[{ pos }]] = await conn.execute(
    "SELECT COUNT(*) AS pos FROM waitlist WHERE event_id = ? AND status = 'waiting' AND waitlist_id <= ?", [eventId, waitlistId]);
  return Number(pos);
}

/** Can the booking's owner still cancel it? Admins can always cancel. */
export function cancelCutoff(event) {
  const startsAt = new Date(`${String(event.starts_at).replace(' ', 'T')}Z`).getTime();
  const deadline = startsAt - config.cancelCutoffHours * 3600_000;
  return { allowed: Date.now() < deadline, deadline: new Date(deadline).toISOString() };
}
