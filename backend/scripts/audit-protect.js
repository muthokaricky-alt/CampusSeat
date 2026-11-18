// Adds the append-only triggers to audit_logs if they are missing (safe to run again).
//   npm run audit:protect
import mysql from 'mysql2/promise';
import { dbConfig, dbTarget } from '../src/db-config.js';
import { protectAuditLog } from '../src/auditProtection.js';

const conn = await mysql.createConnection(dbConfig);
try {
  const r = await protectAuditLog(conn);
  if (r.ok) console.log(`audit_logs on ${dbTarget()} is append-only (triggers in place).`);
  else { console.error(`Could not add the triggers on ${dbTarget()}: ${r.error}`); process.exitCode = 1; }
} finally {
  await conn.end();
}
