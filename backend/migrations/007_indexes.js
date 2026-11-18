// 007: indexes for the list, sort and filter queries. Each one is created only if missing,
// so the migration can be re-run safely (MySQL has no CREATE INDEX IF NOT EXISTS).
const INDEXES = [
  // public event list: WHERE ends_at >= now ... ORDER BY starts_at
  ['events', 'idx_events_ends', '(ends_at)'],
  ['events', 'idx_events_starts', '(starts_at)'],
  // admin bookings list (newest first), per-day dashboard chart, reports by booking date
  ['bookings', 'idx_bookings_booked', '(booked_at)'],
  // bookings of one event in booking order (admin view, waitlist promotion order checks)
  ['bookings', 'idx_bookings_event_time', '(event_id, booked_at)'],
  // audit log filtered by person or by action, newest first
  ['audit_logs', 'idx_audit_user_time', '(user_id, logged_at)'],
  ['audit_logs', 'idx_audit_action_time', '(action, logged_at)'],
  // admin user list, newest first
  ['users', 'idx_users_created', '(created_at)'],
];

export async function up(conn, { dryRun, log }) {
  for (const [table, name, cols] of INDEXES) {
    const [[{ n }]] = await conn.query(
      'SELECT COUNT(*) AS n FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?', [table, name]);
    if (Number(n)) { log(`${table}.${name}: already there`); continue; }
    log(`${table}.${name} ${cols}${dryRun ? ' (would add)' : ''}`);
    // ALGORITHM=INPLACE, LOCK=NONE: building the index does not block reads or writes on a live table.
    if (!dryRun) await conn.query(`ALTER TABLE ${table} ADD INDEX ${name} ${cols}, ALGORITHM=INPLACE, LOCK=NONE`);
  }
}
