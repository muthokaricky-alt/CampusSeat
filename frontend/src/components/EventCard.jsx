// Event card: still a ticket (perforated edge and notches), now led by generated cover art in the
// event's category colour, with the date as a tab, a save toggle and one clear action.
import { Link } from 'react-router-dom';
import { MapPin, Clock, Users, CheckCircle2, ArrowRight, Hourglass } from 'lucide-react';
import { fmtTime } from '../lib/format.js';
import { categoryOf } from '../lib/categories.js';
import CoverArt from './CoverArt.jsx';
import SaveButton from './SaveButton.jsx';

export function SeatMeter({ booked, capacity, live }) {
  const left = Math.max(0, capacity - booked);
  const pct = Math.min(100, Math.round((booked / capacity) * 100));
  const state = left <= 0 ? 'full' : left / capacity <= 0.2 ? 'low' : '';
  return (
    <div>
      <div className="seats-line">
        <span aria-live={live ? 'polite' : undefined}>{left <= 0 ? 'Event full' : `${left} ${left === 1 ? 'seat' : 'seats'} left`}</span>
        <span className="muted">{booked}/{capacity}</span>
      </div>
      <div className={`meter ${state}`} role="img" aria-label={`${booked} of ${capacity} seats booked`}><i style={{ transform: `scaleX(${pct / 100})` }} /></div>
    </div>
  );
}

export const restrictionLabel = (e) => (e.restricted_to?.length ? e.restricted_to.join(', ') : 'Open to everyone');

/** What the person can do with this event, in priority order. */
function actionFor(e) {
  if (e.is_past) return { label: 'Ended', tone: 'muted' };
  if (e.my_booking) return { label: 'You have a seat', tone: 'ok', icon: CheckCircle2 };
  if (e.my_waitlist) return { label: `Waitlist #${e.my_waitlist.position}`, tone: 'info', icon: Hourglass };
  if (e.eligible === false) return { label: 'Not open to your school', tone: 'warn' };
  if (e.seats_remaining <= 0) return { label: 'Full: join waitlist', tone: 'cta-quiet', icon: ArrowRight };
  return { label: 'Reserve a seat', tone: 'cta', icon: ArrowRight };
}

export default function EventCard({ event: e }) {
  const d = new Date(`${e.event_date}T00:00:00Z`);
  const a = actionFor(e);
  const Icon = a.icon;
  const isCta = a.tone === 'cta' || a.tone === 'cta-quiet';
  const cat = categoryOf(e.category);
  const longDate = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  return (
    <article className={`ticket2 ${e.is_past ? 'dim' : ''}`} data-reveal>
      <div className="t2-art">
        <CoverArt category={e.category} seed={e.event_id} />
        <span className="t2-cat"><cat.icon size={13} aria-hidden />{cat.one}</span>
        <SaveButton event={e} />
        <span className="t2-date" aria-hidden>
          <span className="wk">{d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })}</span>
          <span className="day">{d.getUTCDate()}</span>
          <span className="mon">{d.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })}</span>
        </span>
      </div>
      <div className="t2-body">
        <h3><Link to={`/events/${e.event_id}`}>{e.title}<span className="sr-only">, {cat.one}, {longDate}</span></Link></h3>
        <div className="meta">
          <span><Clock size={15} aria-hidden /><span className="sr-only">Time: </span>{fmtTime(e.start_time)} to {fmtTime(e.end_time)}</span>
          <span><MapPin size={15} aria-hidden /><span className="sr-only">Venue: </span>{e.venue}</span>
          <span><Users size={15} aria-hidden /><span className="sr-only">Open to: </span>{restrictionLabel(e)}</span>
        </div>
        <SeatMeter booked={e.booked} capacity={e.capacity} />
      </div>
      <div className="t2-foot">
        {isCta ? (
          <Link className={`card-cta ${a.tone === 'cta-quiet' ? 'quiet' : ''}`} to={`/events/${e.event_id}#book`} aria-label={`${a.label}: ${e.title}`}>
            {a.label}{Icon && <Icon size={16} aria-hidden />}
          </Link>
        ) : (
          <span className={`badge ${a.tone === 'muted' ? '' : a.tone}`}>{Icon && <Icon size={14} aria-hidden />}{a.label}</span>
        )}
        {e.waitlist_count > 0 && !e.my_waitlist && <span className="small muted">{e.waitlist_count} waiting</span>}
      </div>
    </article>
  );
}
