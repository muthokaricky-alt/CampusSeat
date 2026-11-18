import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarRange, Search, SlidersHorizontal, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Alert, EventCardSkeleton, Field, useDebounced } from '../components/ui.jsx';
import EventCard from '../components/EventCard.jsx';
import { addDays, today } from '../lib/format.js';
import { canAffordHeavyVisuals, loadGsap } from '../motion/index.js';

// The animated backdrop is its own chunk, requested only on desktops that can afford it.
const HeroBackdrop = lazy(() => import('../components/HeroBackdrop.jsx'));

/** Quick filters: one tap each (fewer decisions than a full form). Dates live behind "More filters". */
const CHIPS = [
  { key: 'all', label: 'All upcoming' },
  { key: 'week', label: 'This week' },
  { key: 'available', label: 'Seats left' },
  { key: 'school', label: 'Open to me', needsUser: true },
];

/** Staggered entrance for cards that have not been revealed yet (transform + opacity only). */
async function reveal(container) {
  const items = [...(container?.querySelectorAll('[data-reveal]:not([data-revealed])') || [])];
  items.forEach((el) => el.setAttribute('data-revealed', ''));
  if (!items.length) return;
  const gsap = await loadGsap();
  if (!gsap) return; // reduced motion: cards are simply there
  gsap.from(items, { opacity: 0, y: 16, scale: 0.98, duration: 0.4, ease: 'back.out(1.4)', stagger: { each: 0.05, grid: 'auto' }, clearProps: 'transform,opacity' });
}

export default function Events() {
  const { user } = useAuth();
  const [q, setQ] = useState('');
  const [chip, setChip] = useState('all');
  const [moreOpen, setMoreOpen] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [events, setEvents] = useState(null);
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState('');
  const [more, setMore] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const search = useDebounced(q);
  const listRef = useRef(null);
  const heavy = useMemo(() => canAffordHeavyVisuals(), []);

  const params = (page = 1) => {
    const p = new URLSearchParams({ page, limit: 24 });
    if (search) p.set('search', search);
    if (chip === 'week') { p.set('from', today()); p.set('to', addDays(today(), 6)); }
    if (chip === 'available') p.set('available', '1');
    if (chip === 'school' && user) p.set('school', user.school_id);
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    return p;
  };

  useEffect(() => {
    let live = true;
    setEvents(null);
    api.get(`/events?${params()}`).then((r) => { if (live) { setEvents(r.events); setMeta(r.meta); setError(''); } })
      .catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [search, chip, from, to, user, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (events?.length) reveal(listRef.current); }, [events]);

  const loadMore = async () => {
    setMore(true);
    try { const r = await api.get(`/events?${params(meta.page + 1)}`); setEvents((l) => [...l, ...r.events]); setMeta(r.meta); }
    catch (e) { setError(e.message); } finally { setMore(false); }
  };

  // Chunk the list: what is on this week, then everything later (easier to scan than one long grid).
  const groups = useMemo(() => {
    if (!events?.length) return [];
    const weekEnd = addDays(today(), 6);
    const soon = events.filter((e) => e.event_date <= weekEnd);
    const later = events.filter((e) => e.event_date > weekEnd);
    if (chip === 'week' || !soon.length || !later.length) return [{ title: null, items: events }];
    return [{ title: 'This week', items: soon }, { title: 'Coming up', items: later }];
  }, [events, chip]);

  const filtered = search || chip !== 'all' || from || to;
  const clear = () => { setQ(''); setChip('all'); setFrom(''); setTo(''); };
  const openSeats = events?.reduce((n, e) => n + Math.max(0, e.seats_remaining), 0);

  return (
    <>
      <section className="hero" aria-labelledby="hero-title">
        {heavy && <Suspense fallback={null}><HeroBackdrop /></Suspense>}
        <div className="container hero-inner">
          <p className="eyebrow">Campus events</p>
          <h1 id="hero-title">Find an event.<br />Take a seat.</h1>
          <p className="hero-sub">Talks, fairs and workshops across campus. See how many seats are left and book in one tap.</p>
          <div className="row hero-actions">
            <a className="btn lg" href="#events">Browse events</a>
            {user ? <Link className="btn ghost lg" to="/my-bookings">My bookings</Link> : <Link className="btn ghost lg" to="/register">Create an account</Link>}
          </div>
          {meta && !filtered && (
            <p className="hero-stats" aria-live="polite"><strong>{meta.total}</strong> upcoming {meta.total === 1 ? 'event' : 'events'}{openSeats > 0 && <> · <strong>{openSeats}</strong> open seats{meta.total > events.length ? ' and more' : ''}</>}</p>
          )}
        </div>
      </section>

      <div className="container page" id="events">
        <div className="filters" role="search">
          <div className="search-box">
            <Search size={18} aria-hidden />
            <label htmlFor="q" className="sr-only">Search events</label>
            <input id="q" type="search" placeholder="Search by title, venue or topic" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="chips" role="radiogroup" aria-label="Show">
            {CHIPS.filter((c) => !c.needsUser || user).map((c) => (
              <button key={c.key} type="button" role="radio" aria-checked={chip === c.key} className={`chip ${chip === c.key ? 'on' : ''}`} onClick={() => setChip(c.key)}>{c.label}</button>
            ))}
            <button type="button" className={`chip ghost ${moreOpen || from || to ? 'on' : ''}`} aria-expanded={moreOpen} aria-controls="more-filters" onClick={() => setMoreOpen((o) => !o)}>
              <SlidersHorizontal size={15} aria-hidden />Dates
            </button>
            {filtered && <button type="button" className="chip ghost" onClick={clear}><X size={15} aria-hidden />Clear</button>}
          </div>
          {moreOpen && (
            <div className="more-filters" id="more-filters">
              <CalendarRange size={18} aria-hidden className="muted" />
              <Field label="From">{(p) => <input {...p} type="date" value={from} min={today()} onChange={(e) => setFrom(e.target.value)} />}</Field>
              <Field label="To">{(p) => <input {...p} type="date" value={to} min={from || today()} onChange={(e) => setTo(e.target.value)} />}</Field>
            </div>
          )}
        </div>

        {error && <Alert>{error} <button className="linklike" onClick={() => { setError(''); setAttempt((n) => n + 1); }}>Try again</button></Alert>}

        <div ref={listRef} aria-busy={!events} aria-live="polite">
          {!events && !error && <div className="ticket-grid">{Array.from({ length: 6 }, (_, i) => <EventCardSkeleton key={i} />)}</div>}
          {events && events.length === 0 && (
            <div className="empty">
              <h3>{filtered ? 'No events match' : 'No upcoming events yet'}</h3>
              <p>{filtered ? 'Try another word, or clear the filters to see everything.' : 'New events are added by the events team. Check back soon.'}</p>
              {filtered && <button className="btn secondary" onClick={clear}>Clear filters</button>}
            </div>
          )}
          {groups.map((g) => (
            <section key={g.title || 'all'} className="event-group" aria-label={g.title || 'Events'}>
              {g.title && <h2 className="group-title">{g.title} <span className="muted small">{g.items.length}</span></h2>}
              <div className="ticket-grid">{g.items.map((e) => <EventCard key={e.event_id} event={e} />)}</div>
            </section>
          ))}
        </div>
        {events && meta && events.length < meta.total && (
          <div className="row" style={{ justifyContent: 'center', marginTop: '1.75rem' }}>
            <button className="btn secondary" onClick={loadMore} disabled={more}>{more ? 'Loading…' : `Show ${Math.min(meta.limit, meta.total - events.length)} more`}</button>
          </div>
        )}
      </div>
    </>
  );
}
