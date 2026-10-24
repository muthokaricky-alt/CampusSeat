// Adds starter data: schools, an admin, a demo student and sample events. Safe to run more than once.
import bcrypt from 'bcryptjs';
import { pool } from '../src/db.js';

const adminPw = process.env.SEED_ADMIN_PASSWORD || 'Admin@12345';
const demoPw = process.env.SEED_DEMO_PASSWORD || 'Student@12345';
const schools = [
  'School of Computing and Engineering Sciences', 'Business School', 'School of Humanities and Social Sciences',
  'Law School', 'School of Tourism and Hospitality', 'School of Finance and Applied Statistics',
];
for (const s of schools) await pool.execute('INSERT IGNORE INTO schools (school_name) VALUES (?)', [s]);
const [sch] = await pool.execute('SELECT school_id, school_name FROM schools');
const id = (name) => sch.find((s) => s.school_name === name).school_id;

const upsertUser = async (name, num, email, pw, school, role) => {
  const [ex] = await pool.execute('SELECT user_id FROM users WHERE email = ?', [email]);
  if (ex.length) return ex[0].user_id;
  const [r] = await pool.execute(
    'INSERT INTO users (full_name, student_number, email, password_hash, school_id, role) VALUES (?,?,?,?,?,?)',
    [name, num, email, await bcrypt.hash(pw, 12), school, role]);
  return r.insertId;
};
const adminId = await upsertUser('System Admin', 'STAFF-001', 'admin@campusseat.local', adminPw, id(schools[0]), 'admin');
await upsertUser('Demo Student', 'DEMO-0001', 'student@campusseat.local', demoPw, id(schools[0]), 'user');

const [[{ n }]] = await pool.execute('SELECT COUNT(*) AS n FROM events');
if (n === 0) {
  const day = (plus) => { const d = new Date(); d.setDate(d.getDate() + plus); return d.toLocaleDateString('en-CA'); };
  const events = [
    ['Career Fair 2026', 'Meet employers hiring graduates and interns. Bring copies of your CV.', 'Main Hall', 5, '09:00', '16:00', 100, []],
    ['AI Research Symposium', 'Student research talks, a panel discussion and a poster session on applied AI.', 'Auditorium B', 8, '14:00', '17:00', 60, [id(schools[0])]],
    ['Entrepreneurship Talk', 'Founders share lessons from building their first business on campus.', 'Lecture Hall 3', 11, '10:00', '12:00', 120, []],
    ['Moot Court Finals', 'Final round of the inter-class moot court competition.', 'Moot Court', 14, '13:00', '16:00', 40, [id(schools[3])]],
    ['Finance and Markets Workshop', 'Hands-on workshop on reading financial statements.', 'Seminar Room 2', 18, '15:00', '17:30', 30, [id(schools[1]), id(schools[5])]],
    ['Open Mic Night', 'Poetry, music and comedy by students. Everyone welcome.', 'Atrium', 21, '18:00', '21:00', 3, []],
  ];
  for (const [t, d, v, plus, st, en, cap, ids] of events) {
    const [r] = await pool.execute(
      'INSERT INTO events (title, description, venue, event_date, start_time, end_time, capacity, created_by) VALUES (?,?,?,?,?,?,?,?)',
      [t, d, v, day(plus), st, en, cap, adminId]);
    for (const sid of ids) await pool.execute('INSERT INTO event_schools (event_id, school_id) VALUES (?, ?)', [r.insertId, sid]);
  }
}
console.log('Seed complete.\n  Admin:        admin@campusseat.local   /', adminPw, '\n  Demo student: student@campusseat.local /', demoPw, '\n  Change these passwords before any real use.');
await pool.end();
