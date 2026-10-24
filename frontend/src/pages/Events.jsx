import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Alert, Empty, Field, Spinner, useDebounced } from '../components/ui.jsx';
import EventCard from '../components/EventCard.jsx';

export default function Events() {
  const { user } = useAuth();
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [onlyMine, setOnlyMine] = useState(false);
  const [available, setAvailable] = useState(false);
  const [events, setEvents] = useState(null);
  const [error, setError] = useState('');
  const search = useDebounced(q);

  useEffect(() => {
    const p = new URLSearchParams();
    if (search) p.set('search', search);
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    if (onlyMine && user) p.set('school', user.school_id);
    if (available) p.set('available', '1');
    let live = true;
    api.get(`/events?${p}`).then((r) => { if (live) { setEvents(r.events); setError(''); } })
      .catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [search, from, to, onlyMine, available, user]);

  const filtered = search || from || to || onlyMine || available;
  return (
    <div className="container page">
      <div className="hero">
        <h1>Find an event. Take a seat.</h1>
        <p>Browse what is on at campus, check how many seats are left, and book in one step.</p>
      </div>
      <div className="toolbar" role="search">
        <div className="field search">
          <label htmlFor="q"><span className="label">Search events</span></label>
          <div className="search-box"><Search size={18} aria-hidden /><input id="q" type="search" placeholder="Title, venue or topic" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        </div>
        <Field label="From">{(p) => <input {...p} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />}</Field>
        <Field label="To">{(p) => <input {...p} type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />}</Field>
        <label className="check"><input type="checkbox" checked={available} onChange={(e) => setAvailable(e.target.checked)} />Seats available</label>
        {user && <label className="check"><input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} />Open to my school</label>}
      </div>
      {error && <Alert>{error}</Alert>}
      {!events && !error && <Spinner />}
      {events && events.length === 0 && (
        <Empty title={filtered ? 'No events match your search' : 'No upcoming events yet'}>
          {filtered ? 'Try clearing a filter or searching for something else.' : 'Check back soon. New events are added by the events team.'}
        </Empty>
      )}
      {events && events.length > 0 && <div className="ticket-grid">{events.map((e) => <EventCard key={e.event_id} event={e} />)}</div>}
    </div>
  );
}
