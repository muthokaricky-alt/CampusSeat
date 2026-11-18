/**
 * Database-level protection for the audit trail: BEFORE UPDATE / BEFORE DELETE triggers that refuse
 * any change to audit_logs, so even someone with the app's database login cannot rewrite history
 * through ordinary queries. MySQL does not fire triggers for foreign-key cascades, so deleting a
 * user still sets audit_logs.user_id to NULL (actor_email keeps who it was).
 *
 * Creating triggers with binary logging on needs SUPER or log_bin_trust_function_creators=1
 * (Aiven sets the latter). Without it, creation fails and the app still works; the status is shown by
 * /api/ready and can be retried with `npm run audit:protect`.
 */
const TRIGGERS = {
  audit_logs_no_update: `CREATE TRIGGER audit_logs_no_update BEFORE UPDATE ON audit_logs FOR EACH ROW
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_logs is append-only: rows cannot be changed'`,
  audit_logs_no_delete: `CREATE TRIGGER audit_logs_no_delete BEFORE DELETE ON audit_logs FOR EACH ROW
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_logs is append-only: rows cannot be deleted'`,
};

/** Creates any missing trigger. Returns { ok, error? }. Never throws. */
export async function protectAuditLog(conn) {
  try {
    for (const [name, sql] of Object.entries(TRIGGERS)) {
      if (!(await triggerExists(conn, name))) await conn.query(sql);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `${err.code}: ${err.message}` };
  }
}

async function triggerExists(conn, name) {
  const [[{ n }]] = await conn.query(
    'SELECT COUNT(*) AS n FROM information_schema.triggers WHERE trigger_schema = DATABASE() AND trigger_name = ?', [name]);
  return Number(n) > 0;
}

/** true when both triggers are in place. */
export async function auditLogProtected(conn) {
  for (const name of Object.keys(TRIGGERS)) if (!(await triggerExists(conn, name))) return false;
  return true;
}
