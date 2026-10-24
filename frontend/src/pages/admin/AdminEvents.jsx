import { useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Alert, ConfirmDialog, Empty, Field, Modal, Spinner } from '../../components/ui.jsx';
import { fmtDate, fmtTime, today } from '../../lib/format.js';

const blank = { title: '', description: '', venue: '', event_date: '', start_time: '', end_time: '', capacity: '', restrict: false, school_ids: [] };

export default function AdminEvents() {
  const toast = useToast();
  const [events, setEvents] = useState(null);
  const [schools, setSchools] = useState([]);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null); // null | {id?, ...fields}
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(null);

  const load = () => api.get('/events?past=1').then((r) => setEvents(r.events)).catch((e) => setError(e.message));
  useEffect(() => { load(); api.get('/schools').then((r) => setSchools(r.schools)); }, []);

  const open = (e) => {
    setErrors({}); setFormError('');
    setEditing(e ? { id: e.event_id, title: e.title, description: e.description || '', venue: e.venue, event_date: e.event_date.slice(0, 10),
      start_time: fmtTime(e.start_time), end_time: fmtTime(e.end_time), capacity: String(e.capacity), restrict: e.school_ids.length > 0, school_ids: e.school_ids } : { ...blank });
  };
  const set = (k) => (ev) => setEditing({ ...editing, [k]: ev.target.value });
  const toggleSchool = (id) => setEditing({ ...editing, school_ids: editing.school_ids.includes(id) ? editing.school_ids.filter((x) => x !== id) : [...editing.school_ids, id] });

  const save = async (ev) => {
    ev.preventDefault(); setErrors({}); setFormError('');
    if (editing.restrict && editing.school_ids.length === 0) { setErrors({ school_ids: 'Choose at least one school, or select Everyone.' }); return; }
    const body = { title: editing.title, description: editing.description, venue: editing.venue, event_date: editing.event_date,
      start_time: editing.start_time, end_time: editing.end_time, capacity: Number(editing.capacity), school_ids: editing.restrict ? editing.school_ids : [] };
    setBusy(true);
    try {
      editing.id ? await api.put(`/events/${editing.id}`, body) : await api.post('/events', body);
      toast.ok(editing.id ? 'Event updated.' : 'Event created.');
      setEditing(null); load();
    } catch (err) { err.field ? setErrors({ [err.field]: err.message }) : setFormError(err.message); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    try { const r = await api.del(`/events/${deleting.event_id}`); toast.ok(`Event deleted${r.removed_bookings ? ` along with ${r.removed_bookings} bookings` : ''}.`); setDeleting(null); load(); }
    catch (e) { toast.error(e.message); setDeleting(null); }
  };

  return (
    <div>
      <div className="row spread page-head">
        <div><h1>Events</h1><p>Create, edit and delete events. Past events stay listed for reports.</p></div>
        <button className="btn" onClick={() => open(null)}><Plus size={18} aria-hidden />New event</button>
      </div>
      {error && <Alert>{error}</Alert>}
      {!events && !error && <Spinner />}
      {events?.length === 0 && <Empty title="No events yet">Select New event to add the first one.</Empty>}
      {events?.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Event</th><th>Date</th><th>Venue</th><th>Booked</th><th>Open to</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.event_id}>
                  <td><strong>{e.title}</strong>{e.is_past && <> <span className="badge">Ended</span></>}</td>
                  <td>{fmtDate(e.event_date, { day: 'numeric', month: 'short', year: 'numeric' })}<br /><span className="muted small">{fmtTime(e.start_time)} to {fmtTime(e.end_time)}</span></td>
                  <td>{e.venue}</td>
                  <td><span className={`badge ${e.seats_remaining <= 0 ? 'bad' : ''}`}>{e.booked}/{e.capacity}</span></td>
                  <td>{e.restricted_to.length ? e.restricted_to.join(', ') : 'Everyone'}</td>
                  <td className="actions">
                    <button className="btn secondary sm" onClick={() => open(e)} aria-label={`Edit ${e.title}`}><Pencil size={15} aria-hidden />Edit</button>
                    <button className="btn danger sm" onClick={() => setDeleting(e)} aria-label={`Delete ${e.title}`}><Trash2 size={15} aria-hidden />Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={!!editing} wide title={editing?.id ? 'Edit event' : 'New event'} onClose={() => setEditing(null)}
        footer={<><button type="button" className="btn secondary" onClick={() => setEditing(null)}>Cancel</button><button className="btn" form="event-form" disabled={busy}>{busy ? 'Saving…' : 'Save event'}</button></>}>
        {editing && (
          <form id="event-form" onSubmit={save} noValidate>
            {formError && <Alert>{formError}</Alert>}
            <Field label="Title" error={errors.title}>{(p) => <input {...p} value={editing.title} onChange={set('title')} />}</Field>
            <Field label="Description" error={errors.description}>{(p) => <textarea {...p} value={editing.description} onChange={set('description')} />}</Field>
            <div className="grid-2">
              <Field label="Venue" error={errors.venue}>{(p) => <input {...p} value={editing.venue} onChange={set('venue')} />}</Field>
              <Field label="Capacity (seats)" error={errors.capacity}>{(p) => <input {...p} type="number" min="1" value={editing.capacity} onChange={set('capacity')} />}</Field>
            </div>
            <div className="grid-3">
              <Field label="Date" error={errors.event_date}>{(p) => <input {...p} type="date" min={editing.id ? undefined : today()} value={editing.event_date} onChange={set('event_date')} />}</Field>
              <Field label="Start time" error={errors.start_time}>{(p) => <input {...p} type="time" value={editing.start_time} onChange={set('start_time')} />}</Field>
              <Field label="End time" error={errors.end_time}>{(p) => <input {...p} type="time" value={editing.end_time} onChange={set('end_time')} />}</Field>
            </div>
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="label" style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.4rem' }}>Who can book?</legend>
              <div className="row" style={{ marginBottom: '0.6rem' }}>
                <label className="check"><input type="radio" name="who" checked={!editing.restrict} onChange={() => setEditing({ ...editing, restrict: false })} />Everyone</label>
                <label className="check"><input type="radio" name="who" checked={editing.restrict} onChange={() => setEditing({ ...editing, restrict: true })} />Selected schools only</label>
              </div>
              {editing.restrict && (
                <div className="checks">
                  {schools.map((s) => <label key={s.school_id} className="check"><input type="checkbox" checked={editing.school_ids.includes(s.school_id)} onChange={() => toggleSchool(s.school_id)} />{s.school_name}</label>)}
                </div>
              )}
              {errors.school_ids && <div className="field"><div className="err">{errors.school_ids}</div></div>}
            </fieldset>
          </form>
        )}
      </Modal>
      <ConfirmDialog open={!!deleting} danger title="Delete this event?" confirmLabel="Delete event" onClose={() => setDeleting(null)} onConfirm={remove}
        message={deleting ? `"${deleting.title}" and its ${deleting.booked} booking${deleting.booked === 1 ? '' : 's'} will be removed permanently.` : ''} />
    </div>
  );
}
