import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { MapPin, Users, ArrowLeft, Armchair, Pencil, Hourglass } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Alert, Field, PageSkeleton } from '../components/ui.jsx';
import { SeatMeter, restrictionLabel } from '../components/EventCard.jsx';
import RegistrationCard from '../components/RegistrationCard.jsx';
import ClickSpark from '../components/reactbits/ClickSpark.jsx';
import { fmtDate, fmtTime } from '../lib/format.js';
import { loadGsap } from '../motion/index.js';
import CoverArt from '../components/CoverArt.jsx';
import SaveButton from '../components/SaveButton.jsx';
import { categoryOf } from '../lib/categories.js';

/**
 * Booking flow, designed for the fewest steps: the account's details are already filled in
 * (shown as a summary, editable), so booking is one tap on a large button.
 * Feedback: the seat count drops at once (optimistic, rolled back on error), the button gives,
 * sparks burst, and the registration card "prints" into place. All of it is skipped with reduced motion.
 */
export default function EventDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const loc = useLocation();
  const toast = useToast();
  const [event, setEvent] = useState(null);
  const [schools, setSchools] = useState([]);
  const [mine, setMine] = useState(null);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [optimistic, setOptimistic] = useState(0); // seats taken locally before the server answers
  const [justBooked, setJustBooked] = useState(false);
  const [announce, setAnnounce] = useState('');
  const [form, setForm] = useState({ full_name: '', student_number: '', school_id: '' });
  const btnRef = useRef(null);
  const sparkRef = useRef(null);
  const cardRef = useRef(null);
  const panelRef = useRef(null);

  const load = () => api.get(`/events/${id}`).then((r) => { setEvent(r.event); setOptimistic(0); }).catch((e) => setError(e.message));
  useEffect(() => { setEvent(null); setMine(null); setJustBooked(false); load(); }, [id, user?.user_id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (user && editing) api.get('/schools').then((r) => setSchools(r.schools)).catch(() => {}); }, [user, editing]);
  useEffect(() => {
    if (user) setForm({ full_name: user.full_name, student_number: user.student_number, school_id: String(user.school_id) });
  }, [user]);
  useEffect(() => {
    if (event?.my_booking) api.get(`/bookings/mine?event_id=${event.event_id}`).then((r) => setMine(r.bookings[0] || null)).catch(() => {});
  }, [event?.my_booking?.booking_id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Arriving from a card's "Reserve a seat": bring the booking panel into view and focus its button.
  useEffect(() => {
    if (event && loc.hash === '#book' && panelRef.current) {
      panelRef.current.scrollIntoView({ block: 'center', behavior: 'instant' });
      (btnRef.current || panelRef.current.querySelector('a,button'))?.focus({ preventScroll: true });
    }
  }, [event, loc.hash]);

  // The confirmation: the card "prints" in, part by part (staging), and settles with a small overshoot.
  // Runs once per booking (the booking can be re-fetched while it plays), and every tween states its
  // end values (fromTo), so an interrupted animation can never leave the card half-visible.
  const playedFor = useRef(null);
  useLayoutEffect(() => {
    if (!justBooked || !mine || !cardRef.current || playedFor.current === mine.booking_id) return;
    playedFor.current = mine.booking_id;
    const el = cardRef.current;
    loadGsap().then((gsap) => {
      if (!gsap || !el.isConnected) return;
      const parts = (...names) => names.flatMap((n) => [...el.querySelectorAll(`[data-part="${n}"]`)]);
      const shown = { opacity: 1, y: 0, clearProps: 'opacity,transform' };
      gsap.timeline({ defaults: { ease: 'power3.out' } })
        .fromTo(el, { y: -28, scaleY: 0.92, opacity: 0, transformOrigin: '50% 0%' }, { ...shown, scaleY: 1, duration: 0.42, ease: 'back.out(1.6)' })
        .fromTo(parts('head'), { opacity: 0 }, { ...shown, duration: 0.18 }, '-=0.25')
        .fromTo(parts('details', 'qr'), { opacity: 0, y: 8 }, { ...shown, stagger: 0.05, duration: 0.24 }, '-=0.12')
        .fromTo(parts('cut'), { scaleX: 0, transformOrigin: '0% 50%' }, { scaleX: 1, clearProps: 'transform', duration: 0.22 }, '-=0.1')
        .fromTo(parts('ref', 'actions'), { opacity: 0, y: 6 }, { ...shown, stagger: 0.05, duration: 0.2 }, '-=0.08');
    });
  }, [justBooked, mine]);

  const press = async (down) => {
    const gsap = await loadGsap();
    if (gsap && btnRef.current) gsap.to(btnRef.current, { scale: down ? 0.96 : 1, duration: down ? 0.08 : 0.25, ease: down ? 'power2.out' : 'back.out(3)' });
  };
  const shake = async () => {
    const gsap = await loadGsap();
    if (gsap && btnRef.current) gsap.fromTo(btnRef.current, { x: 0 }, { x: 6, duration: 0.05, repeat: 5, yoyo: true, ease: 'sine.inOut', clearProps: 'x' });
  };

  const book = async (e) => {
    e?.preventDefault();
    if (busy) return;
    setErrors({}); setFormError(''); setBusy(true);
    setOptimistic(1);
    try {
      const r = await api.post('/bookings', { event_id: event.event_id, ...form, school_id: Number(form.school_id) });
      sparkRef.current?.spark();
      setAnnounce(`Seat booked. Your booking reference is ${r.booking.booking_ref}.`);
      const [b] = (await api.get(`/bookings/mine?event_id=${event.event_id}`)).bookings;
      setMine(b || null);
      setJustBooked(true);
      setEvent((ev) => ({ ...ev, booked: ev.booked + 1, seats_remaining: ev.seats_remaining - 1, my_booking: { booking_id: r.booking.booking_id, booking_ref: r.booking.booking_ref } }));
      setOptimistic(0);
      setEditing(false);
    } catch (err) {
      setOptimistic(0);
      if (err.field) { setErrors({ [err.field]: err.message }); setEditing(true); } else setFormError(err.message);
      shake();
      load(); // seats may have changed
    } finally { setBusy(false); }
  };

  const waitlist = async (action) => {
    setBusy(true); setFormError('');
    try {
      if (action === 'join') { const r = await api.post(`/events/${event.event_id}/waitlist`); toast.ok(`You're number ${r.waitlist.position} on the waitlist. We'll email you if a seat frees up.`); }
      else { await api.del(`/events/${event.event_id}/waitlist`); toast.ok('You left the waitlist.'); }
    } catch (err) { setFormError(err.message); toast.error(err.message); }
    finally { setBusy(false); load(); }
  };

  if (error) {
    return (
      <div className="container page">
        <div className="empty"><h1 style={{ fontSize: '1.6rem' }}>We couldn't open this event</h1><p>{error}</p><Link className="btn secondary" to="/">Back to all events</Link></div>
      </div>
    );
  }
  if (!event) return <PageSkeleton />;

  const booked = event.booked + optimistic;
  const full = event.seats_remaining - optimistic <= 0;
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const schoolName = schools.find((s) => String(s.school_id) === form.school_id)?.school_name || user?.school_name;
  const canBook = user && !event.my_booking && !event.is_past && event.eligible !== false && !full && !event.my_waitlist;

  let panel;
  if (!user) {
    panel = (
      <div className="card stack">
        <h2>Book your seat</h2>
        <p className="muted">Log in once and every booking after that is a single tap.</p>
        <Link className="btn block lg" to="/login" state={{ from: loc.pathname }}>Log in to book</Link>
        <p className="small">New here? <Link to="/register">Create an account</Link> (it takes a minute).</p>
      </div>
    );
  } else if (event.my_booking) {
    panel = mine
      ? <RegistrationCard ref={cardRef} booking={mine} highlight={justBooked} onCancelled={() => { setMine(null); setJustBooked(false); load(); }} />
      : <PageSkeleton bare />;
  } else if (event.is_past) {
    panel = <div className="card"><Alert type="warn">This event has already taken place.</Alert></div>;
  } else if (event.eligible === false) {
    panel = <div className="card"><Alert type="warn">This event is open to {restrictionLabel(event)} only. Your school is {user.school_name}.</Alert></div>;
  } else if (event.my_waitlist) {
    panel = (
      <div className="card stack">
        <h2><Hourglass size={20} aria-hidden style={{ verticalAlign: '-3px' }} /> You're on the waitlist</h2>
        <p>Your place in the queue: <strong className="big-num">{event.my_waitlist.position}</strong> of {event.waitlist_count}.</p>
        <p className="muted small">If a seat frees up, it is booked for you automatically and we email you. Nothing else to do.</p>
        <button className="btn secondary block" disabled={busy} onClick={() => waitlist('leave')}>Leave the waitlist</button>
      </div>
    );
  } else if (full) {
    panel = (
      <div className="card stack">
        <h2>This event is full</h2>
        <p className="muted">{event.waitlist_count ? `${event.waitlist_count} ${event.waitlist_count === 1 ? 'person is' : 'people are'} waiting.` : 'Nobody is waiting yet.'} Join the waitlist and the next free seat is booked for you automatically.</p>
        {formError && <Alert>{formError}</Alert>}
        <button className="btn block lg" disabled={busy} onClick={() => waitlist('join')}>{busy ? 'Joining…' : 'Join the waitlist'}</button>
      </div>
    );
  } else {
    panel = (
      <form className="card stack book-panel" onSubmit={book} noValidate>
        <h2>Book your seat</h2>
        {!editing ? (
          <div className="booking-as">
            <div>
              <span className="small muted">Booking as</span>
              <strong>{form.full_name}</strong>
              <span className="small muted">{form.student_number} · {schoolName}</span>
            </div>
            <button type="button" className="btn ghost sm" onClick={() => setEditing(true)} aria-label="Edit the details used for this booking"><Pencil size={15} aria-hidden />Edit</button>
          </div>
        ) : (
          <div>
            <p className="muted small">These must match your account.</p>
            <Field label="Full name" error={errors.full_name}>{(p) => <input {...p} autoComplete="name" value={form.full_name} onChange={set('full_name')} />}</Field>
            <Field label="Student or staff number" error={errors.student_number}>{(p) => <input {...p} value={form.student_number} onChange={set('student_number')} />}</Field>
            <Field label="School" error={errors.school_id}>{(p) => (
              <select {...p} value={form.school_id} onChange={set('school_id')}>
                {schools.map((s) => <option key={s.school_id} value={s.school_id}>{s.school_name}</option>)}
              </select>)}</Field>
          </div>
        )}
        {formError && <Alert>{formError}</Alert>}
        <div className="spark-wrap">
          <button ref={btnRef} className="btn block xl" disabled={busy} aria-describedby="seat-note"
            onPointerDown={() => press(true)} onPointerUp={() => press(false)} onPointerLeave={() => press(false)}>
            <Armchair size={20} aria-hidden />{busy ? 'Booking your seat…' : 'Reserve my seat'}
          </button>
          {/* Sparks only when the booking succeeds (triggered from book()), not on every press. */}
          <ClickSpark ref={sparkRef} sparkColor={['#2447d6', '#f0a500', '#0b7a52']} sparkCount={12} sparkRadius={46} sparkSize={12} shape="line" duration={520}
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />
        </div>
        <p id="seat-note" className="small muted center">Free. You can cancel up to 2 hours before it starts.</p>
      </form>
    );
  }

  return (
    <div className="container page">
      <p><Link to="/" className="row small back-link"><ArrowLeft size={16} aria-hidden />All events</Link></p>
      <header className="event-hero">
        <CoverArt category={event.category} seed={event.event_id} />
        <div className="event-hero-inner">
          <span className="t2-cat static">{(() => { const c = categoryOf(event.category); return <><c.icon size={13} aria-hidden />{c.one}</>; })()}</span>
          <h1>{event.title}</h1>
          <p className="event-hero-when">{fmtDate(event.event_date, { weekday: 'long', day: 'numeric', month: 'long' })} · {fmtTime(event.start_time)} to {fmtTime(event.end_time)} · {event.venue}</p>
        </div>
        {!event.is_past && <div className="event-hero-save"><SaveButton event={event} variant="button" /></div>}
      </header>
      <div className="detail">
        <div>
          <h2 className="sr-only">About this event</h2>
          <div className="facts">
            <div><MapPin size={20} aria-hidden />{event.venue}</div>
            <div><Users size={20} aria-hidden />{restrictionLabel(event)}</div>
          </div>
          {event.description && <p className="lede">{event.description}</p>}
          <div className="card" style={{ marginTop: '1rem' }}><SeatMeter booked={booked} capacity={event.capacity} live /></div>
        </div>
        <div ref={panelRef} id="book">{panel}</div>
      </div>
      <p className="sr-only" role="status" aria-live="assertive">{announce}</p>
      {/* Phones: the main action stays within thumb reach at the bottom of the screen. */}
      {canBook && (
        <div className="mobile-book-bar no-print">
          <div className="small"><strong>{Math.max(0, event.seats_remaining - optimistic)}</strong> seats left</div>
          <button className="btn lg" disabled={busy} onClick={() => { panelRef.current?.scrollIntoView({ block: 'center' }); book(); }}>
            <Armchair size={18} aria-hidden />{busy ? 'Booking…' : 'Reserve my seat'}
          </button>
        </div>
      )}
    </div>
  );
}
