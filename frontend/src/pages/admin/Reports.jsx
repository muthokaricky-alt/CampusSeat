import { useEffect, useState } from 'react';
import { CalendarDays, FileText, FileSpreadsheet, Ticket } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Alert } from '../../components/ui.jsx';
import { TableSkeleton } from '../../components/admin/DataTable.jsx';
import { fmtDate, fmtDateTime } from '../../lib/format.js';

// The JSON API returns UTC ISO times (for programs); the preview shows them the way the PDF and CSV do.
const cell = (key, v) => {
  if (v == null || v === '') return '';
  if (/_at$/.test(key)) return fmtDateTime(v);
  if (key === 'event_date') return fmtDate(v, { day: 'numeric', month: 'short', year: 'numeric' });
  return String(v);
};

export default function Reports() {
  const toast = useToast();
  const [type, setType] = useState('bookings');
  const [f, setF] = useState({ from: '', to: '', event_id: '', school_id: '', sort: '', dir: 'desc' });
  const [events, setEvents] = useState([]);
  const [schools, setSchools] = useState([]);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api.get('/admin/event-options').then((r) => setEvents(r.events)).catch(() => {}); api.get('/schools').then((r) => setSchools(r.schools)); }, []);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const qs = (format) => {
    const p = new URLSearchParams({ format });
    Object.entries(f).forEach(([k, v]) => { if (v && !(type === 'events' && (k === 'event_id' || k === 'school_id'))) p.set(k, v); });
    return p.toString();
  };
  useEffect(() => { setData(null); setError(''); api.get(`/admin/reports/${type}?${qs('json')}`).then(setData).catch((e) => setError(e.message)); }, [type, f]);
  const download = (format) =>
    api.file(`/admin/reports/${type}?${qs(format)}`, { filename: `campusseat-${type}-report.${format}` }).then(() => toast.ok(`${format.toUpperCase()} report downloaded.`)).catch((e) => toast.error(e.message));
  const sorts = type === 'bookings'
    ? [['', 'Booked at'], ['name', 'Name'], ['event', 'Event'], ['school', 'School'], ['ref', 'Reference']]
    : [['', 'Event date'], ['title', 'Title'], ['booked', 'Seats booked'], ['capacity', 'Capacity']];
  return (
    <div>
      <div className="page-head admin-head">
        <div><h1>Reports</h1><p>Choose a report, narrow it down, check the preview, then download. PDFs carry the CampusSeat name and the date.</p></div>
        <div className="row">
          <button className="btn" onClick={() => download('pdf')}><FileText size={18} aria-hidden />Download PDF</button>
          <button className="btn secondary" onClick={() => download('csv')}><FileSpreadsheet size={18} aria-hidden />Download CSV</button>
        </div>
      </div>
      <div className="toolbar">
        <div className="field"><span className="label" id="rt-l">Report</span>
          <div className="chips" role="radiogroup" aria-labelledby="rt-l">
            {[['bookings', 'Bookings', Ticket], ['events', 'Events summary', CalendarDays]].map(([v, l, Icon]) => (
              <button key={v} type="button" role="radio" aria-checked={type === v} className={`chip ${type === v ? 'on' : ''}`} onClick={() => { setType(v); setF({ ...f, sort: '' }); }}><Icon size={15} aria-hidden />{l}</button>
            ))}
          </div></div>
        <div className="field"><label htmlFor="rf"><span className="label">{type === 'bookings' ? 'Booked from' : 'Events from'}</span></label><input id="rf" type="date" value={f.from} onChange={set('from')} /></div>
        <div className="field"><label htmlFor="rto"><span className="label">To</span></label><input id="rto" type="date" value={f.to} min={f.from || undefined} onChange={set('to')} /></div>
        {type === 'bookings' && <>
          <div className="field"><label htmlFor="re"><span className="label">Event</span></label>
            <select id="re" value={f.event_id} onChange={set('event_id')}><option value="">All events</option>{events.map((e) => <option key={e.event_id} value={e.event_id}>{e.title}</option>)}</select></div>
          <div className="field"><label htmlFor="rs"><span className="label">School</span></label>
            <select id="rs" value={f.school_id} onChange={set('school_id')}><option value="">All schools</option>{schools.map((s) => <option key={s.school_id} value={s.school_id}>{s.school_name}</option>)}</select></div>
        </>}
        <div className="field"><label htmlFor="rso"><span className="label">Sort by</span></label>
          <select id="rso" value={f.sort} onChange={set('sort')}>{sorts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        <div className="field"><label htmlFor="rd"><span className="label">Order</span></label>
          <select id="rd" value={f.dir} onChange={set('dir')}><option value="desc">Newest or largest first</option><option value="asc">Oldest or smallest first</option></select></div>
      </div>
      {error && <Alert>{error}</Alert>}
      {data && (
        <div className="report-summary" aria-live="polite">
          {data.totals.map((t) => <span key={t} className="badge info">{t}</span>)}
          {data.filters.map((t) => <span key={t} className="badge">{t}</span>)}
        </div>
      )}
      <div className="table-wrap"><table>
        <thead><tr>{(data?.columns || [{ key: 'a', label: '\u00a0' }, { key: 'b', label: '' }, { key: 'c', label: '' }, { key: 'd', label: '' }]).map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
        {!data && !error && <TableSkeleton cols={4} rows={6} />}
        {data && <tbody>
          {data.rows.length === 0 && <tr><td colSpan={data.columns.length} className="table-empty"><strong>No results for these filters</strong><br /><span className="muted">Widen the dates or choose all events.</span></td></tr>}
          {data.rows.slice(0, 200).map((r, i) => <tr key={i}>{data.columns.map((c) => <td key={c.key} className={/ref|number/.test(c.key) ? 'nowrap' : undefined}>{cell(c.key, r[c.key])}</td>)}</tr>)}
        </tbody>}
      </table></div>
      {data?.rows.length > 200 && <p className="muted small" style={{ marginTop: '0.6rem' }}>The preview shows the first 200 rows. Downloads include all {data.rows.length}.</p>}
    </div>
  );
}
