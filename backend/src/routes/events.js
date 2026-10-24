import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { AppError, asyncHandler } from '../utils/errors.js';
import * as v from '../utils/validate.js';
import { audit } from '../utils/audit.js';
import { optionalAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

// Shared SELECT. seats_remaining is calculated (capacity - bookings), never stored.
const EVENT_SELECT = `
  SELECT e.event_id, e.title, e.description, e.venue, e.event_date, e.start_time, e.end_time, e.capacity, e.created_at,
    (SELECT COUNT(*) FROM bookings b WHERE b.event_id = e.event_id) AS booked,
    e.capacity - (SELECT COUNT(*) FROM bookings b WHERE b.event_id = e.event_id) AS seats_remaining,
    (SELECT GROUP_CONCAT(s.school_name ORDER BY s.school_name SEPARATOR '||') FROM event_schools es JOIN schools s ON s.school_id = es.school_id WHERE es.event_id = e.event_id) AS restricted_names,
    (SELECT GROUP_CONCAT(es.school_id) FROM event_schools es WHERE es.event_id = e.event_id) AS restricted_ids,
    (TIMESTAMP(e.event_date, e.end_time) < NOW()) AS is_past
  FROM events e`;

function shape(row, user) {
  const ids = row.restricted_ids ? row.restricted_ids.split(',').map(Number) : [];
  const out = {
    ...row,
    booked: Number(row.booked),
    seats_remaining: Number(row.seats_remaining),
    is_past: !!Number(row.is_past),
    restricted_to: row.restricted_names ? row.restricted_names.split('||') : [],
    school_ids: ids,
  };
  delete out.restricted_names; delete out.restricted_ids;
  if (user) out.eligible = ids.length === 0 || ids.includes(user.school_id);
  return out;
}

async function withMine(events, user) {
  if (!user || !events.length) return events;
  const rows = await query('SELECT event_id, booking_id, booking_ref FROM bookings WHERE user_id = ?', [user.user_id]);
  const mine = new Map(rows.map((r) => [r.event_id, r]));
  return events.map((e) => ({ ...e, my_booking: mine.get(e.event_id) || null }));
}

// Browse / search upcoming events (admins can pass past=1 to include past ones).
router.get('/', optionalAuth, asyncHandler(async (req, res) => {
  const where = []; const params = [];
  const includePast = req.query.past === '1' && req.user?.role === 'admin';
  if (!includePast) where.push('TIMESTAMP(e.event_date, e.end_time) >= NOW()');
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
  const sql = `${EVENT_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY e.event_date, e.start_time`;
  const rows = (await query(sql, params)).map((r) => shape(r, req.user));
  res.json({ events: await withMine(rows, req.user) });
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
  if (requireFuture && event_date < new Date().toLocaleDateString('en-CA'))
    throw new AppError(400, 'VALIDATION_ERROR', 'The event date cannot be in the past.', { field: 'event_date' });
  const capacity = v.int(body.capacity, 'capacity', { min: 1, max: 100000, label: 'Capacity' });
  const school_ids = v.idList(body.school_ids, 'school_ids');
  if (school_ids.length) {
    const found = await query(`SELECT school_id FROM schools WHERE school_id IN (${school_ids.map(() => '?').join(',')})`, school_ids);
    if (found.length !== school_ids.length) throw new AppError(400, 'VALIDATION_ERROR', 'One of the selected schools does not exist.', { field: 'school_ids' });
  }
  return { title, description, venue, event_date, start_time, end_time, capacity, school_ids };
}

const setSchools = async (conn, eventId, ids) => {
  await conn.execute('DELETE FROM event_schools WHERE event_id = ?', [eventId]);
  for (const sid of ids) await conn.execute('INSERT INTO event_schools (event_id, school_id) VALUES (?, ?)', [eventId, sid]);
};

router.post('/', requireAdmin, asyncHandler(async (req, res) => {
  const e = await parseEvent(req.body || {}, { requireFuture: true });
  const id = await withTransaction(async (conn) => {
    const [r] = await conn.execute(
      'INSERT INTO events (title, description, venue, event_date, start_time, end_time, capacity, created_by) VALUES (?,?,?,?,?,?,?,?)',
      [e.title, e.description, e.venue, e.event_date, e.start_time, e.end_time, e.capacity, req.user.user_id]);
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
  await withTransaction(async (conn) => {
    const [[cur]] = await conn.execute('SELECT event_id FROM events WHERE event_id = ? FOR UPDATE', [id]);
    if (!cur) throw new AppError(404, 'NOT_FOUND', 'Event not found.');
    const [[{ n }]] = await conn.execute('SELECT COUNT(*) AS n FROM bookings WHERE event_id = ?', [id]);
    if (e.capacity < n) throw new AppError(409, 'CAPACITY_TOO_LOW', `Capacity cannot be lower than the ${n} seats already booked.`, { field: 'capacity' });
    await conn.execute(
      'UPDATE events SET title=?, description=?, venue=?, event_date=?, start_time=?, end_time=?, capacity=? WHERE event_id=?',
      [e.title, e.description, e.venue, e.event_date, e.start_time, e.end_time, e.capacity, id]);
    await setSchools(conn, id, e.school_ids);
  });
  await audit(req.user.user_id, 'EDIT_EVENT', `Event #${id} "${e.title}"`);
  const [row] = await query(`${EVENT_SELECT} WHERE e.event_id = ?`, [id]);
  res.json({ event: shape(row, req.user) });
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
