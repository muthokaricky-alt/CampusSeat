// 010: door check-in (attendance), event categories, saved events.
// - events.category: one of the app's categories (see src/categories.js). Existing events get a category
//   guessed from their title (e.g. "Career Fair" -> career); admins can change it.
// - check_ins: one row per booking that was scanned at the door (who checked them in, and when).
// - saved_events: events a person marked as interesting.
const has = async (conn, sql, params) => Number((await conn.query(sql, params))[0][0].n) > 0;
const colExists = (conn, t, c) => has(conn, 'SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?', [t, c]);
const idxExists = (conn, t, i) => has(conn, 'SELECT COUNT(*) AS n FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?', [t, i]);

// First match wins. Kept simple on purpose: it only seeds existing events once.
const GUESSES = [
  ['career', /career|job|intern|employ|recruit/i],
  ['workshop', /workshop|bootcamp|hands-on|training|clinic/i],
  ['sports', /sport|match|tournament|football|rugby|run\b|marathon|gym/i],
  ['social', /night|mic|party|festival|concert|social|mixer|games/i],
  ['academic', /moot|court|symposium|research|seminar|conference|thesis|lecture/i],
  ['talk', /talk|masterclass|panel|keynote|founder|speaker|forum/i],
];

export async function up(conn, { dryRun, log }) {
  if (!(await colExists(conn, 'events', 'category'))) {
    log(`events.category${dryRun ? ' (would add)' : ''}`);
    if (!dryRun) await conn.query("ALTER TABLE events ADD COLUMN category VARCHAR(20) NOT NULL DEFAULT 'other' AFTER title, ALGORITHM=INPLACE, LOCK=NONE");
  }
  if (!(await idxExists(conn, 'events', 'idx_events_category'))) {
    log(`events.idx_events_category${dryRun ? ' (would add)' : ''}`);
    if (!dryRun) await conn.query('ALTER TABLE events ADD INDEX idx_events_category (category, starts_at), ALGORITHM=INPLACE, LOCK=NONE');
  }
  if (!dryRun) {
    const [rows] = await conn.query("SELECT event_id, title FROM events WHERE category = 'other'");
    let n = 0;
    for (const r of rows) {
      const hit = GUESSES.find(([, re]) => re.test(r.title));
      if (hit) { await conn.query('UPDATE events SET category = ? WHERE event_id = ?', [hit[0], r.event_id]); n++; }
    }
    log(`categorised ${n} of ${rows.length} existing event(s) from their titles`);
  }

  log(`check_ins, saved_events tables${dryRun ? ' (would create)' : ''}`);
  if (dryRun) return;
  await conn.query(`CREATE TABLE IF NOT EXISTS check_ins (
    booking_id     INT      NOT NULL PRIMARY KEY,
    checked_in_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    checked_in_by  INT      NULL,
    INDEX idx_checkins_time (checked_in_at),
    FOREIGN KEY (booking_id)    REFERENCES bookings(booking_id) ON DELETE CASCADE,
    FOREIGN KEY (checked_in_by) REFERENCES users(user_id)       ON DELETE SET NULL
  ) ENGINE=InnoDB`);
  await conn.query(`CREATE TABLE IF NOT EXISTS saved_events (
    user_id    INT      NOT NULL,
    event_id   INT      NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, event_id),
    INDEX idx_saved_event (event_id),
    FOREIGN KEY (user_id)  REFERENCES users(user_id)   ON DELETE CASCADE,
    FOREIGN KEY (event_id) REFERENCES events(event_id) ON DELETE CASCADE
  ) ENGINE=InnoDB`);
}
