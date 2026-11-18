// 009: richer, append-only audit trail.
// - New columns: actor_email (kept even if the account is later deleted), entity_type/entity_id,
//   before_json/after_json (what changed), ip, user_agent, request_id (ties the entry to the server log).
//   user_id stays the column for the actor (renaming it would mean re-creating a foreign key on a live table).
// - Append-only: no routes update or delete audit rows, and BEFORE UPDATE / BEFORE DELETE triggers refuse
//   any change at database level. MySQL does not fire triggers for foreign-key cascades, so deleting a user
//   still sets user_id to NULL (actor_email keeps who it was).
//   Some hosts refuse CREATE TRIGGER without SUPER when binary logging is on (possibly Aiven's free plan).
//   Then this migration logs a warning instead of failing, so the app still starts; see README "Audit trail".
const COLUMNS = [
  ['actor_email', 'VARCHAR(100) NULL AFTER user_id'],
  ['entity_type', 'VARCHAR(30) NULL AFTER action'],
  ['entity_id', 'VARCHAR(64) NULL AFTER entity_type'],
  ['before_json', 'JSON NULL AFTER details'],
  ['after_json', 'JSON NULL AFTER before_json'],
  ['ip', 'VARCHAR(45) NULL AFTER after_json'],
  ['user_agent', 'VARCHAR(255) NULL AFTER ip'],
  ['request_id', 'VARCHAR(64) NULL AFTER user_agent'],
];
const INDEXES = [
  ['idx_audit_entity', '(entity_type, entity_id, logged_at)'],
  ['idx_audit_actor_email', '(actor_email, logged_at)'],
];

const has = async (conn, sql, params) => Number((await conn.query(sql, params))[0][0].n) > 0;

export async function up(conn, { dryRun, log }) {
  for (const [name, def] of COLUMNS) {
    if (await has(conn, 'SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?', ['audit_logs', name])) continue;
    log(`audit_logs.${name}${dryRun ? ' (would add)' : ''}`);
    if (!dryRun) await conn.query(`ALTER TABLE audit_logs ADD COLUMN ${name} ${def}, ALGORITHM=INPLACE, LOCK=NONE`);
  }
  for (const [name, cols] of INDEXES) {
    if (await has(conn, 'SELECT COUNT(*) AS n FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?', ['audit_logs', name])) continue;
    log(`audit_logs.${name} ${cols}${dryRun ? ' (would add)' : ''}`);
    if (!dryRun) await conn.query(`ALTER TABLE audit_logs ADD INDEX ${name} ${cols}, ALGORITHM=INPLACE, LOCK=NONE`);
  }
  if (dryRun) { log('would backfill actor_email and add append-only triggers'); return; }

  // Existing rows: remember the actor's email now, while the accounts still exist.
  // (Runs before the triggers exist, so it is allowed.)
  const [r] = await conn.query(
    'UPDATE audit_logs a JOIN users u ON u.user_id = a.user_id SET a.actor_email = u.email WHERE a.actor_email IS NULL');
  log(`backfilled actor_email on ${r.affectedRows} row(s)`);

  const { protectAuditLog } = await import('../src/auditProtection.js');
  const r2 = await protectAuditLog(conn);
  if (r2.ok) log('append-only triggers in place');
  else {
    log(`WARNING: could not create the append-only triggers (${r2.error}). The app never updates or deletes `
      + 'audit rows; to add database-level protection later run "npm run audit:protect" (see README "Audit trail").');
  }
}
