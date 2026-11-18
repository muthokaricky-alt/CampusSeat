import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CircleCheck, Download, Search, XCircle } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Alert, ConfirmDialog, useDebounced } from '../../components/ui.jsx';
import { SortHeader, TableFooter, TableSkeleton, listState } from '../../components/admin/DataTable.jsx';
import { fmtClock, fmtDate, fmtDateTime } from '../../lib/format.js';

const ALL_COLS = 7;
const ATTENDED = [['', 'All'], ['1', 'Checked in'], ['0', 'Not yet']];

export default function AdminBookings() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const st = listState(params, { sort: 'booked_at', dir: 'desc', limit: 50 });
  const eventId = st.get('event_id');
  const attended = st.get('attended');
  const [q, setQ] = useState(st.get('search'));
  const search = useDebounced(q);
  const [events, setEvents] = useState([]);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [cancelling, setCancelling] = useState(null);

  const update = (changes) => {
    const next = new URLSearchParams(params);
    Object.entries(changes).forEach(([k, v]) => (v ? next.set(k, String(v)) : next.delete(k)));
    if (!('page' in changes)) next.delete('page');
    setParams(next, { replace: true });
  };
  useEffect(() => { if (search !== st.get('search')) update({ search }); }, [search]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { api.get('/admin/event-options').then((r) => setEvents(r.events)).catch(() => {}); }, []);

  const load = () => {
    const p = new URLSearchParams({ page: st.page, limit: st.limit, sort: st.sort, dir: st.dir });
    if (eventId) p.set('event_id', eventId);
    if (attended) p.set('attended', attended);
    if (st.get('search')) p.set('search', st.get('search'));
    setData((d) => (d ? { ...d, loading: true } : d));
    return api.get(`/bookings?${p}`).then((r) => { setData(r); setError(''); }).catch((e) => setError(e.message));
  };
  useEffect(() => { load(); }, [params]); // eslint-disable-line react-hooks/exhaustive-deps

  const cancel = async () => {
    try {
      const r = await api.del(`/bookings/${cancelling.booking_id}`);
      toast.ok(r.promoted ? 'Booking cancelled. The seat went to the next person on the waitlist.' : 'Booking cancelled. The seat is available again.');
      setCancelling(null); load();
    } catch (e) { toast.error(e.message); setCancelling(null); }
  };
  const card = (b) => api.file(`/bookings/${b.booking_id}/card`, { filename: `registration-card-${b.booking_ref}.pdf` }).catch((e) => toast.error(e.message));
  const sortProps = { sort: st.sort, dir: st.dir, onSort: (sort, dir) => update({ sort, dir }) };
  const chosen = events.find((e) => String(e.event_id) === eventId);
  const rows = data?.bookings;
  const COLS = eventId ? ALL_COLS - 1 : ALL_COLS; // one event chosen: its title would repeat on every row

  return (
    <div>
      <div className="page-head admin-head">
        <div><h1>Bookings</h1><p>{chosen ? <>Everyone booked for <strong>{chosen.title}</strong>.</> : 'Who booked what. Cancel a booking to free its seat (the waitlist gets it).'}</p></div>
      </div>
      <div className="toolbar">
        <div className="field"><label htmlFor="ev"><span className="label">Event</span></label>
          <select id="ev" value={eventId} onChange={(e) => update({ event_id: e.target.value })}>
            <option value="">All events</option>
            {events.map((e) => <option key={e.event_id} value={e.event_id}>{e.title} ({fmtDate(e.event_date, { day: 'numeric', month: 'short' })})</option>)}
          </select></div>
        <div className="field search"><label htmlFor="bq"><span className="label">Search</span></label>
          <div className="search-box"><Search size={18} aria-hidden /><input id="bq" type="search" placeholder="Name, student number, email or reference" value={q} onChange={(e) => setQ(e.target.value)} /></div></div>
      </div>
      <div className="chips" role="group" aria-label="At the door" style={{ marginBottom: '1rem' }}>
        {ATTENDED.map(([v, label]) => (
          <button key={label} className={`chip ${attended === v ? 'on' : ''}`} aria-pressed={attended === v} onClick={() => update({ attended: v })}>{label}</button>
        ))}
      </div>
      {error && <Alert>{error} <button className="linklike" onClick={load}>Try again</button></Alert>}

      <div className={`table-wrap ${data?.loading ? 'is-loading' : ''}`}>
        <table>
          <thead><tr>
            <SortHeader label="Reference" sortKey="ref" {...sortProps} />
            <SortHeader label="Person" sortKey="name" {...sortProps} />
            <SortHeader label="School" sortKey="school" {...sortProps} />
            {!eventId && <SortHeader label="Event" sortKey="event" {...sortProps} />}
            <SortHeader label="Booked" sortKey="booked_at" defaultDir="desc" {...sortProps} />
            <th scope="col">At the door</th>
            <th><span className="sr-only">Actions</span></th>
          </tr></thead>
          {!rows && !error && <TableSkeleton cols={COLS} />}
          {rows && (
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={COLS} className="table-empty">
                  <strong>No bookings found</strong><br /><span className="muted">{st.get('search') || eventId ? 'Try another event or search term.' : 'Bookings appear here as soon as people reserve seats.'}</span>
                </td></tr>
              )}
              {rows.map((b) => (
                <tr key={b.booking_id}>
                  <td className="nowrap"><code className="k">{b.booking_ref}</code></td>
                  <td><strong>{b.full_name}</strong><br /><span className="muted small wrap-any">{b.email} · {b.student_number}</span></td>
                  <td className="small">{b.school_name}</td>
                  {!eventId && <td>{b.title}<br /><span className="muted small">{fmtDate(b.event_date, { day: 'numeric', month: 'short' })}</span></td>}
                  <td className="small nowrap">{fmtDateTime(b.booked_at)}</td>
                  <td className="small nowrap">{b.checked_in_at
                    ? <span className="badge ok" title={`Checked in ${fmtDateTime(b.checked_in_at)}`}><CircleCheck size={13} aria-hidden />In {fmtClock(b.checked_in_at)}</span>
                    : <span className="muted">Not yet</span>}</td>
                  <td className="actions">
                    <button className="btn ghost sm icon-only" onClick={() => card(b)} aria-label={`Download card ${b.booking_ref}`} title="Download card"><Download size={16} aria-hidden /></button>
                    <button className="btn ghost sm icon-only danger-text" onClick={() => setCancelling(b)} aria-label={`Cancel booking ${b.booking_ref}`} title="Cancel booking"><XCircle size={16} aria-hidden /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          )}
        </table>
      </div>
      <TableFooter meta={data?.meta} noun="bookings" onPage={(page) => update({ page })} onLimit={(limit) => update({ limit })} />

      <ConfirmDialog open={!!cancelling} danger title="Cancel this booking?" confirmLabel="Cancel booking" onClose={() => setCancelling(null)} onConfirm={cancel}
        message={cancelling ? `${cancelling.full_name}'s seat for "${cancelling.title}" (${cancelling.booking_ref}) will be released. If people are waiting, the first one gets it.` : ''} />
    </div>
  );
}
