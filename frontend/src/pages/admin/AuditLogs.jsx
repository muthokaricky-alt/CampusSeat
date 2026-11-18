import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, Filter, X } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Alert, Modal, useDebounced } from '../../components/ui.jsx';
import { SortHeader, TableFooter, TableSkeleton } from '../../components/admin/DataTable.jsx';
import { fmtDateTime, today } from '../../lib/format.js';

// Filters live in the address bar, so a filtered view can be bookmarked or shared with another admin.
const KEYS = ['person', 'action', 'entity_type', 'entity_id', 'from', 'to', 'search'];
const badgeFor = (a) => (/FAILED|LOCKED/.test(a) ? 'bad' : /DELETE|CANCEL|DISABLE|RESET/.test(a) ? 'warn' : /LOGIN|LOGOUT/.test(a) ? '' : 'info');
const show = (v) => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));

function ActionPicker({ all, selected, onChange }) {
  const toggle = (a) => onChange(selected.includes(a) ? selected.filter((x) => x !== a) : [...selected, a]);
  return (
    <details className="picker">
      <summary className="btn secondary sm"><Filter size={15} aria-hidden />{selected.length ? `${selected.length} action${selected.length > 1 ? 's' : ''}` : 'All actions'}</summary>
      <div className="picker-menu" role="group" aria-label="Actions">
        {selected.length > 0 && <button type="button" className="linklike small" onClick={() => onChange([])}>Clear</button>}
        {all.map((a) => (
          <label key={a} className="check small"><input type="checkbox" checked={selected.includes(a)} onChange={() => toggle(a)} />{a}</label>
        ))}
      </div>
    </details>
  );
}

function Changes({ before, after }) {
  const keys = [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])];
  if (!keys.length) return <p className="muted small">No field values were recorded for this entry.</p>;
  return (
    <div className="table-wrap"><table className="diff">
      <thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead>
      <tbody>{keys.map((k) => (
        <tr key={k}><th scope="row">{k}</th><td className="old">{show(before?.[k])}</td><td className="new">{show(after?.[k])}</td></tr>
      ))}</tbody>
    </table></div>
  );
}

export default function AuditLogs() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const f = Object.fromEntries(KEYS.map((k) => [k, params.get(k) || '']));
  const page = Number(params.get('page')) || 1;
  const limit = Number(params.get('limit')) || 25;
  const sort = params.get('sort') || 'time';
  const dir = params.get('dir') || 'desc';
  const [text, setText] = useState({ person: f.person, search: f.search, entity_id: f.entity_id });
  const debounced = useDebounced(text);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);
  const [exporting, setExporting] = useState(false);

  const update = (changes) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) (v ? next.set(k, v) : next.delete(k));
    if (!('page' in changes)) next.delete('page');
    setParams(next, { replace: true });
  };
  // typed filters update the URL after a short pause
  useEffect(() => {
    if (debounced.person !== f.person || debounced.search !== f.search || debounced.entity_id !== f.entity_id) update(debounced);
  }, [debounced]); // eslint-disable-line react-hooks/exhaustive-deps

  const query = useMemo(() => {
    const p = new URLSearchParams();
    KEYS.forEach((k) => f[k] && p.set(k, f[k]));
    return p;
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const p = new URLSearchParams(query); p.set('page', page); p.set('limit', limit); p.set('sort', sort); p.set('dir', dir);
    let live = true;
    setData((d) => (d ? { ...d, loading: true } : d));
    api.get(`/admin/audit-logs?${p}`).then((r) => { if (live) { setData(r); setError(''); } }).catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [query, page, limit, sort, dir]);

  const actions = f.action ? f.action.split(',') : [];
  const filtered = KEYS.some((k) => f[k]);
  const exportCsv = async () => {
    setExporting(true);
    try { await api.file(`/admin/audit-logs/export?${query}`, { filename: `campusseat-audit-${today()}.csv` }); toast.ok('Audit log exported.'); }
    catch (e) { toast.error(e.message); } finally { setExporting(false); }
  };

  return (
    <div>
      <div className="page-head row" style={{ justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '1rem' }}>
        <div><h1>Audit logs</h1><p>Every sign-in, change, booking and download: who did it, when, from where, and what changed. Entries can never be edited or deleted.</p></div>
        <button className="btn secondary" onClick={exportCsv} disabled={exporting}><Download size={16} aria-hidden />{exporting ? 'Exporting…' : `Export CSV${filtered ? ' (filtered)' : ''}`}</button>
      </div>

      <div className="toolbar audit-filters">
        <div className="field"><label htmlFor="ap"><span className="label">Person</span></label>
          <input id="ap" type="search" placeholder="Name or email" value={text.person} onChange={(e) => setText({ ...text, person: e.target.value })} /></div>
        <div className="field"><span className="label" id="aa-l">Action</span>
          <ActionPicker all={data?.actions || []} selected={actions} onChange={(l) => update({ action: l.join(',') })} /></div>
        <div className="field"><label htmlFor="aet"><span className="label">About</span></label>
          <select id="aet" value={f.entity_type} onChange={(e) => update({ entity_type: e.target.value, entity_id: '' })}>
            <option value="">Anything</option>{(data?.entity_types || []).map((t) => <option key={t} value={t}>{t}</option>)}
          </select></div>
        {f.entity_type && <div className="field narrow-field"><label htmlFor="aei"><span className="label">{f.entity_type} id</span></label>
          <input id="aei" inputMode="numeric" value={text.entity_id} onChange={(e) => setText({ ...text, entity_id: e.target.value.trim() })} /></div>}
        <div className="field"><label htmlFor="af"><span className="label">From</span></label><input id="af" type="date" value={f.from} max={f.to || undefined} onChange={(e) => update({ from: e.target.value })} /></div>
        <div className="field"><label htmlFor="at"><span className="label">To</span></label><input id="at" type="date" value={f.to} min={f.from || undefined} onChange={(e) => update({ to: e.target.value })} /></div>
        <div className="field search"><label htmlFor="as"><span className="label">Search</span></label>
          <input id="as" type="search" placeholder="Details, IP address or request id" value={text.search} onChange={(e) => setText({ ...text, search: e.target.value })} /></div>
        {filtered && <button className="btn ghost sm" onClick={() => { setText({ person: '', search: '', entity_id: '' }); setParams({}, { replace: true }); }}><X size={15} aria-hidden />Clear filters</button>}
      </div>

      {error && <Alert>{error}</Alert>}
      <p className="small muted" aria-live="polite">{data ? `${data.meta.total} entr${data.meta.total === 1 ? 'y' : 'ies'}` : '\u00a0'}</p>
      <div className={`table-wrap ${data?.loading ? 'is-loading' : ''}`}><table>
        <thead><tr>
          <SortHeader label="When" sortKey="time" defaultDir="desc" sort={sort} dir={dir} onSort={(k, d) => update({ sort: k, dir: d })} />
          <th>Who</th>
          <SortHeader label="Action" sortKey="action" sort={sort} dir={dir} onSort={(k, d) => update({ sort: k, dir: d })} />
          <th>Details</th><th><span className="sr-only">Open</span></th>
        </tr></thead>
        {!data && !error && <TableSkeleton cols={5} rows={8} />}
        {data && <tbody>
          {data.logs.length === 0 && <tr><td colSpan={5} className="table-empty"><strong>No log entries match</strong><br /><span className="muted">{filtered ? 'Try removing a filter.' : 'Nothing has been recorded yet.'}</span></td></tr>}
          {data.logs.map((l) => (
            <tr key={l.log_id}>
              <td className="nowrap">{fmtDateTime(l.logged_at)}</td>
              <td>{l.full_name || <span className="muted">{l.actor_email ? 'Deleted account' : 'Not signed in'}</span>}{l.actor_email && <><br /><span className="muted small">{l.actor_email}</span></>}</td>
              <td><span className={`badge ${badgeFor(l.action)}`}>{l.action}</span>{l.entity_type && <><br /><span className="muted small">{l.entity_type} #{l.entity_id}</span></>}</td>
              <td>{l.details}{l.has_changes && <span className="badge" style={{ marginLeft: '0.4rem' }}>changes</span>}</td>
              <td><button className="btn ghost sm" onClick={() => setOpen(l)} aria-label={`Details of ${l.action} at ${fmtDateTime(l.logged_at)}`}>Details</button></td>
            </tr>))}
        </tbody>}
      </table></div>
      <TableFooter meta={data?.meta} noun="entries" sizes={[25, 50, 100]} onPage={(p) => update({ page: String(p) })} onLimit={(l) => update({ limit: String(l) })} />

      <Modal open={!!open} wide title={open ? `${open.action}` : ''} onClose={() => setOpen(null)}>
        {open && (
          <div className="stack">
            <dl className="kv">
              <div><dt>When</dt><dd>{fmtDateTime(open.logged_at)} <span className="muted small">({open.logged_at})</span></dd></div>
              <div><dt>Who</dt><dd>{open.full_name || 'Not signed in or deleted'}{open.actor_email ? ` · ${open.actor_email}` : ''}</dd></div>
              {open.entity_type && <div><dt>About</dt><dd>{open.entity_type} #{open.entity_id}</dd></div>}
              {open.details && <div><dt>Details</dt><dd>{open.details}</dd></div>}
              <div><dt>IP address</dt><dd>{open.ip || '-'}</dd></div>
              <div><dt>Browser</dt><dd className="small">{open.user_agent || '-'}</dd></div>
              <div><dt>Request id</dt><dd><code className="k">{open.request_id || '-'}</code></dd></div>
            </dl>
            <h3>What changed</h3>
            <Changes before={open.before} after={open.after} />
          </div>
        )}
      </Modal>
    </div>
  );
}
