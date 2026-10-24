import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { Alert, Empty, Pager, Spinner, useDebounced } from '../../components/ui.jsx';
import { fmtDateTime } from '../../lib/format.js';

export default function AuditLogs() {
  const [f, setF] = useState({ search: '', action: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const search = useDebounced(f.search);
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setPage(1); };
  useEffect(() => {
    const p = new URLSearchParams({ page, limit: 25 });
    if (search) p.set('search', search); ['action', 'from', 'to'].forEach((k) => f[k] && p.set(k, f[k]));
    api.get(`/admin/audit-logs?${p}`).then((r) => { setData(r); setError(''); }).catch((e) => setError(e.message));
  }, [search, f.action, f.from, f.to, page]);
  return (
    <div>
      <div className="page-head"><h1>Audit logs</h1><p>A record of what happened on the system and who did it.</p></div>
      <div className="toolbar">
        <div className="field search"><label htmlFor="as"><span className="label">Search</span></label><input id="as" type="search" placeholder="Person or details" value={f.search} onChange={set('search')} /></div>
        <div className="field"><label htmlFor="aa"><span className="label">Action</span></label>
          <select id="aa" value={f.action} onChange={set('action')}><option value="">All actions</option>{data?.actions.map((a) => <option key={a}>{a}</option>)}</select></div>
        <div className="field"><label htmlFor="af"><span className="label">From</span></label><input id="af" type="date" value={f.from} onChange={set('from')} /></div>
        <div className="field"><label htmlFor="at"><span className="label">To</span></label><input id="at" type="date" value={f.to} min={f.from || undefined} onChange={set('to')} /></div>
      </div>
      {error && <Alert>{error}</Alert>}
      {!data && !error && <Spinner />}
      {data?.logs.length === 0 && <Empty title="No log entries match" />}
      {data?.logs.length > 0 && (
        <>
          <div className="table-wrap"><table>
            <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Details</th></tr></thead>
            <tbody>{data.logs.map((l) => (
              <tr key={l.log_id}><td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(l.logged_at)}</td><td>{l.full_name || <span className="muted">Unknown or removed user</span>}</td>
                <td><span className={`badge ${/FAILED/.test(l.action) ? 'bad' : /DELETE|CANCEL/.test(l.action) ? 'warn' : 'info'}`}>{l.action}</span></td><td>{l.details}</td></tr>))}</tbody>
          </table></div>
          <Pager page={data.page} total={data.total} limit={data.limit} onPage={setPage} />
        </>
      )}
    </div>
  );
}
