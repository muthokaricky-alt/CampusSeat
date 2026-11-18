
export const fmtDate = (d, opts = {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric'
}) =>
  d
    ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', opts)
    : '';

export const fmtTime = (t) => (t ? String(t).slice(0, 5) : '');

// Interpret database timestamps as UTC and display them in
// East Africa Time (EAT), UTC+3.
export const fmtDateTime = (dt) => {
  if (!dt) return '';

  const value = String(dt).trim();

  // Check whether the timestamp already contains a timezone.
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);

  // Convert MySQL DATETIME format into ISO format.
  const isoValue = value.includes('T')
    ? value
    : value.replace(' ', 'T');

  // Assume UTC if no timezone is provided.
  const date = new Date(
    hasTimezone ? isoValue : `${isoValue}Z`
  );

  if (Number.isNaN(date.getTime())) return '';

  return date.toLocaleString('en-GB', {
    timeZone: 'Africa/Nairobi',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
};

// Event dates are Nairobi calendar dates, so "today" is the Nairobi date wherever the browser is.
export const APP_TZ = 'Africa/Nairobi';
export const today = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: APP_TZ });

/** Shift a "YYYY-MM-DD" date by n days (calendar arithmetic, no time zone involved). */
export const addDays = (ymd, n) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Clock time in Nairobi for an ISO/UTC timestamp, e.g. "21:40". */
export const fmtClock = (dt) => (dt
  ? new Intl.DateTimeFormat('en-GB', { timeZone: APP_TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(String(dt).includes('T') ? dt : `${String(dt).replace(' ', 'T')}Z`))
  : '');
