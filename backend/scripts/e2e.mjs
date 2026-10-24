// End-to-end API checks. Needs the API running (npm start) and seeded data (npm run seed).
// Run: npm test            (BASE_URL defaults to http://localhost:4000)
const BASE = process.env.BASE_URL || 'http://localhost:4000';
let pass = 0, failed = 0;
const ok = (cond, name, extra = '') => { cond ? pass++ : failed++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + extra}`); };
const call = async (method, path, body, token) => {
  const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
  return { status: res.status, data, ct };
};
const stamp = Date.now().toString(36);
const mkUser = async (i, school_id) => {
  const r = await call('POST', '/api/auth/register', { full_name: `Test User ${i}`, student_number: `T${stamp}${i}`, email: `t${stamp}${i}@test.local`, password: 'Passw0rd1', school_id });
  return { ...r.data, creds: { full_name: `Test User ${i}`, student_number: `T${stamp}${i}`, school_id }, res: r };
};

const schools = (await call('GET', '/api/schools')).data.schools;
const comp = schools.find((s) => /Computing/.test(s.school_name)).school_id;
const law = schools.find((s) => /Law/.test(s.school_name)).school_id;

// --- auth
const admin = (await call('POST', '/api/auth/login', { email: 'admin@campusseat.local', password: 'Admin@12345' })).data;
ok(admin.user?.role === 'admin', 'admin can log in');
ok((await call('POST', '/api/auth/login', { email: 'admin@campusseat.local', password: 'wrong' })).status === 401, 'wrong password rejected (401)');
ok((await call('POST', '/api/auth/login', { email: "' OR 1=1 --", password: 'x' })).status === 400, 'SQL-injection style email rejected');
const injected = await call('POST', '/api/auth/login', { email: "a@b.co' OR '1'='1", password: "' OR '1'='1" });
ok([400, 401].includes(injected.status), 'SQL injection in login does not authenticate');
const injected2 = await call('POST', '/api/auth/login', { email: 'admin@campusseat.local', password: "' OR '1'='1" });
ok(injected2.status === 401, "password ' OR '1'='1 does not log in as admin");
const u1 = await mkUser(1, comp);
ok(u1.res.status === 201 && u1.token, 'user can register');
ok((await call('POST', '/api/auth/register', { full_name: 'X Y', student_number: 'zz1', email: `t${stamp}1@test.local`, password: 'Passw0rd1', school_id: comp })).status === 409, 'duplicate email rejected (409)');
ok((await call('POST', '/api/auth/register', { full_name: 'X Y', student_number: 'zz1', email: 'weak@test.local', password: 'short', school_id: comp })).status === 400, 'weak password rejected');
ok((await call('GET', '/api/admin/stats', null, u1.token)).status === 403, 'normal user blocked from admin API (403)');
ok((await call('GET', '/api/admin/stats')).status === 401, 'anonymous blocked from admin API (401)');
ok((await call('GET', '/api/auth/me', null, u1.token)).data.user.email === `t${stamp}1@test.local`, '/me returns the logged-in user');

// --- events (admin CRUD)
const future = new Date(Date.now() + 9 * 864e5).toLocaleDateString('en-CA');
const mk = (extra = {}) => ({ title: `E2E Event ${stamp}`, description: 'test', venue: 'Room 1', event_date: future, start_time: '10:00', end_time: '12:00', capacity: 5, school_ids: [], ...extra });
ok((await call('POST', '/api/events', mk(), u1.token)).status === 403, 'user cannot create events');
ok((await call('POST', '/api/events', mk({ end_time: '09:00' }), admin.token)).status === 400, 'end time before start rejected');
ok((await call('POST', '/api/events', mk({ capacity: 0 }), admin.token)).status === 400, 'capacity 0 rejected');
ok((await call('POST', '/api/events', mk({ event_date: '2020-01-01' }), admin.token)).status === 400, 'past date rejected');
const ev = (await call('POST', '/api/events', mk(), admin.token)).data.event;
ok(ev?.event_id && ev.seats_remaining === 5, 'admin creates event (5 seats)');
const evLaw = (await call('POST', '/api/events', mk({ title: `Law only ${stamp}`, school_ids: [law] }), admin.token)).data.event;
ok(evLaw.restricted_to.length === 1, 'event restricted to one school');
const edited = await call('PUT', `/api/events/${ev.event_id}`, mk({ venue: 'Room 2' }), admin.token);
ok(edited.data.event?.venue === 'Room 2', 'admin edits event');
ok((await call('GET', `/api/events?search=${encodeURIComponent('E2E Event ' + stamp)}`)).data.events.length >= 1, 'search finds the event');
ok((await call('GET', `/api/events?search=${encodeURIComponent("%' OR 1=1 --")}`)).data.events.length === 0, 'search treats SQL/wildcards as plain text');

// --- booking rules
const book = (u, eventId, c = u.creds) => call('POST', '/api/bookings', { event_id: eventId, ...c }, u.token);
const b1 = await book(u1, ev.event_id);
ok(b1.status === 201 && /^CS-\d{4}-\d{5}$/.test(b1.data.booking.booking_ref), 'eligible user books a seat, gets reference', JSON.stringify(b1.data));
ok(b1.data.booking.seats_remaining === 4, 'seats remaining drops to 4');
ok((await book(u1, ev.event_id)).data.error?.code === 'DUPLICATE_BOOKING', 'duplicate booking blocked');
ok((await book(u1, evLaw.event_id)).data.error?.code === 'NOT_ELIGIBLE', 'school restriction enforced (comp student, law event)');
ok((await book(u1, ev.event_id, { ...u1.creds, student_number: 'NOPE999' })).data.error?.code === 'CREDENTIALS_MISMATCH', 'credentials must match account');
ok((await call('POST', '/api/bookings', { event_id: ev.event_id, ...u1.creds })).status === 401, 'booking needs login');
const card = await call('GET', `/api/bookings/${b1.data.booking.booking_id}/card`, null, u1.token);
ok(card.ct.includes('pdf') && card.data.slice(0, 4).toString() === '%PDF', 'registration card is a PDF');
const u2 = await mkUser(2, comp);
ok((await call('GET', `/api/bookings/${b1.data.booking.booking_id}/card`, null, u2.token)).status === 404, "cannot download someone else's card");
ok((await call('GET', '/api/bookings/mine', null, u1.token)).data.bookings.length === 1, 'my bookings lists the booking');

// --- concurrency: 25 people race for the remaining 4 seats
const racers = await Promise.all(Array.from({ length: 25 }, (_, i) => mkUser(100 + i, comp)));
const results = await Promise.all(racers.map((u) => book(u, ev.event_id)));
const won = results.filter((r) => r.status === 201).length;
const full = results.filter((r) => r.data.error?.code === 'EVENT_FULL').length;
ok(won === 4 && full === 21, `25 simultaneous requests for 4 seats: exactly 4 succeed (got ${won}, full=${full})`);
const after = (await call('GET', `/api/events/${ev.event_id}`)).data.event;
ok(after.booked === 5 && after.seats_remaining === 0, 'event ends exactly full, never overbooked');
ok((await call('PUT', `/api/events/${ev.event_id}`, mk({ capacity: 3 }), admin.token)).data.error?.code === 'CAPACITY_TOO_LOW', 'capacity cannot drop below booked seats');

// --- admin features
const bk = (await call('GET', `/api/bookings?event_id=${ev.event_id}`, null, admin.token)).data.bookings;
ok(bk.length === 5, 'admin sees 5 bookings for the event');
for (const fmt of ['pdf', 'csv', 'json']) {
  const r = await call('GET', `/api/admin/reports/bookings?format=${fmt}&event_id=${ev.event_id}&sort=name&dir=asc`, null, admin.token);
  ok(r.status === 200 && (fmt !== 'pdf' || r.data.slice(0, 4).toString() === '%PDF'), `bookings report (${fmt})`);
}
ok((await call('GET', '/api/admin/reports/events?format=pdf', null, admin.token)).data.slice(0, 4).toString() === '%PDF', 'events summary report (pdf)');
const logs = (await call('GET', '/api/admin/audit-logs?action=BOOK_SEAT', null, admin.token)).data;
ok(logs.total >= 5 && logs.logs[0].full_name, 'audit log records who booked');
const reset = await call('POST', `/api/admin/users/${u2.user.user_id}/reset-password`, null, admin.token);
ok(/.{10,}/.test(reset.data.temporary_password || ''), 'admin resets a password');
ok((await call('POST', '/api/auth/login', { email: `t${stamp}2@test.local`, password: reset.data.temporary_password })).status === 200, 'user logs in with temporary password');
const fp = await call('POST', '/api/auth/forgot-password', { email: `t${stamp}2@test.local`, student_number: u2.creds.student_number, new_password: 'NewPass123' });
ok(fp.status === 200, 'forgot password with email + student number');
ok((await call('POST', '/api/auth/forgot-password', { email: `t${stamp}2@test.local`, student_number: 'wrong', new_password: 'NewPass123' })).status === 404, 'forgot password rejects wrong student number');
ok((await call('DELETE', `/api/admin/users/${u1.user.user_id}`, null, admin.token)).data.error?.code === 'IN_USE', 'cannot delete a user who has bookings');
ok((await call('DELETE', `/api/bookings/${b1.data.booking.booking_id}`, null, admin.token)).status === 200, 'admin cancels a booking');
ok((await call('GET', `/api/events/${ev.event_id}`)).data.event.seats_remaining === 1, 'cancelled seat becomes available again');
const del = await call('DELETE', `/api/events/${ev.event_id}`, null, admin.token);
ok(del.status === 200 && del.data.removed_bookings === 4, 'admin deletes event (bookings removed)');
await call('DELETE', `/api/events/${evLaw.event_id}`, null, admin.token);
ok((await call('GET', `/api/events/${ev.event_id}`)).status === 404, 'deleted event is gone (404)');
console.log(`\n${pass} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
