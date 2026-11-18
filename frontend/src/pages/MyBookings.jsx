import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Hourglass } from 'lucide-react';
import { api } from '../lib/api.js';
import { Alert, PageSkeleton } from '../components/ui.jsx';
import RegistrationCard from '../components/RegistrationCard.jsx';
import { fmtDate } from '../lib/format.js';

/** Cards grouped by what matters now: upcoming first (soonest first), then waitlist places, then past events. */
export default function MyBookings() {
  const [params, setParams] = useSearchParams();
  const fresh = params.get('new');
  const [bookings, setBookings] = useState(null);
  const [waiting, setWaiting] = useState([]);
  const [error, setError] = useState('');
  const [showPast, setShowPast] = useState(false);
  const load = () => {
    api.get('/bookings/mine?limit=100&sort=date&dir=asc').then((r) => { setBookings(r.bookings); setError(''); }).catch((e) => setError(e.message));
    api.get('/bookings/waitlist').then((r) => setWaiting(r.waitlist)).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const { upcoming, past } = useMemo(() => {
    const now = Date.now();
    const all = bookings || [];
    return {
      upcoming: all.filter((b) => !b.ends_at || new Date(b.ends_at) >= now),
      past: all.filter((b) => b.ends_at && new Date(b.ends_at) < now).reverse(),
    };
  }, [bookings]);
  const cancelled = (b) => () => { if (fresh === b.booking_ref) setParams({}, { replace: true }); load(); };

  return (
    <div className="container page">
      <div className="page-head">
        <h1>My bookings</h1>
        <p>Show the card (printed or on your phone) or the booking reference at the entrance.</p>
      </div>
      {fresh && <div style={{ marginBottom: '1.25rem' }}><Alert type="ok">Booking confirmed. Your card is below.</Alert></div>}
      {error && <Alert>{error} <button className="linklike" onClick={load}>Try again</button></Alert>}
      {!bookings && !error && <PageSkeleton bare />}

      {bookings && upcoming.length === 0 && waiting.length === 0 && (
        <div className="empty">
          <h3>{past.length ? 'Nothing coming up' : 'You have no bookings yet'}</h3>
          <p>Find something on campus and reserve a seat in one tap.</p>
          <Link className="btn" to="/">Browse events</Link>
        </div>
      )}

      {upcoming.length > 0 && (
        <section aria-labelledby="up-h">
          <h2 id="up-h" className="group-title">Coming up <span className="muted small">{upcoming.length}</span></h2>
          <div className="stack">
            {upcoming.map((b) => <RegistrationCard key={b.booking_id} booking={b} highlight={b.booking_ref === fresh} onCancelled={cancelled(b)} />)}
          </div>
        </section>
      )}

      {waiting.length > 0 && (
        <section className="card" style={{ marginTop: '1.75rem' }} aria-labelledby="wl-h">
          <h2 id="wl-h" style={{ fontSize: '1.15rem' }}><Hourglass size={18} aria-hidden style={{ verticalAlign: '-3px' }} /> On the waitlist</h2>
          <p className="small muted">If a seat frees up it is booked for you automatically and we email you.</p>
          <ul className="plain-list">{waiting.map((w) => (
            <li key={w.waitlist_id}><Link to={`/events/${w.event_id}`}>{w.title}</Link> <span className="muted small">{fmtDate(w.event_date)} · number {w.position} in the queue</span></li>
          ))}</ul>
        </section>
      )}

      {past.length > 0 && (
        <section style={{ marginTop: '2rem' }} aria-labelledby="past-h">
          <h2 id="past-h" className="group-title">Past events <span className="muted small">{past.length}</span></h2>
          {showPast
            ? <div className="stack past">{past.map((b) => <RegistrationCard key={b.booking_id} booking={b} />)}</div>
            : <button className="btn secondary" onClick={() => setShowPast(true)} aria-expanded="false">Show {past.length} past booking{past.length === 1 ? '' : 's'}</button>}
        </section>
      )}
    </div>
  );
}
