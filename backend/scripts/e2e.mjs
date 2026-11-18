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

// --- two-factor login (TOTP) for administrators
{
  const T = await import('../src/totp.js');
  const s1 = Buffer.from('12345678901234567890');
  ok(T.totp(s1, 59e3, 8) === '94287082' && T.totp(s1, 1111111109e3, 8) === '07081804' && T.totp(s1, 20000000000e3, 8) === '65353130', 'TOTP matches the RFC 6238 test vectors');
  ok((await call('POST', '/api/account/2fa/setup', { password: 'Passw0rd2' }, u1.token)).status === 403, 'two-factor setup is for administrators');
  const a5 = await mkUser(5, comp);
  const em5 = `t${stamp}5@test.local`;
  await call('PATCH', `/api/admin/users/${a5.user.user_id}`, { role: 'admin' }, admin.token);
  ok((await call('GET', '/api/auth/me', null, a5.token)).status === 401, 'role change logs the person out');
  let ad = (await login(em5, 'Passw0rd1')).token;
  ok((await call('POST', '/api/account/2fa/setup', { password: 'wrong' }, ad)).data.error?.code === 'WRONG_PASSWORD', 'setup asks for the password again');
  const setup = (await call('POST', '/api/account/2fa/setup', { password: 'Passw0rd1' }, ad)).data;
  ok(/^data:image\/png;base64,/.test(setup.qr_data_url) && /^otpauth:\/\/totp\/CampusSeat:/.test(setup.otpauth_uri) && setup.secret.replace(/ /g, '').length === 32, 'setup returns a QR code (data URL) and the secret');
  const secret = T.base32Decode(setup.secret);
  ok((await call('POST', '/api/account/2fa/enable', { code: '000000' }, ad)).data.error?.code === 'INVALID_2FA_CODE', 'wrong confirmation code does not turn 2FA on');
  ok((await login(em5, 'Passw0rd1')).res.data.mfa_required === undefined, 'unconfirmed setup does not affect login');
  ad = (await login(em5, 'Passw0rd1')).token;
  const en = await call('POST', '/api/account/2fa/enable', { code: T.totp(secret) }, ad);
  ok(en.status === 200 && en.data.backup_codes.length === 10 && /^[A-Z2-9]{5}-[A-Z2-9]{5}$/.test(en.data.backup_codes[0]), '2FA turns on with a correct code and gives 10 backup codes');
  const codes = en.data.backup_codes;
  ok((await call('GET', '/api/auth/me', null, ad)).data.user.two_factor === true, 'user shows two_factor: true');

  const step1 = await login(em5, 'Passw0rd1');
  ok(step1.res.data.mfa_required === true && step1.res.data.challenge && !step1.token.cookie && !step1.res.data.user, 'password alone no longer logs in: a challenge is returned, no session cookie');
  const wrong = await call('POST', '/api/auth/2fa', { challenge: step1.res.data.challenge, code: '123456' });
  ok(wrong.data.error?.code === 'INVALID_2FA_CODE' && wrong.data.error.attempts_left === 4, 'wrong code is refused with attempts left');
  const nextCode = T.hotp(secret, T.stepAt() + 1); // next time step (one step of drift is allowed)
  const good = await call('POST', '/api/auth/2fa', { challenge: step1.res.data.challenge, code: nextCode });
  ok(good.status === 200 && good.data.user?.email === em5 && readSetCookie(good.raw), 'correct app code completes login and sets the session cookie');
  ok((await call('POST', '/api/auth/2fa', { challenge: step1.res.data.challenge, code: nextCode })).data.error?.code === 'CHALLENGE_EXPIRED', 'a challenge cannot be used twice');
  const step2 = await login(em5, 'Passw0rd1');
  ok((await call('POST', '/api/auth/2fa', { challenge: step2.res.data.challenge, code: nextCode })).data.error?.code === 'INVALID_2FA_CODE', 'an app code cannot be replayed');
  const bk = await call('POST', '/api/auth/2fa', { challenge: step2.res.data.challenge, code: ` ${codes[0].toLowerCase().replace('-', ' ')} ` });
  ok(bk.status === 200, 'a backup code works (case, spaces and dash ignored)');
  const step3 = await login(em5, 'Passw0rd1');
  ok((await call('POST', '/api/auth/2fa', { challenge: step3.res.data.challenge, code: codes[0] })).data.error?.code === 'INVALID_2FA_CODE', 'each backup code works only once');
  ok((await call('POST', '/api/auth/2fa', { challenge: 'made-up', code: nextCode })).data.error?.code === 'CHALLENGE_EXPIRED', 'unknown challenge is refused');
  ad = sessionFrom(bk);
  ok((await call('GET', '/api/account/2fa', null, ad)).data.backup_codes_left === 9, 'status shows backup codes left');
  ok((await call('GET', '/api/admin/audit-logs?action=2FA_BACKUP_USED', null, admin.token)).data.logs.some((l) => l.email === em5), 'backup code use is audited');
  const regen = await call('POST', '/api/account/2fa/backup-codes', { password: 'Passw0rd1', code: codes[1] }, ad);
  ok(regen.data.backup_codes?.length === 10 && !regen.data.backup_codes.includes(codes[2]), 'backup codes can be regenerated (password + code)');
  const fresh = regen.data.backup_codes;
  await call('POST', `/api/admin/users/${a5.user.user_id}/unlock`, null, admin.token); // reset the failure count from the checks above
  const step4 = await login(em5, 'Passw0rd1');
  ok((await call('POST', '/api/auth/2fa', { challenge: step4.res.data.challenge, code: codes[2] })).data.error?.code === 'INVALID_2FA_CODE', 'old backup codes stop working after regeneration');

  // wrong codes count toward the account lock: 4 more here make 5 in a row
  let last;
  for (let i = 0; i < 4; i++) last = await call('POST', '/api/auth/2fa', { challenge: step4.res.data.challenge, code: '000000' });
  ok(last.data.error?.code === 'CHALLENGE_EXPIRED', 'after 5 wrong codes the challenge is dropped');
  ok((await call('POST', '/api/auth/login', { email: em5, password: 'Passw0rd1' })).data.error?.code === 'ACCOUNT_LOCKED', 'wrong two-factor codes lock the account like wrong passwords');
  await call('POST', `/api/admin/users/${a5.user.user_id}/unlock`, null, admin.token);

  ok((await call('POST', '/api/account/2fa/disable', { password: 'Passw0rd1', code: '000000' }, ad)).data.error?.code === 'INVALID_2FA_CODE', 'turning 2FA off needs a valid code');
  ok((await call('POST', '/api/account/2fa/disable', { password: 'Passw0rd1', code: fresh[0] }, ad)).status === 200, 'turning 2FA off with password + code');
  const plain = await login(em5, 'Passw0rd1');
  ok(plain.res.status === 200 && plain.res.data.user && !plain.res.data.mfa_required, 'after turning it off, password login works again');
  ok((await call('GET', '/api/admin/audit-logs?action=2FA_ENABLE', null, admin.token)).data.logs.some((l) => l.email === em5), '2FA changes are audited');
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
const qr = await call('GET', `/api/bookings/${b1.data.booking.booking_id}/qr.svg`, null, u1.token);
ok(qr.status === 200 && qr.ct.includes('image/svg+xml') && qr.data.toString().includes('<svg'), 'on-screen card QR code is an SVG');
const u2 = await mkUser(2, comp);
ok((await call('GET', `/api/bookings/${b1.data.booking.booking_id}/qr.svg`, null, u2.token)).status === 404, "cannot fetch someone else's QR code");
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
ok(logs.meta.total >= 5 && logs.logs[0].full_name, 'audit log records who booked');
const reset = await call('POST', `/api/admin/users/${u2.user.user_id}/reset-password`, null, admin.token);
ok(/.{10,}/.test(reset.data.temporary_password || ''), 'admin resets a password');
ok((await call('GET', '/api/auth/me', null, u2.token)).status === 401, "admin password reset logs the user out everywhere");
const u2again = await login(`t${stamp}2@test.local`, reset.data.temporary_password);
ok(u2again.res.status === 200, 'user logs in with temporary password');
u2.token = u2again.token;
// --- forgot password: emailed single-use, expiring link (replaces "email + student number")
{
  const em2 = `t${stamp}2@test.local`;
  const inbox = async (to) => (await call('GET', `/api/_test/mail?to=${encodeURIComponent(to)}`)).data.messages;
  const tokenOf = (m) => m.text.match(/#token=([A-Za-z0-9_-]+)/)?.[1];
  const known = await call('POST', '/api/auth/forgot-password', { email: em2 });
  const unknown = await call('POST', '/api/auth/forgot-password', { email: `nobody-${stamp}@test.local` });
  ok(known.status === 200 && unknown.status === 200 && known.data.message === unknown.data.message, 'forgot password answers the same for known and unknown emails');
  const old = await call('POST', '/api/auth/forgot-password', { email: em2, student_number: u2.creds.student_number, new_password: 'NewPass123' });
  ok(old.status === 200 && (await login(em2, 'NewPass123')).res.status === 401, 'old email + student number reset no longer changes the password');
  const mails = await inbox(em2);
  ok(mails.length === 2 && /reset-password#token=/.test(mails[0].text) && mails[0].html.includes('Choose a new password'), 'reset email is sent with a link (text and HTML)');
  ok((await inbox(`nobody-${stamp}@test.local`)).length === 0, 'no email for an unknown address');
  const [first, second] = mails.map(tokenOf);
  ok((await call('POST', '/api/auth/reset-password/verify', { token: first })).data.valid === false, 'a newer request invalidates the earlier link');
  ok((await call('POST', '/api/auth/reset-password/verify', { token: second })).data.valid === true, 'the latest link is valid');
  ok((await call('POST', '/api/auth/reset-password', { token: second, new_password: 'weak' })).data.error?.field === 'new_password'
    && (await call('POST', '/api/auth/reset-password/verify', { token: second })).data.valid === true, 'a weak new password is rejected without using up the link');
  const before = u2.token;
  const done = await call('POST', '/api/auth/reset-password', { token: second, new_password: 'NewPass123' });
  ok(done.status === 200, 'password is reset with the emailed link');
  ok((await call('GET', '/api/auth/me', null, before)).status === 401, 'resetting the password logs out existing sessions');
  ok((await login(em2, reset.data.temporary_password)).res.status === 401, 'old password stops working');
  const fresh = await login(em2, 'NewPass123');
  ok(fresh.res.status === 200, 'new password works');
  u2.token = fresh.token;
  ok((await call('POST', '/api/auth/reset-password', { token: second, new_password: 'Another123' })).data.error?.code === 'INVALID_RESET_TOKEN', 'a reset link works only once');
  ok((await call('POST', '/api/auth/reset-password', { token: 'x'.repeat(43), new_password: 'Another123' })).data.error?.code === 'INVALID_RESET_TOKEN', 'a made-up token is refused');
  if (process.env.E2E_DB !== '0') {
    const mysql = (await import('mysql2/promise')).default;
    const { dbConfig } = await import('../src/db-config.js');
    const db = await mysql.createConnection(dbConfig);
    await db.execute('DELETE pr FROM password_resets pr JOIN users u ON u.user_id = pr.user_id WHERE u.email = ?', [em2]); // clear the hourly limit
    await call('POST', '/api/auth/forgot-password', { email: em2 });
    const t3 = tokenOf((await inbox(em2)).at(-1));
    const [[stored]] = await db.execute('SELECT COUNT(*) AS n FROM password_resets WHERE token_hash = ?', [t3]);
    ok(Number(stored.n) === 0, 'database stores only a hash of the reset token');
    await db.execute("UPDATE password_resets pr JOIN users u ON u.user_id = pr.user_id SET pr.expires_at = UTC_TIMESTAMP() - INTERVAL 1 SECOND WHERE u.email = ?", [em2]);
    ok((await call('POST', '/api/auth/reset-password', { token: t3, new_password: 'Another123' })).data.error?.code === 'INVALID_RESET_TOKEN', 'an expired reset link is refused');
    for (let i = 0; i < 3; i++) await call('POST', '/api/auth/forgot-password', { email: em2 });
    const count = (await inbox(em2)).length;
    await call('POST', '/api/auth/forgot-password', { email: em2 });
    ok((await inbox(em2)).length === count, 'at most 3 reset emails per account per hour');
    await db.end();
  }
  const adm = await call('POST', `/api/admin/users/${u1.user.user_id}/send-reset-email`, null, admin.token);
  ok(adm.status === 200 && (await inbox(`t${stamp}1@test.local`)).length === 1, 'admin can send a user a reset link');
}
ok((await call('DELETE', `/api/admin/users/${u1.user.user_id}`, null, admin.token)).data.error?.code === 'IN_USE', 'cannot delete a user who has bookings');
ok((await call('DELETE', `/api/bookings/${b1.data.booking.booking_id}`, null, admin.token)).status === 200, 'admin cancels a booking');
ok((await call('GET', `/api/events/${ev.event_id}`)).data.event.seats_remaining === 1, 'cancelled seat becomes available again');
const del = await call('DELETE', `/api/events/${ev.event_id}`, null, admin.token);
ok(del.status === 200 && del.data.removed_bookings === 4, 'admin deletes event (bookings removed)');
await call('DELETE', `/api/events/${evLaw.event_id}`, null, admin.token);
ok((await call('GET', `/api/events/${ev.event_id}`)).status === 404, 'deleted event is gone (404)');
// --- cancellation by the user, and the waitlist
{
  const inbox = async (to) => (await call('GET', `/api/_test/mail?to=${encodeURIComponent(to)}`)).data.messages;
  const people = await Promise.all(Array.from({ length: 16 }, (_, i) => mkUser(300 + i, comp)));
  const emailOf = (u) => u.user.email;
  const W = (await call('POST', '/api/events', mk({ title: `Waitlist ${stamp}`, capacity: 2 }), admin.token)).data.event;
  const [h1, h2] = people;
  await book(h1, W.event_id);
  ok((await call('POST', `/api/events/${W.event_id}/waitlist`, null, people[2].token)).data.error?.code === 'SEATS_AVAILABLE', 'cannot join the waitlist while seats are left');
  await book(h2, W.event_id);
  const fullErr = (await book(people[2], W.event_id)).data.error;
  ok(fullErr?.code === 'EVENT_FULL' && fullErr.waitlist === true, 'full event offers the waitlist');

  // 10 people join at the same moment: everyone gets a distinct place in the queue
  const joiners = people.slice(2, 12);
  const joins = await Promise.all(joiners.map((u) => call('POST', `/api/events/${W.event_id}/waitlist`, null, u.token)));
  const positions = joins.map((r) => r.data.waitlist?.position).sort((a, b) => a - b);
  ok(joins.every((r) => r.status === 201) && positions.join(',') === '1,2,3,4,5,6,7,8,9,10', '10 simultaneous joins get positions 1 to 10', positions.join(','));
  const queue = joiners.map((u, i) => ({ u, pos: joins[i].data.waitlist.position })).sort((a, b) => a.pos - b.pos).map((x) => x.u);
  ok((await call('POST', `/api/events/${W.event_id}/waitlist`, null, queue[0].token)).data.error?.code === 'ALREADY_WAITING', 'cannot join twice');
  ok((await call('POST', `/api/events/${W.event_id}/waitlist`, null, h1.token)).data.error?.code === 'DUPLICATE_BOOKING', 'seat holders cannot join the waitlist');
  const seen = (await call('GET', `/api/events/${W.event_id}`, null, queue[1].token)).data.event;
  ok(seen.my_waitlist?.position === 2 && seen.waitlist_count === 10, 'event shows my place in the queue and the queue length');
  const adminQ = (await call('GET', `/api/events/${W.event_id}/waitlist`, null, admin.token)).data.waitlist;
  ok(adminQ.length === 10 && adminQ[0].email === emailOf(queue[0]), 'admin sees the queue in order');

  // the owner cancels: the first person in the queue gets the seat, in the same transaction
  const h1b = (await call('GET', `/api/bookings/mine?event_id=${W.event_id}`, null, h1.token)).data.bookings[0];
  ok((await call('DELETE', `/api/bookings/${h1b.booking_id}`, null, h2.token)).status === 404, "cannot cancel someone else's booking");
  const cx = await call('DELETE', `/api/bookings/${h1b.booking_id}`, null, h1.token);
  ok(cx.status === 200 && cx.data.promoted === 1, 'owner cancels their booking; one person is promoted');
  const firstMine = (await call('GET', `/api/bookings/mine?event_id=${W.event_id}`, null, queue[0].token)).data.bookings;
  ok(firstMine.length === 1, 'the first person in the queue now holds a seat');
  const promoMail = (await inbox(emailOf(queue[0]))).at(-1);
  ok(promoMail?.subject.startsWith('You have a seat') && promoMail.text.includes(firstMine[0].booking_ref), 'promoted person is emailed with their booking reference');
  const afterCx = (await call('GET', `/api/events/${W.event_id}`, null, queue[1].token)).data.event;
  ok(afterCx.seats_remaining === 0 && afterCx.waitlist_count === 9 && afterCx.my_waitlist.position === 1, 'event stays full; everyone moves up one place');
  ok((await call('GET', '/api/admin/audit-logs?action=WAITLIST_PROMOTE&search=' + encodeURIComponent(`Waitlist ${stamp}`), null, admin.token)).data.meta.total === 1, 'the promotion is audited');

  // leaving the queue
  ok((await call('DELETE', `/api/events/${W.event_id}/waitlist`, null, queue[3].token)).status === 200, 'a person leaves the waitlist');
  ok((await call('DELETE', `/api/events/${W.event_id}/waitlist`, null, queue[3].token)).data.error?.code === 'NOT_WAITING', 'leaving twice is refused');
  const myW = (await call('GET', '/api/bookings/waitlist', null, queue[4].token)).data.waitlist.find((w) => w.event_id === W.event_id);
  ok(myW?.position === 3, 'my waitlist page shows the updated position', JSON.stringify(myW));

  // more capacity: the next people in order are promoted
  const grown = await call('PUT', `/api/events/${W.event_id}`, mk({ title: `Waitlist ${stamp}`, capacity: 4 }), admin.token);
  ok(grown.data.event?.booked === 4 && grown.data.event.waitlist_count === 6, 'raising capacity by 2 promotes 2 people', JSON.stringify(grown.data.event && { b: grown.data.event.booked, w: grown.data.event.waitlist_count }));
  const got = await Promise.all([queue[1], queue[2], queue[4]].map(async (u) => (await call('GET', `/api/bookings/mine?event_id=${W.event_id}`, null, u.token)).data.bookings.length));
  ok(got.join(',') === '1,1,0', 'promotion follows queue order (left person skipped)', got.join(','));

  // race: a holder cancels while 4 non-waiting people try to grab the seat directly
  const grabbers = people.slice(12, 16);
  const holder = (await call('GET', `/api/bookings/mine?event_id=${W.event_id}`, null, queue[1].token)).data.bookings[0];
  const [cancelRes, ...grabs] = await Promise.all([call('DELETE', `/api/bookings/${holder.booking_id}`, null, queue[1].token), ...grabbers.map((u) => book(u, W.event_id))]);
  const after = (await call('GET', `/api/events/${W.event_id}`)).data.event;
  ok(cancelRes.status === 200 && after.booked === 4 && grabs.every((r) => r.data.error?.code === 'EVENT_FULL'),
    'cancel racing 4 direct bookings: the waitlist gets the seat, never overbooked', JSON.stringify({ booked: after.booked, codes: grabs.map((r) => r.data.error?.code || r.status) }));
  // race: two holders cancel at once: two different people are promoted
  const hs = await Promise.all([queue[0], queue[2]].map(async (u) => ({ u, b: (await call('GET', `/api/bookings/mine?event_id=${W.event_id}`, null, u.token)).data.bookings[0] })));
  const both = await Promise.all(hs.map(({ u, b }) => call('DELETE', `/api/bookings/${b.booking_id}`, null, u.token)));
  const after2 = (await call('GET', `/api/events/${W.event_id}`)).data.event;
  ok(both.every((r) => r.data.promoted === 1) && after2.booked === 4 && after2.waitlist_count === 3, 'two simultaneous cancellations promote two people; still exactly full', JSON.stringify({ booked: after2.booked, w: after2.waitlist_count }));

  // eligibility is re-checked on promotion
  const lawU = await mkUser(320, law);
  const R = (await call('POST', '/api/events', mk({ title: `Restrict ${stamp}`, capacity: 1 }), admin.token)).data.event;
  await book(people[12], R.event_id);
  await call('POST', `/api/events/${R.event_id}/waitlist`, null, people[13].token);
  await call('POST', `/api/events/${R.event_id}/waitlist`, null, lawU.token);
  await call('PUT', `/api/events/${R.event_id}`, mk({ title: `Restrict ${stamp}`, capacity: 1, school_ids: [comp, law] }), admin.token);
  await call('PUT', `/api/events/${R.event_id}`, mk({ title: `Restrict ${stamp}`, capacity: 1, school_ids: [law] }), admin.token);
  const rb = (await call('GET', `/api/bookings/mine?event_id=${R.event_id}`, null, people[12].token)).data.bookings[0];
  await call('DELETE', `/api/bookings/${rb.booking_id}`, null, admin.token);
  ok((await call('GET', `/api/bookings/mine?event_id=${R.event_id}`, null, lawU.token)).data.bookings.length === 1
    && (await call('GET', `/api/bookings/mine?event_id=${R.event_id}`, null, people[13].token)).data.bookings.length === 0,
    'promotion skips people no longer eligible after a school restriction');

  // cancellation cutoff (2 hours before the start) for the owner; admins can still cancel
  const nb = (d) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(d).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
  const s0 = nb(new Date(Date.now() + 61 * 60e3)); const e0 = nb(new Date(Date.now() + 121 * 60e3));
  if (`${s0.year}-${s0.month}-${s0.day}` === `${e0.year}-${e0.month}-${e0.day}`) {
    const C = (await call('POST', '/api/events', mk({ title: `Soon ${stamp}`, event_date: `${s0.year}-${s0.month}-${s0.day}`, start_time: `${s0.hour}:${s0.minute}`, end_time: `${e0.hour}:${e0.minute}` }), admin.token)).data.event;
    const cb = (await book(people[14], C.event_id)).data.booking;
    const late = await call('DELETE', `/api/bookings/${cb.booking_id}`, null, people[14].token);
    ok(late.data.error?.code === 'CANCEL_CUTOFF' && late.data.error.deadline, 'owner cannot cancel within 2 hours of the start', JSON.stringify(late.data));
    ok((await call('DELETE', `/api/bookings/${cb.booking_id}`, null, admin.token)).status === 200, 'an admin can still cancel close to the start');
    await call('DELETE', `/api/events/${C.event_id}`, null, admin.token);
  } else console.log('SKIP  cancellation cutoff check (event would cross midnight in Nairobi)');
  ok((await call('GET', `/api/admin/audit-logs?action=CANCEL_BOOKING&search=${encodeURIComponent('by its owner')}`, null, admin.token)).data.meta.total >= 3, 'owner cancellations are audited');
  for (const e of [W, R]) await call('DELETE', `/api/events/${e.event_id}`, null, admin.token);
}

// --- CSV exports cannot smuggle spreadsheet formulas
{
  const evil = (await call('POST', '/api/events', mk({ title: `=HYPERLINK("http://x.example","${stamp}")`, capacity: 2 }), admin.token)).data.event;
  const r = await call('GET', `/api/admin/reports/events?format=csv&from=${future}&to=${future}`, null, admin.token);
  const text = r.data.toString('utf8');
  ok(text.includes(`"'=HYPERLINK(`) && !/(^|,)"?=HYPERLINK/m.test(text), 'CSV cells starting with = are neutralised', text.split('\n').find((l) => l.includes(stamp)));
  await call('DELETE', `/api/events/${evil.event_id}`, null, admin.token);
}

// --- lists: pagination, sorting, one response shape
{
  const extra = [];
  for (let i = 0; i < 3; i++) extra.push((await call('POST', '/api/events', mk({ title: `Pager ${stamp} ${'CBA'[i]}`, capacity: 3 + i }), admin.token)).data.event);
  const q = `search=${encodeURIComponent('Pager ' + stamp)}`;
  const all = (await call('GET', `/api/events?${q}`)).data;
  ok(all.meta && all.meta.total === 3 && all.meta.page === 1 && all.meta.limit === 50 && all.meta.pages === 1 && all.meta.sort === 'date', 'event list returns { events, meta } with defaults');
  const p1 = (await call('GET', `/api/events?${q}&limit=2&page=1&sort=title`)).data;
  const p2 = (await call('GET', `/api/events?${q}&limit=2&page=2&sort=title`)).data;
  ok(p1.events.length === 2 && p2.events.length === 1 && p1.meta.pages === 2, 'events page 1 has 2, page 2 has the rest');
  ok([...p1.events, ...p2.events].map((e) => e.title.slice(-1)).join('') === 'ABC', 'sort=title orders A to Z across pages');
  ok((await call('GET', `/api/events?${q}&sort=title&dir=desc`)).data.events.map((e) => e.title.slice(-1)).join('') === 'CBA', 'dir=desc reverses the order');
  ok((await call('GET', `/api/events?${q}&sort=drop table`)).data.error?.field === 'sort', 'unknown sort key is refused (400)');
  const lenient = (await call('GET', `/api/events?${q}&limit=5000&page=abc`)).data.meta;
  ok(lenient.limit === 100 && lenient.page === 1, 'bad page falls back to 1 and limit is capped at 100');
  const ul = (await call('GET', '/api/admin/users?limit=2&sort=name&dir=asc', null, admin.token)).data;
  ok(ul.users.length === 2 && ul.meta.total > 2 && ul.users[0].full_name <= ul.users[1].full_name, 'admin users list is paginated and sortable');
  await book(u1, extra[0].event_id); await book(u2, extra[0].event_id);
  const bl = (await call('GET', `/api/bookings?limit=1&event_id=${extra[0].event_id}`, null, admin.token)).data;
  ok(bl.bookings.length === 1 && bl.meta.total === 2 && bl.meta.pages === 2, 'admin bookings list is paginated', JSON.stringify(bl.meta));
  const mineOne = (await call('GET', `/api/bookings/mine?event_id=${extra[0].event_id}`, null, u1.token)).data;
  ok(mineOne.bookings.length === 1 && mineOne.meta.total === 1, 'my bookings can be filtered to one event');
  const al = (await call('GET', '/api/admin/audit-logs?limit=3', null, admin.token)).data;
  ok(al.logs.length === 3 && al.meta.total > 3 && Array.isArray(al.actions), 'audit log list uses the same meta shape');
  const opts = (await call('GET', '/api/admin/event-options', null, admin.token)).data;
  ok(opts.events.some((e) => e.event_id === extra[0].event_id) && opts.meta.total === opts.events.length, 'admin event picker lists every event');
  ok((await call('GET', '/api/admin/event-options', null, u1.token)).status === 403, 'event picker is admin only');
  for (const e of extra) await call('DELETE', `/api/events/${e.event_id}`, null, admin.token);
}

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
    ok(today1.meta.total === 1, "audit date filter uses Nairobi days (today's booking is found)");
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

// --- audit trail: who, what, before/after, where from; filters; CSV export; append-only
{
  const logs = async (qs) => (await call('GET', `/api/admin/audit-logs?${qs}`, null, admin.token)).data;
  const em = `t${stamp}a1@test.local`;
  const au = await mkUser('a1', comp);
  const lg = await login(em, 'Passw0rd1');
  const rid = lg.res.headers.get('x-request-id');
  const entry = (await logs(`search=${rid}`)).logs.find((l) => l.action === 'LOGIN');
  ok(entry && entry.request_id === rid && entry.ip && /node|undici/i.test(entry.user_agent || '') && entry.actor_email === em && entry.entity_type === 'user' && entry.entity_id === String(au.user.user_id),
    'login entry records actor, entity, IP, user agent and the request id', JSON.stringify(entry));
  await call('POST', '/api/auth/login', { email: `ghost-${stamp}@test.local`, password: 'wrong-pass-1' });
  const ghost = (await logs(`action=LOGIN_FAILED&search=${encodeURIComponent(`ghost-${stamp}`)}`)).logs[0];
  ok(ghost && ghost.actor_id === null && ghost.entity_type === null && ghost.details.includes(`ghost-${stamp}`), 'failed login for an unknown email is logged without an actor');

  await call('PATCH', `/api/admin/users/${au.user.user_id}`, { role: 'admin' }, admin.token);
  const role = (await logs(`action=CHANGE_ROLE&entity_type=user&entity_id=${au.user.user_id}`)).logs[0];
  ok(role?.before?.role === 'user' && role?.after?.role === 'admin' && role.actor_email === 'admin@campusseat.local', 'role change stores before and after');
  await call('PATCH', `/api/admin/users/${au.user.user_id}`, { role: 'user' }, admin.token);

  const ae = (await call('POST', '/api/events', mk({ title: `Audit ${stamp}`, capacity: 5 }), admin.token)).data.event;
  const created = (await logs(`action=CREATE_EVENT&entity_type=event&entity_id=${ae.event_id}`)).logs[0];
  ok(created?.after?.title === `Audit ${stamp}` && created.after.capacity === 5 && created.before === null, 'event creation stores the new values');
  await call('PUT', `/api/events/${ae.event_id}`, mk({ title: `Audit ${stamp}`, capacity: 8, venue: 'Hall 9' }), admin.token);
  const edit = (await logs(`action=EDIT_EVENT&entity_type=event&entity_id=${ae.event_id}`)).logs[0];
  ok(edit && JSON.stringify(edit.before) === JSON.stringify({ venue: 'Room 1', capacity: 5 }) && JSON.stringify(edit.after) === JSON.stringify({ venue: 'Hall 9', capacity: 8 }) && /changed venue, capacity/.test(edit.details),
    'event edit stores only the changed fields, before and after', JSON.stringify({ b: edit?.before, a: edit?.after, d: edit?.details }));
  lg.token = (await login(em, 'Passw0rd1')).token; // the role changes above ended their sessions
  const lb = (await book({ ...au, token: lg.token }, ae.event_id)).data.booking;
  const bookE = (await logs(`action=BOOK_SEAT&entity_type=booking&entity_id=${lb.booking_id}`)).logs[0];
  ok(bookE?.after?.booking_ref === lb.booking_ref && bookE.after.event_id === ae.event_id, 'booking entry points at the booking with its reference');
  await call('DELETE', `/api/bookings/${lb.booking_id}`, null, lg.token);
  const cxE = (await logs(`action=CANCEL_BOOKING&entity_type=booking&entity_id=${lb.booking_id}`)).logs[0];
  ok(cxE?.before?.booking_ref === lb.booking_ref && /by its owner/.test(cxE.details), 'cancellation stores the booking that was removed');

  // filters
  const multi = await logs(`action=BOOK_SEAT,CANCEL_BOOKING&search=${encodeURIComponent(`Audit ${stamp}`)}`);
  ok(multi.meta.total === 2 && multi.logs.every((l) => ['BOOK_SEAT', 'CANCEL_BOOKING'].includes(l.action)), 'filter by several actions at once');
  const byEvent = await logs(`entity_type=event&entity_id=${ae.event_id}`);
  ok(byEvent.meta.total === 2 && byEvent.entity_types.includes('event'), 'filter by entity (everything that happened to one event)');
  const byPerson = await logs(`person=${encodeURIComponent(em)}&limit=100`);
  ok(byPerson.meta.total >= 4 && byPerson.logs.every((l) => l.actor_email === em), 'filter by person (email)');
  const byActor = await logs(`actor=${au.user.user_id}&limit=100`);
  ok(byActor.meta.total === byPerson.meta.total, 'filter by actor id matches the person filter');
  const detail = (await call('GET', `/api/admin/audit-logs/${edit.log_id}`, null, admin.token)).data.log;
  ok(detail?.log_id === edit.log_id && detail.user_agent && detail.has_changes === true, 'single entry with full detail');

  // nothing secret ends up in the trail
  const recent = JSON.stringify((await logs('limit=100')).logs);
  ok(!recent.includes('Passw0rd1') && !recent.includes('NewPass123') && !/password_hash|"token"|csrf_token/.test(recent), 'audit entries contain no passwords, hashes or tokens');

  // report downloads record their filters
  await call('GET', `/api/admin/reports/bookings?format=csv&event_id=${ae.event_id}&sort=name`, null, admin.token);
  const rep = (await logs('action=GENERATE_REPORT&limit=1')).logs[0];
  ok(rep?.after?.format === 'csv' && rep.after.filters.event_id === String(ae.event_id) && typeof rep.after.rows === 'number', 'report download records format, filters and row count');

  // CSV export
  const ex = await call('GET', `/api/admin/audit-logs/export?entity_type=event&entity_id=${ae.event_id}`, null, admin.token);
  const csv = ex.data.toString('utf8').replace(/^﻿/, '').trim().split('\n');
  ok(ex.ct.includes('text/csv') && /audit-\d{4}-\d{2}-\d{2}\.csv/.test(ex.headers.get('content-disposition')) && csv[0].startsWith('Time (EAT),Time (UTC),Actor email'), 'audit export is a CSV file with a header row');
  ok(csv.length - 1 === byEvent.meta.total && csv.slice(1).every((l) => l.includes(String(ae.event_id))), 'export contains exactly the filtered entries');
  ok((await logs('action=AUDIT_EXPORT&limit=1')).logs[0]?.after?.rows === byEvent.meta.total, 'the export itself is audited with its filters and size');
  {
    // Regression guard: the entry must exist as soon as the download has finished (it used to be saved
    // after the response ended, so an immediate read missed it about half the time).
    let seen = 0;
    for (let i = 0; i < 10; i++) {
      const marker = `race-${stamp}-${i}`;
      await call('GET', `/api/admin/audit-logs/export?search=${marker}`, null, admin.token);
      if ((await logs('action=AUDIT_EXPORT&limit=1')).logs[0]?.after?.filters?.search === marker) seen++;
    }
    ok(seen === 10, 'each export is audited before its download completes (10 back-to-back tries)', `${seen}/10`);
  }
  ok((await call('GET', '/api/admin/audit-logs/export', null, u1.token)).status === 403, 'only admins can export the audit trail');

  // append-only
  const changeTries = await Promise.all(['PUT', 'PATCH', 'DELETE'].map((m) => call(m, `/api/admin/audit-logs/${edit.log_id}`, { action: 'X' }, admin.token)));
  ok(changeTries.every((r) => r.status === 404), 'there is no API to change or delete audit entries');
  ok((await call('GET', '/api/ready')).data.audit_append_only === true, 'readiness reports the database-level append-only protection');
  if (process.env.E2E_DB !== '0') {
    const mysql = (await import('mysql2/promise')).default;
    const { dbConfig } = await import('../src/db-config.js');
    const db = await mysql.createConnection(dbConfig);
    const tryIt = async (sql) => { try { await db.query(sql, [edit.log_id]); return 'allowed'; } catch (e) { return e.sqlState; } };
    ok(await tryIt("UPDATE audit_logs SET details = 'rewritten' WHERE log_id = ?") === '45000', 'database refuses UPDATE on audit rows');
    ok(await tryIt('DELETE FROM audit_logs WHERE log_id = ?') === '45000', 'database refuses DELETE on audit rows');
    await db.end();
  }
  // deleting a user keeps their history (email kept, link cleared)
  const gone = await mkUser('a2', comp);
  const goneEmail = `t${stamp}a2@test.local`;
  await login(goneEmail, 'Passw0rd1');
  const del = await call('DELETE', `/api/admin/users/${gone.user.user_id}`, null, admin.token);
  const kept = (await logs(`person=${encodeURIComponent(goneEmail)}&limit=100`)).logs;
  ok(del.status === 200 && kept.length >= 2 && kept.some((l) => l.action === 'LOGIN' && l.actor_id === null && l.actor_email === goneEmail),
    'deleting a user still works and their audit history keeps their email', JSON.stringify({ s: del.status, n: kept.length }));
  const delE = (await logs(`action=DELETE_USER&entity_id=${gone.user.user_id}`)).logs[0];
  ok(delE?.before?.email === goneEmail && delE.before.role === 'user', 'user deletion stores who was deleted');
  await call('DELETE', `/api/events/${ae.event_id}`, null, admin.token);
  const delEv = (await logs(`action=DELETE_EVENT&entity_type=event&entity_id=${ae.event_id}`)).logs[0];
  ok(delEv?.before?.title === `Audit ${stamp}` && delEv.before.bookings_removed === 0, 'event deletion stores the removed event');
}

// --- client IP behind proxies (audit entries and rate limits use it)
{
  const ipFor = async (xff) => {
    const r = await call('POST', '/api/auth/login', { email: `ip-${stamp}@test.local`, password: 'wrong-pass-1' }, null, { 'X-Forwarded-For': xff });
    const rid = r.headers.get('x-request-id');
    return (await call('GET', `/api/admin/audit-logs?search=${rid}`, null, admin.token)).data.logs[0]?.ip;
  };
  ok(await ipFor('203.0.113.9, 10.31.22.165') === '203.0.113.9', 'internal proxy hops are skipped: the visitor IP is recorded');
  ok(await ipFor('198.51.100.7, 203.0.113.9, 10.0.0.5') === '203.0.113.9', 'a forged X-Forwarded-For entry cannot replace the real visitor IP');
}

// --- delivery: compression and caching
{
  const r = await fetch(`${BASE}/api/events?limit=50`, { headers: { 'Accept-Encoding': 'gzip' } });
  ok(r.headers.get('content-encoding') === 'gzip', 'API responses are gzip-compressed');
  const page = await fetch(`${BASE}/`);
  if (page.status === 200 && (page.headers.get('content-type') || '').includes('html')) { // only when the frontend is built
    const html = await page.text();
    const asset = html.match(/\/assets\/[\w.-]+\.js/)?.[0];
    const a = asset && await fetch(BASE + asset, { headers: { 'Accept-Encoding': 'gzip' } });
    ok(page.headers.get('cache-control') === 'no-cache' && a?.headers.get('cache-control')?.includes('immutable') && a.headers.get('content-encoding') === 'gzip',
      'index.html is revalidated; hashed assets are cached for a year and compressed');
    const missing = await fetch(`${BASE}/assets/nope-123.js`);
    ok(missing.status === 404 && !(await missing.text()).includes('id="root"'), 'a missing asset is a 404, not the app page');
    const robots = await fetch(`${BASE}/robots.txt`);
    ok(robots.status === 200 && (await robots.text()).startsWith('User-agent'), 'robots.txt is served');
  } else console.log('SKIP  static asset checks (frontend not built)');
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
