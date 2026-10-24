// Event card component: shows a single event in a list of events, with a stub on the left and details on the right.

// The stub shows the date, the details show the title, time, venue, and a seat meter. 
// The seat meter shows how many seats are left and how many are booked. If the event is full, it shows "Event full". If the event is past, it dims the card.
import { Link } from 'react-router-dom';

import { MapPin, Clock, Users, CheckCircle2 } from 'lucide-react';

//
import { fmtDate, fmtTime } from '../lib/format.js';

export function SeatMeter({ booked, capacity }) {
  const left = capacity - booked;
  const pct = Math.min(100, Math.round((booked / capacity) * 100));
  const state = left <= 0 ? 'full' : left / capacity <= 0.2 ? 'low' : '';
  return (
    <div>
      <div className="seats-line">
        <span>{left <= 0 ? 'Event full' : `${left} ${left === 1 ? 'seat' : 'seats'} left`}</span>
        <span className="muted">{booked}/{capacity}</span>
      </div>
      <div className={`meter ${state}`} role="img" aria-label={`${booked} of ${capacity} seats booked`}><i style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

export const restrictionLabel = (e) => (e.restricted_to?.length ? e.restricted_to.join(', ') : 'Open to everyone');

/** Event shown as a ticket: the date is the stub, the details sit on the right. */
export default function EventCard({ event: e }) {
  const d = new Date(`${e.event_date}T00:00:00`);
  const full = e.seats_remaining <= 0;
  return (
    <article className={`ticket ${e.is_past ? 'dim' : ''}`}>
      <div className="stub" aria-hidden>
        <span className="wk">{d.toLocaleDateString('en-GB', { weekday: 'short' })}</span>
        <span className="day">{d.getDate()}</span>
        <span className="mon">{d.toLocaleDateString('en-GB', { month: 'short' })}</span>
      </div>
      <div className="body">
        <h3><Link to={`/events/${e.event_id}`}>{e.title}</Link></h3>
        <div className="meta">
          <span><Clock size={15} aria-hidden /><span className="sr-only">Time: </span>{fmtTime(e.start_time)} to {fmtTime(e.end_time)}</span>
          <span><MapPin size={15} aria-hidden /><span className="sr-only">Venue: </span>{e.venue}</span>
          <span><Users size={15} aria-hidden /><span className="sr-only">Open to: </span>{restrictionLabel(e)}</span>
        </div>
        <SeatMeter booked={e.booked} capacity={e.capacity} />
        <div className="foot">
          {e.my_booking && <span className="badge ok"><CheckCircle2 size={14} aria-hidden />You have a seat</span>}
          {!e.my_booking && e.eligible === false && <span className="badge warn">Not open to your school</span>}
          {!e.my_booking && e.eligible !== false && full && <span className="badge bad">Full</span>}
          {e.is_past && <span className="badge">Ended</span>}
        </div>
      </div>
    </article>
  );
}
