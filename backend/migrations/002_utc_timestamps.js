// 002: store every timestamp in UTC.
//
// 1. events get starts_at / ends_at (UTC DATETIME), computed from the Nairobi wall-clock
//    event_date + start_time / end_time. The "event already passed" check uses ends_at.
// 2. Existing created_at / booked_at / logged_at values are fixed. Up to commit 79de9f6 the
//    database session ran in UTC; from that deploy on it ran at +03:00, so later rows hold
//    Nairobi time. TZ_CUTOVER_UTC must say when that deploy went live (ISO time, e.g.
//    2026-11-17T17:40:00Z). Rows stored at or after cutover + 3 h are Nairobi time and are
//    moved back 3 hours. UTC rows written before the cutover are always earlier than the
//    cutover, so the two groups cannot be confused.
//    TZ_CUTOVER_UTC=none skips step 2 (fresh databases, or data you do not care about).
//    TZ_CUTOVER_UTC=all treats every existing row as Nairobi time.
const OFFSET_HOURS = 3; // Africa/Nairobi, no daylight saving
const COLUMNS = [['users', 'created_at'], ['events', 'created_at'], ['bookings', 'booked_at'], ['audit_logs', 'logged_at']];

async function hasColumn(conn, table, column) {
  const [[{ n }]] = await conn.query(
    'SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?', [table, column]);
  return Number(n) > 0;
}

export async function up(conn, { dryRun, log, env }) {
  // ---- 0. decide how to treat existing timestamps BEFORE changing anything
  const raw = (env.TZ_CUTOVER_UTC || '').trim();
  const counts = await Promise.all(COLUMNS.map(async ([t]) => Number((await conn.query(`SELECT COUNT(*) AS n FROM ${t}`))[0][0].n)));
  const anyRows = counts.some((n) => n > 0);
  const skipShift = raw === 'none' || (!raw && !anyRows);
  if (!raw && !skipShift) {
    throw new Error('TZ_CUTOVER_UTC is required for this database because it already has data. Set it to the time the '
      + '"Use Kenyan time zone for database connections" deploy went live (e.g. TZ_CUTOVER_UTC=2026-11-17T17:40:00Z, from the Render '
      + 'deploy log), or "all" / "none". Run with --dry-run first to see how many rows would change.');
  }
  let threshold = null;
  if (skipShift) { /* nothing to shift */ } else if (raw === 'all') threshold = '1000-01-01 00:00:00';
  else {
    const d = new Date(raw);
    if (Number.isNaN(d.getTime()) || !/(Z|[+-]\d\d:?\d\d)$/.test(raw)) throw new Error(`TZ_CUTOVER_UTC must be an ISO time with a zone, e.g. 2026-11-17T17:40:00Z (got "${raw}")`);
    threshold = new Date(d.getTime() + OFFSET_HOURS * 3600_000).toISOString().slice(0, 19).replace('T', ' ');
  }
  // ---- 1. starts_at / ends_at
  const [[{ events }]] = await conn.query('SELECT COUNT(*) AS events FROM events');
  log(`events: add starts_at/ends_at (UTC) for ${events} event(s)`);
  if (!dryRun) {
    if (!(await hasColumn(conn, 'events', 'starts_at'))) {
      await conn.query('ALTER TABLE events ADD COLUMN starts_at DATETIME NULL AFTER end_time, ADD COLUMN ends_at DATETIME NULL AFTER starts_at');
    }
    await conn.query(`UPDATE events SET
        starts_at = TIMESTAMP(event_date, start_time) - INTERVAL ${OFFSET_HOURS} HOUR,
        ends_at   = TIMESTAMP(event_date, end_time)   - INTERVAL ${OFFSET_HOURS} HOUR
      WHERE starts_at IS NULL OR ends_at IS NULL`);
    await conn.query('ALTER TABLE events MODIFY starts_at DATETIME NOT NULL, MODIFY ends_at DATETIME NOT NULL');
  }

  // ---- 2. shift Nairobi-time rows written after the cutover
  if (skipShift) { log('timestamps: no shift (TZ_CUTOVER_UTC=none or empty database)'); return; }
  log(`timestamps: rows stored at or after ${threshold} are Nairobi time and move back ${OFFSET_HOURS} h`);

  await conn.beginTransaction();
  try {
    for (const [table, col] of COLUMNS) {
      const [[{ n }]] = await conn.query(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col} >= ?`, [threshold]);
      log(`  ${table}.${col}: ${n} row(s)${dryRun ? ' would change' : ''}`);
      if (!dryRun && Number(n)) await conn.query(`UPDATE ${table} SET ${col} = ${col} - INTERVAL ${OFFSET_HOURS} HOUR WHERE ${col} >= ?`, [threshold]);
    }
    await (dryRun ? conn.rollback() : conn.commit());
  } catch (err) {
    await conn.rollback();
    throw err;
  }
}
