import { useEffect, useState } from 'react';
import { Download, XCircle } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Alert, ConfirmDialog, Empty, Spinner, useDebounced } from '../../components/ui.jsx';
import { fmtDate, fmtDateTime } from '../../lib/format.js';

export default function AdminBookings() {
  const toast = useToast();
  const [events, setEvents] = useState([]);
  const [eventId, setEventId] = useState('');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [cancelling, setCancelling] = useState(null);
  const search = useDebounced(q);
  useEffect(() => { api.get('/events?past=1').then((r) => setEvents(r.events)); }, []);
  const load = () => {
    const p = new URLSearchParams(); if (eventId) p.set('event_id', eventId); if (search) p.set('search', search);
    return api.get(`/bookings?${p}`).then((r) => { setRows(r.bookings); setError(''); }).catch((e) => setError(e.message));
  };
  useEffect(() => { load(); }, [eventId, search]);
  const cancel = async () => {
    try { await api.del(`/bookings/${cancelling.booking_id}`); toast.ok('Booking cancelled. The seat is available again.'); setCancelling(null); load(); }
    catch (e) { toast.error(e.message); setCancelling(null); }
  };
  const card = (b) => api.file(`/bookings/${b.booking_id}/card`, { filename: `registration-card-${b.booking_ref}.pdf` }).catch((e) => toast.error(e.message));
  return (
    <div>
      <div className="page-head"><h1>Bookings</h1><p>See who booked each event. Cancel a booking to free its seat.</p></div>
      <div className="toolbar">
        <div className="field"><label htmlFor="ev"><span className="label">Event</span></label>
          <select id="ev" value={eventId} onChange={(e) => setEventId(e.target.value)}>
            <option value="">All events</option>
            {events.map((e) => <option key={e.event_id} value={e.event_id}>{e.title} ({fmtDate(e.event_date, { day: 'numeric', month: 'short' })})</option>)}
          </select></div>
        <div className="field search"><label htmlFor="bq"><span className="label">Search</span></label>
          <input id="bq" type="search" placeholder="Name, student number, email or reference" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>
      {error && <Alert>{error}</Alert>}
      {!rows && !error && <Spinner />}
      {rows?.length === 0 && <Empty title="No bookings found">Try another event or search term.</Empty>}
      {rows?.length > 0 && (
        <div className="table-wrap"><table>
          <thead><tr><th>Reference</th><th>Name</th><th>Student no.</th><th>School</th><th>Event</th><th>Booked</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{rows.map((b) => (
            <tr key={b.booking_id}>
              <td><code className="k">{b.booking_ref}</code></td><td>{b.full_name}<br /><span className="muted small">{b.email}</span></td><td>{b.student_number}</td>
              <td>{b.school_name}</td><td>{b.title}<br /><span className="muted small">{fmtDate(b.event_date, { day: 'numeric', month: 'short' })}</span></td><td>{fmtDateTime(b.booked_at)}</td>
              <td className="actions">
                <button className="btn secondary sm" onClick={() => card(b)} aria-label={`Card for ${b.booking_ref}`}><Download size={15} aria-hidden />Card</button>
                <button className="btn danger sm" onClick={() => setCancelling(b)} aria-label={`Cancel ${b.booking_ref}`}><XCircle size={15} aria-hidden />Cancel</button>
              </td>
            </tr>))}</tbody>
        </table></div>
      )}
      <ConfirmDialog open={!!cancelling} danger title="Cancel this booking?" confirmLabel="Cancel booking" onClose={() => setCancelling(null)} onConfirm={cancel}
        message={cancelling ? `${cancelling.full_name}'s seat for "${cancelling.title}" (${cancelling.booking_ref}) will be released.` : ''} />
    </div>
  );
}
