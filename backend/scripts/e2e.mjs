// End-to-end API checks. Needs the API running (npm start) and seeded data (npm run seed).
// Run: npm test            (BASE_URL defaults to http://localhost:4000)
const BASE = process.env.BASE_URL || 'http://localhost:4000';
let pass = 0, failed = 0;
const ok = (cond, name, extra = '') => { cond ? pass++ : failed++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + extra}`); };
// Each logged-in test user is a "session": its own cookie jar (the httpOnly session cookie) plus the
// CSRF token from the login response. Passing one as `who` sends the cookie, and the CSRF header on
// unsafe methods, like the browser app does.
const SESSION_COOKIE = 'cs_sid';
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const readSetCookie = (res) => {
  const c = res.headers.getSetCookie().find((h) => h.startsWith(`${SESSION_COOKIE}=`));
  return c === undefined ? undefined : { raw: c, value: decodeURIComponent(c.split(';')[0].slice(SESSION_COOKIE.length + 1)) };
};
const sessionFrom = (r) => ({ cookie: readSetCookie(r.raw)?.value || '', csrf: r.data?.csrf_token || '' });
const call = async (method, path, body, who, extraHeaders = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  if (who?.cookie) headers.Cookie = `${SESSION_COOKIE}=${encodeURIComponent(who.cookie)}`;
  if (who?.csrf && UNSAFE.has(method)) headers['X-CSRF-Token'] = who.csrf;
  const res = await fetch(BASE + path, { method, headers: { ...headers, ...extraHeaders }, body: body ? JSON.stringify(body) : undefined });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
  const sc = readSetCookie(res);
  if (who && sc) who.cookie = sc.value; // the server replaced or cleared the cookie
  return { status: res.status, data, ct, headers: res.headers, raw: res };
};
const login = async (email, password) => {
  const r = await call('POST', '/api/auth/login', { email, password });
  return { ...r.data, token: sessionFrom(r), res: r };
};
const stamp = Date.now().toString(36);
const mkUser = async (i, school_id) => {
  const r = await call('POST', '/api/auth/register', { full_name: `Test User ${i}`, student_number: `T${stamp}${i}`, email: `t${stamp}${i}@test.local`, password: 'Passw0rd1', school_id });
  return { ...r.data, token: sessionFrom(r), creds: { full_name: `Test User ${i}`, student_number: `T${stamp}${i}`, school_id }, res: r };
};

const schools = (await call('GET', '/api/schools')).data.schools;
const comp = schools.find((s) => /Computing/.test(s.school_name)).school_id;
const law = schools.find((s) => /Law/.test(s.school_name)).school_id;

// --- auth
const admin = await login('admin@campusseat.local', 'Admin@12345');
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

// --- sessions and CSRF
{
  const sc = readSetCookie(admin.res.raw)?.raw || '';
  ok(admin.token.cookie.length >= 40 && !('token' in admin.res.data) && admin.res.data.csrf_token?.length === 64, 'login sets a session cookie and returns no token in the body');
  ok(/HttpOnly/i.test(sc) && /SameSite=Lax/i.test(sc) && /Path=\//i.test(sc) && /Max-Age=\d+/i.test(sc), 'session cookie is HttpOnly, SameSite=Lax, Path=/', sc);
  ok((await call('GET', '/api/auth/me', null, null, { Authorization: `Bearer ${admin.token.cookie}` })).status === 401, 'Authorization: Bearer is not accepted (cookie only)');
  const anon = await call('GET', '/api/auth/session');
  ok(anon.status === 200 && anon.data.user === null, 'anonymous /auth/session returns user: null');
  const sess = await call('GET', '/api/auth/session', null, admin.token);
  ok(sess.data.user?.role === 'admin' && sess.data.csrf_token === admin.token.csrf, '/auth/session returns the user and CSRF token');

  const pwCheck = (who, headers) => call('POST', '/api/auth/change-password', { current_password: 'not-it', new_password: 'Whatever123' }, who, headers);
  ok((await pwCheck({ cookie: u1.token.cookie })).data.error?.code === 'CSRF_FAILED', 'unsafe request without CSRF token is refused (403)');
  ok((await pwCheck({ cookie: u1.token.cookie, csrf: 'f'.repeat(64) })).data.error?.code === 'CSRF_FAILED', 'unsafe request with a wrong CSRF token is refused');
  ok((await pwCheck(u1.token, { Origin: 'https://evil.example' })).data.error?.code === 'CSRF_FAILED', 'request from a foreign Origin is refused even with the token');
  ok((await pwCheck(u1.token, { Referer: 'https://evil.example/page' })).data.error?.code === 'CSRF_FAILED', 'foreign Referer (no Origin) is refused');
  ok((await pwCheck(u1.token, { Origin: BASE })).data.error?.code === 'WRONG_PASSWORD', 'same-origin request with the token passes the CSRF checks');
  ok((await call('POST', '/api/auth/login', { email: 'admin@campusseat.local', password: 'Admin@12345' }, null, { Origin: 'https://evil.example' })).status === 403, 'login from a foreign site is refused (login CSRF)');
  ok((await call('GET', '/api/events', null, { cookie: u1.token.cookie }, { Origin: 'https://evil.example' })).status === 200, 'safe GET requests are not blocked');

  // logout really ends the session; other devices stay logged in until "log out everywhere"
  const email1 = `t${stamp}1@test.local`;
  const a = (await login(email1, 'Passw0rd1')).token; const b = (await login(email1, 'Passw0rd1')).token;
  const stale = { cookie: a.cookie }; // an attacker's copy of the cookie
  const out = await call('POST', '/api/auth/logout', null, a);
  ok(out.status === 200 && a.cookie === '', 'logout clears the cookie');
  ok((await call('GET', '/api/auth/me', null, stale)).data.error?.code === 'SESSION_EXPIRED', 'a logged-out session cookie no longer works (replay refused)');
  ok((await call('GET', '/api/auth/me', null, b)).status === 200, 'logging out one device leaves the others logged in');
  const all = await call('POST', '/api/auth/logout-all', null, b);
  ok(all.data.ended >= 2 && (await call('GET', '/api/auth/me', null, u1.token)).status === 401, 'log out everywhere ends every session of the account');

  // password change logs out other devices but keeps this one
  const c = (await login(email1, 'Passw0rd1')).token; const d = (await login(email1, 'Passw0rd1')).token;
  const chg = await call('POST', '/api/auth/change-password', { current_password: 'Passw0rd1', new_password: 'Passw0rd2' }, c);
  ok(chg.status === 200 && chg.data.other_sessions_ended >= 1, 'password change succeeds and ends other sessions', JSON.stringify(chg.data));
  ok((await call('GET', '/api/auth/me', null, d)).status === 401 && (await call('GET', '/api/auth/me', null, c)).status === 200, 'other device is logged out, current one stays in');
  u1.token = c;

  // idle expiry and sliding renewal, checked against the database directly
  if (process.env.E2E_DB !== '0') {
    const mysql = (await import('mysql2/promise')).default;
    const { dbConfig } = await import('../src/db-config.js');
    const db = await mysql.createConnection({ ...dbConfig, timezone: 'Z' });
    await db.query("SET time_zone = '+00:00'");
    const { createHash } = await import('node:crypto');
    const h = (t) => createHash('sha256').update(t.cookie).digest('hex');
    const [[row]] = await db.query('SELECT token_hash, ip, user_agent FROM sessions WHERE token_hash = ?', [h(c)]);
    ok(row && row.token_hash !== c.cookie, 'database stores only a hash of the session token');
    const e = (await login(email1, 'Passw0rd2')).token;
    await db.query('UPDATE sessions SET last_seen_at = UTC_TIMESTAMP() - INTERVAL 10 MINUTE, idle_expires_at = UTC_TIMESTAMP() + INTERVAL 1 MINUTE WHERE token_hash = ?', [h(e)]);
    await call('GET', '/api/auth/me', null, e);
    await new Promise((r) => setTimeout(r, 300));
    const [[slid]] = await db.query('SELECT TIMESTAMPDIFF(MINUTE, UTC_TIMESTAMP(), idle_expires_at) AS m FROM sessions WHERE token_hash = ?', [h(e)]);
    ok(Number(slid.m) > 60, 'using a session slides its idle expiry forward', String(slid.m));
    await db.query('UPDATE sessions SET idle_expires_at = UTC_TIMESTAMP() - INTERVAL 1 MINUTE WHERE token_hash = ?', [h(e)]);
    const idle = await call('GET', '/api/auth/me', null, e);
    ok(idle.data.error?.code === 'SESSION_EXPIRED' && e.cookie === '', 'idle session expires and the cookie is cleared');
    const f = (await login(email1, 'Passw0rd2')).token;
    await db.query('UPDATE sessions SET absolute_expires_at = UTC_TIMESTAMP() - INTERVAL 1 SECOND WHERE token_hash = ?', [h(f)]);
    ok((await call('GET', '/api/auth/me', null, f)).status === 401, 'session past its absolute lifetime is refused even if recently used');
    await db.end();
  }
}

// --- account lockout (5 failures in a row lock the account for a while)
{
  const u3 = await mkUser(3, comp);
  const em3 = `t${stamp}3@test.local`;
  const fails = [];
  for (let i = 0; i < 5; i++) fails.push((await call('POST', '/api/auth/login', { email: em3, password: 'wrong-pass-1' })).data.error?.code);
  ok(fails.every((c) => c === 'INVALID_CREDENTIALS'), 'first 5 wrong passwords get the normal error');
  const lockedRes = await call('POST', '/api/auth/login', { email: em3, password: 'Passw0rd1' });
  ok(lockedRes.status === 429 && lockedRes.data.error.code === 'ACCOUNT_LOCKED' && lockedRes.data.error.retry_after_s > 800, 'after 5 failures even the right password is refused for ~15 minutes', JSON.stringify(lockedRes.data));
  ok((await call('GET', '/api/auth/me', null, u3.token)).status === 200, 'an existing session is not ended by the lock');
  const ghost = `nobody${stamp}@test.local`;
  for (let i = 0; i < 5; i++) await call('POST', '/api/auth/login', { email: ghost, password: 'wrong-pass-1' });
  const g = await call('POST', '/api/auth/login', { email: ghost, password: 'wrong-pass-1' });
  ok(g.data.error?.code === 'ACCOUNT_LOCKED', 'unknown emails "lock" the same way (no account enumeration)');
  const users = (await call('GET', `/api/admin/users?search=${encodeURIComponent(em3)}`, null, admin.token)).data.users;
  ok(users[0]?.locked_until && /Z$/.test(users[0].locked_until), 'admin user list shows the lock');
  ok((await call('POST', `/api/admin/users/${u3.user.user_id}/unlock`, null, admin.token)).status === 200, 'admin unlocks the account');
  ok((await login(em3, 'Passw0rd1')).res.status === 200, 'unlocked account can log in again');
  ok((await call('GET', '/api/admin/audit-logs?action=ACCOUNT_LOCKED', null, admin.token)).data.logs.some((l) => l.email === em3), 'the lock is recorded in the audit log');
  if (process.env.E2E_DB !== '0') {
    // the next lock lasts twice as long (lock_count kept until a successful login)
    const mysql = (await import('mysql2/promise')).default;
    const { dbConfig } = await import('../src/db-config.js');
    const db = await mysql.createConnection(dbConfig);
    await db.execute('UPDATE users SET lock_count = 1 WHERE email = ?', [em3]);
    for (let i = 0; i < 5; i++) await call('POST', '/api/auth/login', { email: em3, password: 'wrong-pass-1' });
    const again = await call('POST', '/api/auth/login', { email: em3, password: 'Passw0rd1' });
    ok(again.data.error?.retry_after_s > 25 * 60, 'a repeat lock lasts longer (30 minutes)', String(again.data.error?.retry_after_s));
    await db.end();
  }
}

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
ok((await call('GET', '/api/auth/me', null, u2.token)).status === 401, "admin password reset logs the user out everywhere");
const u2again = await login(`t${stamp}2@test.local`, reset.data.temporary_password);
ok(u2again.res.status === 200, 'user logs in with temporary password');
u2.token = u2again.token;
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
// --- time zones: the database stores UTC, people work in Nairobi time (UTC+3)
{
  const nbo = (d = new Date()) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(d).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
  const n = nbo();
  const todayNbo = `${n.year}-${n.month}-${n.day}`;
  const hm = (d) => { const p = nbo(d); return `${p.hour}:${p.minute}`; };
  const addDay = (ymd, k) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); };

  ok(ev.starts_at === `${future}T07:00:00Z` && ev.ends_at === `${future}T09:00:00Z`, '10:00-12:00 Nairobi is stored as 07:00-09:00 UTC', `${ev.starts_at} ${ev.ends_at}`);
  const tomorrow = addDay(todayNbo, 1);
  const early = (await call('POST', '/api/events', mk({ title: `Early ${stamp}`, event_date: tomorrow, start_time: '01:00', end_time: '02:00' }), admin.token)).data.event;
  ok(early?.starts_at === `${todayNbo}T22:00:00Z` && early.event_date === tomorrow && early.start_time.startsWith('01:00'),
    'event at 01:00 Nairobi falls on the previous UTC day but keeps its Nairobi date and time', JSON.stringify(early));
  await call('DELETE', `/api/events/${early.event_id}`, null, admin.token);

  const minsNow = Number(n.hour) * 60 + Number(n.minute);
  if (minsNow >= 35 && minsNow <= 23 * 60 + 54) {
    // An event happening right now in Nairobi: bookable until its end, then "past".
    const startT = hm(new Date(Date.now() - 30 * 60e3)), endSoon = hm(new Date(Date.now() + 4 * 60e3)), endGone = hm(new Date(Date.now() - 60e3));
    const now1 = (await call('POST', '/api/events', mk({ title: `Now ${stamp}`, event_date: todayNbo, start_time: startT, end_time: endSoon }), admin.token)).data.event;
    ok(now1 && now1.is_past === false, 'event ending in 4 minutes (Nairobi) is not past', JSON.stringify(now1));
    const ub = await book(u2, now1.event_id);
    ok(ub.status === 201, 'event later today in Nairobi can be booked', JSON.stringify(ub.data));
    const mineNow = (await call('GET', '/api/bookings/mine', null, u2.token)).data.bookings.find((b) => b.event_id === now1.event_id);
    ok(/Z$/.test(mineNow.booked_at) && Math.abs(new Date(mineNow.booked_at) - Date.now()) < 120e3, 'booked_at is returned as ISO UTC and matches the real time', mineNow.booked_at);
    const today1 = (await call('GET', `/api/admin/audit-logs?action=BOOK_SEAT&from=${todayNbo}&to=${todayNbo}&search=${encodeURIComponent('Now ' + stamp)}`, null, admin.token)).data;
    ok(today1.total === 1, "audit date filter uses Nairobi days (today's booking is found)");
    await call('PUT', `/api/events/${now1.event_id}`, mk({ title: `Now ${stamp}`, event_date: todayNbo, start_time: startT, end_time: endGone }), admin.token);
    const gone = (await call('GET', `/api/events/${now1.event_id}`)).data.event;
    ok(gone.is_past === true, 'event that ended 1 minute ago (Nairobi) is past');
    ok((await book(u1, now1.event_id)).data.error?.code === 'EVENT_PAST', 'booking an event that just ended is refused');
    ok(!(await call('GET', `/api/events?search=${encodeURIComponent('Now ' + stamp)}`)).data.events.length, 'ended event is hidden from the public list');
    ok((await call('POST', '/api/events', mk({ title: `Gone ${stamp}`, event_date: todayNbo, start_time: startT, end_time: endGone }), admin.token)).data.error?.field === 'end_time', 'creating an event whose end time already passed today is refused');
    await call('DELETE', `/api/events/${now1.event_id}`, null, admin.token);
  } else {
    console.log('SKIP  "happening now" time-zone checks (too close to midnight in Nairobi)');
  }
}

// --- operations: health, readiness, request ids, config validation
const h = await call('GET', '/api/health');
ok(h.status === 200 && h.data.db?.ok === true && typeof h.data.db.latency_ms === 'number', 'health reports database ok with latency');
const rd = await call('GET', '/api/ready');
ok(rd.status === 200 && rd.data.migrations?.ok === true && rd.data.migrations.pending.length === 0, 'ready: database reachable and migrations up to date');
ok(/^[0-9a-f-]{36}$/.test(h.headers.get('x-request-id') || ''), 'every response carries a generated X-Request-Id');
ok((await call('GET', '/api/schools', null, null, { 'X-Request-Id': 'trace-abc-12345' })).headers.get('x-request-id') === 'trace-abc-12345', 'well-formed incoming request id is reused');
ok(/^[0-9a-f-]{36}$/.test((await call('GET', '/api/schools', null, null, { 'X-Request-Id': 'bad id <script>' })).headers.get('x-request-id')), 'malformed incoming request id is replaced');
const nf = await call('GET', '/api/nope');
ok(nf.status === 404 && nf.data.error.request_id === nf.headers.get('x-request-id'), 'error responses include the request id');
{
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, ['-e', "import('./src/config.js')"], {
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, NODE_ENV: 'production', DOTENV_CONFIG_PATH: 'none.env', COOKIE_SECURE: 'false', RATE_LIMIT_SCALE: '50' }, encoding: 'utf8' });
  const msg = r.stderr || '';
  ok(r.status === 1 && /COOKIE_SECURE must not be false/.test(msg) && /DB_PASSWORD is missing/.test(msg) && /APP_URL is missing/.test(msg) && /RATE_LIMIT_SCALE must not be set/.test(msg),
    'invalid production config is refused at startup with every problem listed', msg.slice(0, 300));
}

console.log(`\n${pass} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
