import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, CalendarPlus, Hourglass, Ticket, UserPlus, Armchair } from 'lucide-react';
import { api } from '../../lib/api.js';
import { Alert } from '../../components/ui.jsx';
import { SeatMeter } from '../../components/EventCard.jsx';
import { StatCard, StatCardGroup, change } from '../../components/admin/StatCard.jsx';
import { fmtDate, fmtDateTime } from '../../lib/format.js';

const weekday = (ymd) => new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });

/** 14 bars, the current week in the accent colour, last week muted, so the comparison reads at a glance. */
function BookingBars({ days }) {
  const max = Math.max(1, ...days.map((d) => d.n));
  return (
    <div className="bars14" role="img"
      aria-label={`Bookings per day over the last 14 days: ${days.map((d) => `${weekday(d.day)} ${d.day.slice(8)}: ${d.n}`).join(', ')}`}>
      {days.map((d, i) => (
        <div key={d.day} className={i >= 7 ? 'this' : 'prev'}>
          <span className="n">{d.n || ''}</span>
          <i style={{ transform: `scaleY(${Math.max(d.n / max, 0.02)})` }} />
          <span className="d">{weekday(d.day).slice(0, 2)}</span>
        </div>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const [s, setS] = useState(null);
  const [error, setError] = useState('');
  const load = () => api.get('/admin/stats').then((r) => { setS(r); setError(''); }).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const t = s?.totals;
  const fill = t && t.upcoming_seats ? t.upcoming_booked / t.upcoming_seats : 0;
  return (
    <div>
      <div className="page-head admin-head">
        <div>
          <h1>Dashboard</h1>
          <p>{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Africa/Nairobi' })} · what is happening across events and bookings.</p>
        </div>
        <div className="row">
          <Link className="btn" to="/admin/events?new=1"><CalendarPlus size={18} aria-hidden />New event</Link>
          <Link className="btn secondary" to="/admin/reports"><BarChart3 size={18} aria-hidden />Reports</Link>
        </div>
      </div>

      {error && <Alert>{error} <button className="linklike" onClick={load}>Try again</button></Alert>}

      <StatCardGroup label="Key figures">
        <StatCard icon={Ticket} label="Bookings this week" loading={!s} value={s?.week.bookings}
          delta={s && { value: change(s.week.bookings, s.week.bookings_prev), format: 'percent', label: 'vs last week' }}
          trend={s?.per_day_14.map((d) => d.n)} />
        <StatCard icon={UserPlus} label="New accounts this week" loading={!s} value={s?.week.users}
          delta={s && { value: change(s.week.users, s.week.users_prev), format: 'percent', label: 'vs last week' }}
          trend={s?.signups_14.map((d) => d.n)} />
        <StatCard icon={Armchair} label="Seats filled" loading={!s} value={s ? (fill > 0 && fill < 0.01 ? '<1' : Math.round(fill * 100)) : null} unit="%"
          hint={t && `${t.upcoming_booked} of ${t.upcoming_seats} seats across ${t.upcoming_events} upcoming event${t.upcoming_events === 1 ? '' : 's'}`} />
        <StatCard icon={Hourglass} label="On waitlists" loading={!s} value={t?.waiting}
          hint={t && (t.waiting ? 'People waiting for a seat to free up' : 'Nobody is waiting')} />
      </StatCardGroup>

      <div className="dash-grid">
        <section className="card" aria-labelledby="bk-h">
          <div className="row spread"><h2 id="bk-h">Bookings, last 14 days</h2><span className="legend small muted"><i className="this" />This week <i className="prev" />Week before</span></div>
          {s ? <BookingBars days={s.per_day_14} /> : <span className="skeleton" style={{ height: '9rem' }} />}
        </section>

        <section className="card" aria-labelledby="fill-h">
          <div className="row spread"><h2 id="fill-h">Filling up</h2><Link className="small" to="/admin/events">All events</Link></div>
          {!s && <span className="skeleton" style={{ height: '9rem' }} />}
          {s && s.almost_full.length === 0 && <p className="muted">No upcoming event is 80% full yet.</p>}
          {s && s.almost_full.length > 0 && (
            <ul className="fill-list">
              {s.almost_full.map((e) => (
                <li key={e.event_id}>
                  <div className="row spread">
                    <Link to={`/admin/bookings?event_id=${e.event_id}`}><strong>{e.title}</strong></Link>
                    <span className="small muted">{fmtDate(e.event_date, { day: 'numeric', month: 'short' })}{e.waiting ? ` · ${e.waiting} waiting` : ''}</span>
                  </div>
                  <SeatMeter booked={e.booked} capacity={e.capacity} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="card" style={{ marginTop: '1.25rem' }} aria-labelledby="rec-h">
        <div className="row spread"><h2 id="rec-h">Recent bookings</h2><Link className="small" to="/admin/bookings">All bookings</Link></div>
        {!s && <span className="skeleton" style={{ height: '6rem' }} />}
        {s && s.recent.length === 0 && <p className="muted">No bookings yet. They appear here as soon as people book.</p>}
        {s && s.recent.length > 0 && (
          <ul className="activity">
            {s.recent.map((b) => (
              <li key={b.booking_id}>
                <span className="avatar" aria-hidden>{b.full_name.split(' ').map((w) => w[0]).slice(0, 2).join('')}</span>
                <span className="grow"><strong>{b.full_name}</strong> booked <Link to={`/admin/bookings?event_id=${b.event_id}`}>{b.title}</Link></span>
                <span className="muted small nowrap"><code className="k">{b.booking_ref}</code> · {fmtDateTime(b.booked_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
