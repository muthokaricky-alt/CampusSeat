import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { AppError, asyncHandler } from '../utils/errors.js';
import * as v from '../utils/validate.js';
import { audit } from '../utils/audit.js';
import { optionalAuth, requireAdmin, requireAuth } from '../middleware/auth.js';
import { isoFields, localToday, zonedToDate, toSqlUtc } from '../utils/time.js';
import { listParams } from '../utils/list.js';
import * as seats from '../seats.js';

const router = Router();

// Shared SELECT. seats_remaining is calculated (capacity - bookings), never stored.
const EVENT_SELECT = `
  SELECT e.event_id, e.title, e.description, e.venue, e.event_date, e.start_time, e.end_time, e.starts_at, e.ends_at, e.capacity, e.created_at,
    (SELECT COUNT(*) FROM bookings b WHERE b.event_id = e.event_id) AS booked,
    e.capacity - (SELECT COUNT(*) FROM bookings b WHERE b.event_id = e.event_id) AS seats_remaining,
    (SELECT GROUP_CONCAT(s.school_name ORDER BY s.school_name SEPARATOR '||') FROM event_schools es JOIN schools s ON s.school_id = es.school_id WHERE es.event_id = e.event_id) AS restricted_names,
    (SELECT GROUP_CONCAT(es.school_id) FROM event_schools es WHERE es.event_id = e.event_id) AS restricted_ids,
    (SELECT COUNT(*) FROM waitlist w WHERE w.event_id = e.event_id AND w.status = 'waiting') AS waitlist_count,
    (e.ends_at < UTC_TIMESTAMP()) AS is_past
  FROM events e`;

function shape(row, user) {
  const ids = row.restricted_ids ? row.restricted_ids.split(',').map(Number) : [];
  const out = {
    ...row,
    booked: Number(row.booked),
    seats_remaining: Number(row.seats_remaining),
    waitlist_count: Number(row.waitlist_count),
    is_past: !!Number(row.is_past),
    restricted_to: row.restricted_names ? row.restricted_names.split('||') : [],
    school_ids: ids,
  };
  delete out.restricted_names; delete out.restricted_ids;
  isoFields(out);
  if (user) out.eligible = ids.length === 0 || ids.includes(user.school_id);
  return out;
}

async function withMine(events, user) {
  if (!user || !events.length) return events;
  const ids = events.map((e) => e.event_id);
  const marks = ids.map(() => '?').join(',');
  const rows = await query(`SELECT event_id, booking_id, booking_ref FROM bookings WHERE user_id = ? AND event_id IN (${marks})`, [user.user_id, ...ids]);
  const waits = await query(
    `SELECT w.event_id, (SELECT COUNT(*) FROM waitlist w2 WHERE w2.event_id = w.event_id AND w2.status = 'waiting' AND w2.waitlist_id <= w.waitlist_id) AS position
       FROM waitlist w WHERE w.user_id = ? AND w.status = 'waiting' AND w.event_id IN (${marks})`, [user.user_id, ...ids]);
  const mine = new Map(rows.map((r) => [r.event_id, r]));
  const waiting = new Map(waits.map((r) => [r.event_id, { position: Number(r.position) }]));
  return events.map((e) => ({ ...e, my_booking: mine.get(e.event_id) || null, my_waitlist: waiting.get(e.event_id) || null }));
}

// Browse / search upcoming events (admins can pass past=1 to include past ones).
router.get('/', optionalAuth, asyncHandler(async (req, res) => {
  const where = []; const params = [];
  const includePast = req.query.past === '1' && req.user?.role === 'admin';
  if (!includePast) where.push('e.ends_at >= UTC_TIMESTAMP()');
  if (req.query.search) {
    const p = v.likePattern(String(req.query.search).slice(0, 100));
    where.push('(e.title LIKE ? OR e.venue LIKE ? OR e.description LIKE ?)'); params.push(p, p, p);
  }
  if (req.query.from) { where.push('e.event_date >= ?'); params.push(v.date(req.query.from, 'from', 'From date')); }
  if (req.query.to) { where.push('e.event_date <= ?'); params.push(v.date(req.query.to, 'to', 'To date')); }
  if (req.query.school) {
    const sid = v.int(req.query.school, 'school');
    where.push('(NOT EXISTS (SELECT 1 FROM event_schools x WHERE x.event_id = e.event_id) OR EXISTS (SELECT 1 FROM event_schools x WHERE x.event_id = e.event_id AND x.school_id = ?))');
    params.push(sid);
  }
  if (req.query.available === '1') where.push('e.capacity > (SELECT COUNT(*) FROM bookings b WHERE b.event_id = e.event_id)');
  const lp = listParams(req.query, {
    sorts: { date: 'e.starts_at', title: 'e.title', seats: 'seats_remaining', created: 'e.created_at' },
    defaultSort: 'date', tiebreak: 'e.event_id',
  });
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const [{ total }] = await query(`SELECT COUNT(*) AS total FROM events e ${whereSql}`, params);
  const rows = (await query(`${EVENT_SELECT} ${whereSql} ${lp.orderBy} ${lp.limitSql}`, params)).map((r) => shape(r, req.user));
  res.json({ events: await withMine(rows, req.user), meta: lp.meta(total) });
}));

router.get('/:id', optionalAuth, asyncHandler(async (req, res) => {
  const id = v.int(req.params.id, 'id');
  const rows = await query(`${EVENT_SELECT} WHERE e.event_id = ?`, [id]);
  if (!rows.length) throw new AppError(404, 'NOT_FOUND', 'Event not found.');
  const [event] = await withMine([shape(rows[0], req.user)], req.user);
  res.json({ event });
}));

async function parseEvent(body, { requireFuture }) {
  const title = v.str(body.title, 'title', { max: 150, label: 'Title' });
  const description = v.optionalStr(body.description, 'description', { label: 'Description' });
  const venue = v.str(body.venue, 'venue', { max: 150, label: 'Venue' });
  const event_date = v.date(body.event_date, 'event_date', 'Date');
  const start_time = v.time(body.start_time, 'start_time', 'Start time');
  const end_time = v.time(body.end_time, 'end_time', 'End time');
  if (end_time <= start_time) throw new AppError(400, 'VALIDATION_ERROR', 'End time must be later than start time.', { field: 'end_time' });
  // Dates and times are typed in Nairobi time; the database keeps the UTC instants.
  const startsAt = zonedToDate(event_date, start_time);
  const endsAt = zonedToDate(event_date, end_time);
  if (requireFuture && event_date < localToday())
    throw new AppError(400, 'VALIDATION_ERROR', 'The event date cannot be in the past.', { field: 'event_date' });
  if (requireFuture && endsAt <= new Date())
    throw new AppError(400, 'VALIDATION_ERROR', 'This end time has already passed today.', { field: 'end_time' });
  const capacity = v.int(body.capacity, 'capacity', { min: 1, max: 100000, label: 'Capacity' });
  const school_ids = v.idList(body.school_ids, 'school_ids');
  if (school_ids.length) {
    const found = await query(`SELECT school_id FROM schools WHERE school_id IN (${school_ids.map(() => '?').join(',')})`, school_ids);
    if (found.length !== school_ids.length) throw new AppError(400, 'VALIDATION_ERROR', 'One of the selected schools does not exist.', { field: 'school_ids' });
  }
  return { title, description, venue, event_date, start_time, end_time, starts_at: toSqlUtc(startsAt), ends_at: toSqlUtc(endsAt), capacity, school_ids };
}

const setSchools = async (conn, eventId, ids) => {
  await conn.execute('DELETE FROM event_schools WHERE event_id = ?', [eventId]);
  for (const sid of ids) await conn.execute('INSERT INTO event_schools (event_id, school_id) VALUES (?, ?)', [eventId, sid]);
};

router.post('/', requireAdmin, asyncHandler(async (req, res) => {
  const e = await parseEvent(req.body || {}, { requireFuture: true });
  const id = await withTransaction(async (conn) => {
    const [r] = await conn.execute(
      'INSERT INTO events (title, description, venue, event_date, start_time, end_time, starts_at, ends_at, capacity, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [e.title, e.description, e.venue, e.event_date, e.start_time, e.end_time, e.starts_at, e.ends_at, e.capacity, req.user.user_id]);
    await setSchools(conn, r.insertId, e.school_ids);
    return r.insertId;
  });
  await audit(req.user.user_id, 'CREATE_EVENT', `Event #${id} "${e.title}"`);
  const [row] = await query(`${EVENT_SELECT} WHERE e.event_id = ?`, [id]);
  res.status(201).json({ event: shape(row, req.user) });
}));

router.put('/:id', requireAdmin, asyncHandler(async (req, res) => {
  const id = v.int(req.params.id, 'id');
  const e = await parseEvent(req.body || {}, { requireFuture: false });
  const promoted = await withTransaction(async (conn) => {
    const cur = await seats.lockEvent(conn, id); // lock first: see seats.js
    if (!cur) throw new AppError(404, 'NOT_FOUND', 'Event not found.');
    const n = await seats.bookedCount(conn, id);
    if (e.capacity < n) throw new AppError(409, 'CAPACITY_TOO_LOW', `Capacity cannot be lower than the ${n} seats already booked.`, { field: 'capacity' });
    await conn.execute(
      'UPDATE events SET title=?, description=?, venue=?, event_date=?, start_time=?, end_time=?, starts_at=?, ends_at=?, capacity=? WHERE event_id=?',
      [e.title, e.description, e.venue, e.event_date, e.start_time, e.end_time, e.starts_at, e.ends_at, e.capacity, id]);
    await setSchools(conn, id, e.school_ids);
    // More seats (or a later date): give them to the waitlist straight away.
    const [[isPast]] = await conn.execute('SELECT ? < UTC_TIMESTAMP() AS p', [e.ends_at]);
    return seats.promoteWaitlist(conn, { ...cur, title: e.title, capacity: e.capacity, is_past: !!Number(isPast.p) });
  });
  seats.notifyPromoted({ title: e.title, event_date: e.event_date, start_time: e.start_time }, promoted);
  await audit(req.user.user_id, 'EDIT_EVENT', `Event #${id} "${e.title}"${promoted.length ? `; ${promoted.length} promoted from the waitlist` : ''}`);
  const [row] = await query(`${EVENT_SELECT} WHERE e.event_id = ?`, [id]);
  res.json({ event: shape(row, req.user) });
}));

/* ---------- Waitlist ---------- */
// Join the waitlist of a full event. Same lock and checks as booking a seat.
router.post('/:id/waitlist', requireAuth, asyncHandler(async (req, res) => {
  const id = v.int(req.params.id, 'id');
  const [me] = await query('SELECT user_id, school_id FROM users WHERE user_id = ?', [req.user.user_id]);
  try {
    const out = await withTransaction(async (conn) => {
      const event = await seats.lockEvent(conn, id);
      if (!event) throw new AppError(404, 'NOT_FOUND', 'Event not found.');
      if (event.is_past) throw new AppError(409, 'EVENT_PAST', 'This event has already taken place.');
      const [dup] = await conn.execute('SELECT 1 FROM bookings WHERE user_id = ? AND event_id = ?', [me.user_id, id]);
      if (dup.length) throw new AppError(409, 'DUPLICATE_BOOKING', 'You already have a seat for this event.');
      const allowed = await seats.allowedSchools(conn, id);
      if (allowed.length && !allowed.some((s) => s.school_id === me.school_id))
        throw new AppError(403, 'NOT_ELIGIBLE', `This event is open to ${allowed.map((s) => s.school_name).join(', ')} only.`);
      if ((await seats.bookedCount(conn, id)) < event.capacity)
        throw new AppError(409, 'SEATS_AVAILABLE', 'There are seats left, so you can book one straight away.');
      const [[existing]] = await conn.execute('SELECT waitlist_id, status FROM waitlist WHERE event_id = ? AND user_id = ? FOR UPDATE', [id, me.user_id]);
      if (existing?.status === 'waiting') throw new AppError(409, 'ALREADY_WAITING', 'You are already on the waitlist for this event.');
      if (existing) await conn.execute('DELETE FROM waitlist WHERE waitlist_id = ?', [existing.waitlist_id]); // rejoin goes to the back
      const [ins] = await conn.execute('INSERT INTO waitlist (event_id, user_id) VALUES (?, ?)', [id, me.user_id]);
      const position = await seats.waitlistPosition(conn, id, ins.insertId);
      await audit(me.user_id, 'WAITLIST_JOIN', `Event #${id} "${event.title}", position ${position}`, conn);
      return { waitlist_id: ins.insertId, event_id: id, position };
    });
    res.status(201).json({ waitlist: out });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw new AppError(409, 'ALREADY_WAITING', 'You are already on the waitlist for this event.');
    throw err;
  }
}));

router.delete('/:id/waitlist', requireAuth, asyncHandler(async (req, res) => {
  const id = v.int(req.params.id, 'id');
  const left = await withTransaction(async (conn) => {
    const event = await seats.lockEvent(conn, id);
    if (!event) throw new AppError(404, 'NOT_FOUND', 'Event not found.');
    const [r] = await conn.execute("DELETE FROM waitlist WHERE event_id = ? AND user_id = ? AND status = 'waiting'", [id, req.user.user_id]);
    if (r.affectedRows) await audit(req.user.user_id, 'WAITLIST_LEAVE', `Event #${id} "${event.title}"`, conn);
    return r.affectedRows;
  });
  if (!left) throw new AppError(404, 'NOT_WAITING', 'You are not on the waitlist for this event.');
  res.json({ ok: true });
}));

// Admin: who is waiting, in order.
router.get('/:id/waitlist', requireAdmin, asyncHandler(async (req, res) => {
  const id = v.int(req.params.id, 'id');
  const rows = await query(
    `SELECT w.waitlist_id, w.created_at, u.user_id, u.full_name, u.email, u.student_number
       FROM waitlist w JOIN users u ON u.user_id = w.user_id WHERE w.event_id = ? AND w.status = 'waiting' ORDER BY w.waitlist_id LIMIT 1000`, [id]);
  res.json({ waitlist: rows.map((r, i) => isoFields({ ...r, position: i + 1 })), meta: { page: 1, limit: 1000, total: rows.length, pages: 1, sort: 'position', dir: 'asc' } });
}));

router.delete('/:id', requireAdmin, asyncHandler(async (req, res) => {
  const id = v.int(req.params.id, 'id');
  const [ev] = await query('SELECT title, (SELECT COUNT(*) FROM bookings WHERE event_id = ?) AS n FROM events WHERE event_id = ?', [id, id]);
  if (!ev) throw new AppError(404, 'NOT_FOUND', 'Event not found.');
  await query('DELETE FROM events WHERE event_id = ?', [id]); // bookings + restrictions cascade
  await audit(req.user.user_id, 'DELETE_EVENT', `Event #${id} "${ev.title}" (removed ${ev.n} bookings)`);
  res.json({ ok: true, removed_bookings: Number(ev.n) });
}));

export default router;
