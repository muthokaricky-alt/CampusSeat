/**
 * Time handling. The rule: the database stores UTC; people see and type Africa/Nairobi wall time.
 *   - DATETIME columns (booked_at, created_at, logged_at, starts_at, ends_at) hold UTC.
 *   - Admins enter an event's date and times in Nairobi time; the app converts them to starts_at/ends_at.
 *   - The API returns timestamps as ISO 8601 with a "Z" so browsers convert them correctly.
 * Kenya has no daylight saving, but the conversions use Intl so they stay correct for any IANA zone.
 */
export const APP_TZ = process.env.APP_TZ || 'Africa/Nairobi';

const parts = (date, timeZone) => {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  return Object.fromEntries(f.formatToParts(date).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
};

/** Offset of `timeZone` from UTC at instant `date`, in minutes (Nairobi: +180). */
export function offsetMinutes(date = new Date(), timeZone = APP_TZ) {
  const p = parts(date, timeZone);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/** "+03:00" style offset, for MySQL CONVERT_TZ (works without the time zone tables). */
export function offsetString(date = new Date(), timeZone = APP_TZ) {
  const m = offsetMinutes(date, timeZone);
  const a = Math.abs(m);
  return `${m < 0 ? '-' : '+'}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}

/** Today's date in the app time zone, "YYYY-MM-DD". */
export function localToday(now = new Date(), timeZone = APP_TZ) {
  const p = parts(now, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Wall-clock date + time in the app time zone -> Date (the real instant). */
export function zonedToDate(date, time, timeZone = APP_TZ) {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi, s = 0] = time.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  // Two passes handle zones whose offset differs either side of the instant (DST); one is enough for Nairobi.
  let t = guess - offsetMinutes(new Date(guess), timeZone) * 60000;
  t = guess - offsetMinutes(new Date(t), timeZone) * 60000;
  return new Date(t);
}

/** Date -> MySQL DATETIME string in UTC, "YYYY-MM-DD HH:MM:SS". */
export const toSqlUtc = (d) => d.toISOString().slice(0, 19).replace('T', ' ');

/** Wall-clock (app zone) date + time -> MySQL UTC DATETIME string. */
export const zonedToSqlUtc = (date, time, timeZone = APP_TZ) => toSqlUtc(zonedToDate(date, time, timeZone));

/** MySQL UTC DATETIME string -> ISO 8601 "YYYY-MM-DDTHH:MM:SSZ" (null stays null). */
export const sqlToIso = (s) => (s ? `${String(s).slice(0, 19).replace(' ', 'T')}Z` : s);

/** MySQL UTC DATETIME string -> "YYYY-MM-DD HH:MM" in the app zone, for PDF/CSV reports. */
export function sqlToLocal(s, timeZone = APP_TZ) {
  if (!s) return '';
  const p = parts(new Date(sqlToIso(s)), timeZone);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

/** UTC range [start, end) covering whole local days from..to (inclusive), as MySQL strings. */
export function localDayRangeUtc(from, to, timeZone = APP_TZ) {
  const start = from ? zonedToSqlUtc(from, '00:00:00', timeZone) : null;
  let end = null;
  if (to) {
    const next = new Date(`${to}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
    end = zonedToSqlUtc(next.toISOString().slice(0, 10), '00:00:00', timeZone);
  }
  return { start, end };
}

/** Convert the named DATETIME fields of a row to ISO strings (in place, returns the row). */
export function isoFields(row, fields = ['booked_at', 'created_at', 'logged_at', 'starts_at', 'ends_at']) {
  for (const f of fields) if (row[f] !== undefined) row[f] = sqlToIso(row[f]);
  return row;
}

/** Local-time label for "now", for report headers. */
export const nowLocalLabel = (timeZone = APP_TZ) =>
  `${new Date().toLocaleString('en-GB', { timeZone, dateStyle: 'medium', timeStyle: 'short' })} (${timeZone === 'Africa/Nairobi' ? 'EAT' : timeZone})`;
