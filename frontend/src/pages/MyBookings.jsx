import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Alert, Empty, Spinner } from '../components/ui.jsx';
import RegistrationCard from '../components/RegistrationCard.jsx';

export default function MyBookings() {
  const [params] = useSearchParams();
  const fresh = params.get('new');
  const [bookings, setBookings] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api.get('/bookings/mine').then((r) => setBookings(r.bookings)).catch((e) => setError(e.message)); }, []);
  return (
    <div className="container page">
      <div className="page-head">
        <h1>My bookings</h1>
        <p>Your registration cards. Show the card or the booking reference at the event.</p>
      </div>
      {fresh && <div style={{ marginBottom: '1.25rem' }}><Alert type="ok">Booking confirmed. Download your card below.</Alert></div>}
      {error && <Alert>{error}</Alert>}
      {!bookings && !error && <Spinner />}
      {bookings && bookings.length === 0 && <Empty title="You have no bookings yet"><Link to="/">Browse events</Link> and reserve a seat.</Empty>}
      <div className="stack">
        {bookings?.map((b) => <RegistrationCard key={b.booking_id} booking={b} highlight={b.booking_ref === fresh} />)}
      </div>
    </div>
  );
}
