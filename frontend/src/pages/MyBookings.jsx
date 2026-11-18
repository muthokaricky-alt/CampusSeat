import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Alert, Empty, Spinner } from '../components/ui.jsx';
import RegistrationCard from '../components/RegistrationCard.jsx';
import { fmtDate } from '../lib/format.js';

export default function MyBookings() {
  const [params, setParams] = useSearchParams();
  const fresh = params.get('new');
  const [bookings, setBookings] = useState(null);
  const [waiting, setWaiting] = useState([]);
  const [error, setError] = useState('');
  const load = () => {
    api.get('/bookings/mine?limit=100').then((r) => setBookings(r.bookings)).catch((e) => setError(e.message));
    api.get('/bookings/waitlist').then((r) => setWaiting(r.waitlist)).catch(() => {});
  };
  useEffect(() => { load(); }, []);
  return (
    <div className="container page">
      <div className="page-head">
        <h1>My bookings</h1>
        <p>Your registration cards. Show the card or the booking reference at the event.</p>
      </div>
      {fresh && <div style={{ marginBottom: '1.25rem' }}><Alert type="ok">Booking confirmed. Download your card below.</Alert></div>}
      {error && <Alert>{error}</Alert>}
      {waiting.length > 0 && (
        <section className="card" style={{ marginBottom: '1.25rem' }} aria-labelledby="wl-h">
          <h2 id="wl-h" style={{ fontSize: '1.15rem' }}>On the waitlist</h2>
          <ul className="plain-list">{waiting.map((w) => (
            <li key={w.waitlist_id}><Link to={`/events/${w.event_id}`}>{w.title}</Link> <span className="muted small">{fmtDate(w.event_date)} · number {w.position} in the queue</span></li>
          ))}</ul>
        </section>
      )}
      {!bookings && !error && <Spinner />}
      {bookings && bookings.length === 0 && <Empty title="You have no bookings yet"><Link to="/">Browse events</Link> and reserve a seat.</Empty>}
      <div className="stack">
        {bookings?.map((b) => <RegistrationCard key={b.booking_id} booking={b} highlight={b.booking_ref === fresh} onCancelled={() => { if (fresh === b.booking_ref) setParams({}, { replace: true }); load(); }} />)}
      </div>
    </div>
  );
}
