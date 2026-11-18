import { pool } from '../db.js';
import { logger } from '../logger.js';

/**
 * Append-only audit trail. One call per thing that happened:
 *
 *   await audit(req, 'EDIT_EVENT', { entity: ['event', id], before, after, details, conn });
 *
 * - The actor is req.user unless `actorId` is given (e.g. a failed login, where nobody is logged in).
 * - IP, user agent and request id come from the request, so an entry can be matched to the server log.
 * - before/after hold the values that changed. Anything that looks secret (passwords, hashes, tokens,
 *   codes) is removed before saving, whatever the caller passes.
 * - Pass `conn` inside a transaction so the entry is saved only if the change itself is committed.
 * - Never throws: a logging failure must not break the person's action (it is logged as an error instead).
 */
const SECRET = /pass(word)?|hash|token|secret|code|otp|totp|challenge|csrf|cookie/i;

export function scrub(v, depth = 0) {
  if (v === null || v === undefined || depth > 4) return v ?? null;
  if (Array.isArray(v)) return v.slice(0, 100).map((x) => scrub(x, depth + 1));
  if (typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = SECRET.test(k) ? '[redacted]' : scrub(x, depth + 1);
    return out;
  }
  return typeof v === 'string' && v.length > 2000 ? `${v.slice(0, 2000)}…` : v;
}

/** Only the keys whose values differ, as { before, after }. Arrays and objects compare by value. */
export function diff(before = {}, after = {}) {
  const b = {}; const a = {};
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null)) { b[k] = before[k] ?? null; a[k] = after[k] ?? null; }
  }
  return { before: b, after: a, changed: Object.keys(a) };
}

const json = (v) => (v === undefined || v === null ? null : JSON.stringify(scrub(v)));

export async function audit(req, action, { actorId, entity, before, after, details = null, conn = pool } = {}) {
  const actor = actorId !== undefined ? actorId : req?.user?.user_id ?? null;
  if (entity && (entity[1] === null || entity[1] === undefined)) entity = null; // e.g. failed login for an unknown email
  try {
    await conn.execute(
      `INSERT INTO audit_logs (user_id, actor_email, action, entity_type, entity_id, details, before_json, after_json, ip, user_agent, request_id)
       VALUES (?, (SELECT email FROM users WHERE user_id = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        actor, actor, String(action).slice(0, 100),
        entity ? String(entity[0]).slice(0, 30) : null, entity ? String(entity[1]).slice(0, 64) : null,
        details === null ? null : String(details).slice(0, 5000),
        json(before), json(after),
        req?.ip?.slice(0, 45) ?? null,
        req ? String(req.get?.('user-agent') || '').slice(0, 255) || null : null,
        req?.id ? String(req.id).slice(0, 64) : null,
      ]);
  } catch (err) {
    logger.error({ err, action }, 'audit log write failed');
  }
}
