import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { CalendarDays, Clock, MapPin, Users, ArrowLeft } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Alert, Field, Spinner } from '../components/ui.jsx';
import { SeatMeter, restrictionLabel } from '../components/EventCard.jsx';
import RegistrationCard from '../components/RegistrationCard.jsx';
import { fmtDate, fmtTime } from '../lib/format.js';

export default function EventDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const toast = useToast();
  const [event, setEvent] = useState(null);
  const [schools, setSchools] = useState([]);
  const [mine, setMine] = useState(null);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ full_name: '', student_number: '', school_id: '' });

  const load = () => api.get(`/events/${id}`).then((r) => setEvent(r.event)).catch((e) => setError(e.message));
  useEffect(() => { load(); api.get('/schools').then((r) => setSchools(r.schools)).catch(() => {}); }, [id, user?.user_id]);
  useEffect(() => {
    if (user) setForm({ full_name: user.full_name, student_number: user.student_number, school_id: String(user.school_id) });
  }, [user]);
  useEffect(() => {
    if (event?.my_booking) api.get('/bookings/mine').then((r) => setMine(r.bookings.find((b) => b.event_id === event.event_id) || null));
  }, [event?.my_booking?.booking_id]);

  const book = async (e) => {
    e.preventDefault(); setErrors({}); setFormError(''); setBusy(true);
    try {
      const r = await api.post('/bookings', { event_id: event.event_id, ...form, school_id: Number(form.school_id) });
      toast.ok(`Seat booked. Your reference is ${r.booking.booking_ref}.`);
      nav(`/my-bookings?new=${r.booking.booking_ref}`);
    } catch (err) {
      err.field ? setErrors({ [err.field]: err.message }) : setFormError(err.message);
      toast.error(err.message);
      load(); // seats may have changed
    } finally { setBusy(false); }
  };

  if (error) return <div className="container page"><Alert>{error}</Alert><p style={{ marginTop: '1rem' }}><Link to="/">Back to events</Link></p></div>;
  if (!event) return <div className="container page"><Spinner /></div>;

  const full = event.seats_remaining <= 0;
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  let panel;
  if (!user) {
    panel = (<div className="card stack"><h2>Book your seat</h2><p className="muted">Log in to reserve a seat for this event.</p>
      <Link className="btn block" to="/login" state={{ from: loc.pathname }}>Log in to book</Link>
      <p className="small">No account? <Link to="/register">Register</Link></p></div>);
  } else if (event.my_booking) {
    panel = mine ? <RegistrationCard booking={mine} /> : <Spinner />;
  } else if (event.is_past) {
    panel = <div className="card"><Alert type="warn">This event has already taken place.</Alert></div>;
  } else if (event.eligible === false) {
    panel = <div className="card"><Alert type="warn">This event is open to {restrictionLabel(event)} only. Your school is {user.school_name}.</Alert></div>;
  } else if (full) {
    panel = <div className="card"><Alert type="bad">This event is full. No seats remain.</Alert></div>;
  } else {
    panel = (
      <form className="card" onSubmit={book} noValidate>
        <h2>Book your seat</h2>
        <p className="muted small">Check your details match your account, then confirm.</p>
        {formError && <Alert>{formError}</Alert>}
        <div style={{ marginTop: '1rem' }}>
          <Field label="Full name" error={errors.full_name}>{(p) => <input {...p} value={form.full_name} onChange={set('full_name')} />}</Field>
          <Field label="Student or staff number" error={errors.student_number}>{(p) => <input {...p} value={form.student_number} onChange={set('student_number')} />}</Field>
          <Field label="School" error={errors.school_id}>{(p) => (
            <select {...p} value={form.school_id} onChange={set('school_id')}>
              {schools.map((s) => <option key={s.school_id} value={s.school_id}>{s.school_name}</option>)}
            </select>)}</Field>
        </div>
        <button className="btn block" disabled={busy}>{busy ? 'Booking…' : 'Confirm booking'}</button>
      </form>
    );
  }

  return (
    <div className="container page">
      <p><Link to="/" className="row small" style={{ gap: '0.3rem', display: 'inline-flex' }}><ArrowLeft size={16} aria-hidden />All events</Link></p>
      <div className="detail">
        <div>
          <h1>{event.title}</h1>
          <div className="facts">
            <div><CalendarDays size={20} aria-hidden />{fmtDate(event.event_date)}</div>
            <div><Clock size={20} aria-hidden />{fmtTime(event.start_time)} to {fmtTime(event.end_time)}</div>
            <div><MapPin size={20} aria-hidden />{event.venue}</div>
            <div><Users size={20} aria-hidden />{restrictionLabel(event)}</div>
          </div>
          {event.description && <p style={{ maxWidth: '62ch' }}>{event.description}</p>}
          <div className="card" style={{ marginTop: '1rem' }}><SeatMeter booked={event.booked} capacity={event.capacity} /></div>
        </div>
        <div>{panel}</div>
      </div>
    </div>
  );
}
