import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { Alert, Spinner } from '../../components/ui.jsx';
import { fmtDate, fmtDateTime } from '../../lib/format.js';

const lastSevenDays = (perDay) => {
  const map = new Map(perDay.map((r) => [String(r.day).slice(0, 10), r.n]));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (6 - i));
    const key = d.toLocaleDateString('en-CA');
    return { key, label: d.toLocaleDateString('en-GB', { weekday: 'short' }), n: map.get(key) || 0 };
  });
};

export default function Dashboard() {
  const [s, setS] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api.get('/admin/stats').then(setS).catch((e) => setError(e.message)); }, []);
  if (error) return <Alert>{error}</Alert>;
  if (!s) return <Spinner />;
  const days = lastSevenDays(s.per_day);
  const max = Math.max(1, ...days.map((d) => d.n));
  return (
    <div>
      <div className="page-head"><h1>Dashboard</h1><p>What is happening across events and bookings.</p></div>
      <div className="stats">
        <div className="stat"><div className="n">{s.totals.upcoming_events}</div><div className="l">Upcoming events</div></div>
        <div className="stat"><div className="n">{s.totals.total_bookings}</div><div className="l">Total bookings</div></div>
        <div className="stat"><div className="n">{s.totals.total_users}</div><div className="l">Registered users</div></div>
        <div className="stat"><div className="n">{s.almost_full.length}</div><div className="l">Events 80% full or more</div></div>
      </div>
      <div className="two-col">
        <section className="card">
          <h2>Bookings, last 7 days</h2>
          <div className="bars" role="img" aria-label={`Bookings per day: ${days.map((d) => `${d.label} ${d.n}`).join(', ')}`}>
            {days.map((d) => <div key={d.key}><span>{d.n}</span><i style={{ height: `${(d.n / max) * 80}%` }} /><span>{d.label}</span></div>)}
          </div>
        </section>
        <section className="card">
          <h2>Filling up</h2>
          {s.almost_full.length === 0 ? <p className="muted">No upcoming event is close to full.</p> : (
            <ul className="list-plain">
              {s.almost_full.map((e) => (
                <li key={e.event_id}><span>{e.title}<br /><span className="muted small">{fmtDate(e.event_date)}</span></span><span className="badge warn">{e.booked}/{e.capacity}</span></li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <section className="card" style={{ marginTop: '1.25rem' }}>
        <div className="row spread"><h2>Recent bookings</h2><Link to="/admin/bookings">All bookings</Link></div>
        {s.recent.length === 0 ? <p className="muted">No bookings yet.</p> : (
          <ul className="list-plain">
            {s.recent.map((b) => <li key={b.booking_id}><span>{b.full_name} booked <strong>{b.title}</strong></span><span className="muted small">{b.booking_ref} · {fmtDateTime(b.booked_at)}</span></li>)}
          </ul>
        )}
      </section>
    </div>
  );
}
