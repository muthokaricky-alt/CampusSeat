import { Router } from 'express';
import { query } from '../db.js';
import { AppError, asyncHandler } from '../utils/errors.js';
import * as v from '../utils/validate.js';
import { audit } from '../utils/audit.js';
import { requireAdmin } from '../middleware/auth.js';
import { listParams } from '../utils/list.js';
import { isoFields, localDayRangeUtc, localToday, sqlToLocal } from '../utils/time.js';
import { csvRow } from '../utils/pdf.js';

/**
 * Admin audit trail: read, filter and export. Deliberately read-only: there are no routes that
 * change or delete audit entries (and the database refuses it too, see src/auditProtection.js).
 */
const router = Router();
router.use(requireAdmin);

const EXPORT_MAX = 50_000;
const BATCH = 1000;

/**
 * Filters (all optional, combined with AND):
 *   actor=<user id>  person=<name or email text>  action=A,B,C  entity_type=event  entity_id=12
 *   from=YYYY-MM-DD  to=YYYY-MM-DD (Nairobi days)  search=<text in details, email, name, IP or request id>
 */
function buildFilters(q) {
  const where = []; const params = [];
  if (q.actor) { where.push('a.user_id = ?'); params.push(v.int(q.actor, 'actor')); }
  if (q.person) {
    const p = v.likePattern(String(q.person).slice(0, 100));
    where.push('(a.actor_email LIKE ? OR u.full_name LIKE ? OR u.email LIKE ?)'); params.push(p, p, p);
  }
  if (q.action) {
    const list = [...new Set(String(q.action).split(',').map((s) => s.trim()).filter(Boolean))].slice(0, 50);
    if (list.length) { where.push(`a.action IN (${list.map(() => '?').join(',')})`); params.push(...list.map((s) => s.slice(0, 100))); }
  }
  if (q.entity_type) { where.push('a.entity_type = ?'); params.push(String(q.entity_type).slice(0, 30)); }
  if (q.entity_id) { where.push('a.entity_id = ?'); params.push(String(q.entity_id).slice(0, 64)); }
  if (q.search) {
    const p = v.likePattern(String(q.search).slice(0, 100));
    where.push('(a.details LIKE ? OR a.actor_email LIKE ? OR u.full_name LIKE ? OR u.email LIKE ? OR a.ip LIKE ? OR a.request_id LIKE ?)');
    params.push(p, p, p, p, p, p);
  }
  // from/to are Nairobi calendar days; logged_at is UTC.
  const range = localDayRangeUtc(q.from ? v.date(q.from, 'from', 'From date') : null, q.to ? v.date(q.to, 'to', 'To date') : null);
  if (range.start) { where.push('a.logged_at >= ?'); params.push(range.start); }
  if (range.end) { where.push('a.logged_at < ?'); params.push(range.end); }
  return { where, params };
}

const FROM = 'FROM audit_logs a LEFT JOIN users u ON u.user_id = a.user_id';
const FIELDS = `a.log_id, a.logged_at, a.action, a.entity_type, a.entity_id, a.details, a.before_json, a.after_json,
  a.ip, a.user_agent, a.request_id, a.user_id AS actor_id, COALESCE(a.actor_email, u.email) AS actor_email, u.full_name, u.email`;

const shape = (r) => {
  const { before_json, after_json, ...rest } = r;
  return isoFields({ ...rest, before: before_json ?? null, after: after_json ?? null, has_changes: !!(before_json || after_json) }, ['logged_at']);
};

router.get('/audit-logs', asyncHandler(async (req, res) => {
  const { where, params } = buildFilters(req.query);
  const lp = listParams(req.query, { sorts: { time: 'a.logged_at', action: 'a.action' }, defaultSort: 'time', defaultDir: 'desc', tiebreak: 'a.log_id' });
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [{ total }] = await query(`SELECT COUNT(*) AS total ${FROM} ${w}`, params);
  const logs = await query(`SELECT ${FIELDS} ${FROM} ${w} ${lp.orderBy} ${lp.limitSql}`, params);
  const actions = (await query('SELECT DISTINCT action FROM audit_logs ORDER BY action')).map((r) => r.action);
  const entityTypes = (await query('SELECT DISTINCT entity_type FROM audit_logs WHERE entity_type IS NOT NULL ORDER BY entity_type')).map((r) => r.entity_type);
  res.json({ logs: logs.map(shape), meta: lp.meta(total), actions, entity_types: entityTypes });
}));

/**
 * CSV export of everything matching the filters (newest first, at most 50,000 rows).
 * Streamed in batches (keyset pagination on log_id), so memory use stays flat whatever the size.
 */
router.get('/audit-logs/export', asyncHandler(async (req, res) => {
  const { where, params } = buildFilters(req.query);
  const stamp = localToday();
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="campusseat-audit-${stamp}.csv"`);
  res.write('﻿'); // BOM so Excel reads UTF-8
  res.write(`${csvRow(['Time (EAT)', 'Time (UTC)', 'Actor email', 'Actor name', 'Action', 'Entity type', 'Entity id', 'Details',
    'Before', 'After', 'IP address', 'User agent', 'Request id', 'Log id'])}\n`);
  let lastId = null; let written = 0;
  while (written < EXPORT_MAX) {
    const w = [...where, ...(lastId === null ? [] : ['a.log_id < ?'])];
    const rows = await query(
      `SELECT ${FIELDS} ${FROM} ${w.length ? `WHERE ${w.join(' AND ')}` : ''} ORDER BY a.log_id DESC LIMIT ${Math.min(BATCH, EXPORT_MAX - written)}`,
      lastId === null ? params : [...params, lastId]);
    if (!rows.length) break;
    let chunk = '';
    for (const r of rows) {
      chunk += `${csvRow([sqlToLocal(r.logged_at), r.logged_at, r.actor_email, r.full_name, r.action, r.entity_type, r.entity_id, r.details,
        r.before_json ? JSON.stringify(r.before_json) : '', r.after_json ? JSON.stringify(r.after_json) : '', r.ip, r.user_agent, r.request_id, r.log_id])}\n`;
    }
    if (!res.write(chunk)) await new Promise((resolve) => res.once('drain', resolve)); // respect back-pressure
    written += rows.length;
    lastId = rows.at(-1).log_id;
    if (rows.length < BATCH) break;
  }
  res.end();
  const { page: _p, limit: _l, ...filters } = req.query;
  await audit(req, 'AUDIT_EXPORT', { entity: ['audit_log', 'export'], after: { filters, rows: written, truncated: written >= EXPORT_MAX }, details: `Exported ${written} audit entr${written === 1 ? 'y' : 'ies'} to CSV` });
}));

router.get('/audit-logs/:id', asyncHandler(async (req, res) => {
  const id = v.int(req.params.id, 'id');
  const [row] = await query(`SELECT ${FIELDS} ${FROM} WHERE a.log_id = ?`, [id]);
  if (!row) throw new AppError(404, 'NOT_FOUND', 'Audit entry not found.');
  res.json({ log: shape(row) });
}));

export default router;
