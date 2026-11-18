import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { KeyRound, LockOpen, Mail, Search, ShieldCheck, Trash2 } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { Alert, ConfirmDialog, Modal, useDebounced } from '../../components/ui.jsx';
import { SortHeader, TableFooter, TableSkeleton, listState } from '../../components/admin/DataTable.jsx';
import { fmtDate, fmtDateTime } from '../../lib/format.js';

export default function AdminUsers() {
  const { user: me } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const st = listState(params, { sort: 'created', dir: 'desc', limit: 50 });
  const [q, setQ] = useState(st.get('search'));
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [roleChange, setRoleChange] = useState(null); // { user, value }
  const [resetFor, setResetFor] = useState(null);
  const [tempPw, setTempPw] = useState('');
  const [deleting, setDeleting] = useState(null);
  const [managing, setManaging] = useState(null);
  const search = useDebounced(q);
  const update = (changes) => {
    const next = new URLSearchParams(params);
    Object.entries(changes).forEach(([k, v]) => (v ? next.set(k, String(v)) : next.delete(k)));
    if (!('page' in changes)) next.delete('page');
    setParams(next, { replace: true });
  };
  useEffect(() => { if (search !== st.get('search')) update({ search }); }, [search]); // eslint-disable-line react-hooks/exhaustive-deps
  const load = () => {
    const p = new URLSearchParams({ page: st.page, limit: st.limit, sort: st.sort, dir: st.dir });
    if (st.get('search')) p.set('search', st.get('search'));
    setData((d) => (d ? { ...d, loading: true } : d));
    return api.get(`/admin/users?${p}`).then((r) => { setData(r); setError(''); }).catch((e) => setError(e.message));
  };
  useEffect(() => { load(); }, [params]); // eslint-disable-line react-hooks/exhaustive-deps
  const users = data?.users;
  const sortProps = { sort: st.sort, dir: st.dir, onSort: (sort, dir) => update({ sort, dir }) };

  // Role changes are confirmed first: they grant or remove admin access and log the person out.
  const role = async () => {
    const { user: u, value } = roleChange;
    try { await api.patch(`/admin/users/${u.user_id}`, { role: value }); toast.ok(`${u.full_name} is now ${value === 'admin' ? 'an administrator' : 'a regular user'}.`); setRoleChange(null); load(); }
    catch (e) { toast.error(e.message); setRoleChange(null); }
  };
  const reset = async () => {
    try { const r = await api.post(`/admin/users/${resetFor.user_id}/reset-password`); setTempPw(r.temporary_password); toast.ok('Password reset.'); }
    catch (e) { toast.error(e.message); setResetFor(null); }
  };
  const sendLink = async (u) => {
    try { await api.post(`/admin/users/${u.user_id}/send-reset-email`); toast.ok(`Reset link sent to ${u.email}.`); }
    catch (e) { toast.error(e.message); }
  };
  const unlock = async (u) => {
    try { await api.post(`/admin/users/${u.user_id}/unlock`); toast.ok(`${u.full_name} can log in again.`); load(); }
    catch (e) { toast.error(e.message); }
  };
  const remove = async () => {
    try { await api.del(`/admin/users/${deleting.user_id}`); toast.ok('User deleted.'); setDeleting(null); load(); }
    catch (e) { toast.error(e.message); setDeleting(null); }
  };
  return (
    <div>
      <div className="page-head admin-head"><div><h1>Users</h1><p>Accounts, roles and sign-in help. Locked accounts show an Unlock button.</p></div></div>
      <div className="toolbar"><div className="field search"><label htmlFor="uq"><span className="label">Search users</span></label>
        <div className="search-box"><Search size={18} aria-hidden /><input id="uq" type="search" placeholder="Name, email or student number" value={q} onChange={(e) => setQ(e.target.value)} /></div></div></div>
      {error && <Alert>{error} <button className="linklike" onClick={load}>Try again</button></Alert>}
      <div className={`table-wrap ${data?.loading ? 'is-loading' : ''}`}><table>
          <thead><tr>
            <SortHeader label="Person" sortKey="name" {...sortProps} />
            <th>School</th>
            <SortHeader label="Role" sortKey="role" {...sortProps} />
            <SortHeader label="Bookings" sortKey="bookings" defaultDir="desc" {...sortProps} />
            <SortHeader label="Joined" sortKey="created" defaultDir="desc" {...sortProps} />
            <th><span className="sr-only">Actions</span></th>
          </tr></thead>
          {!users && !error && <TableSkeleton cols={6} />}
          {users && <tbody>
          {users.length === 0 && <tr><td colSpan={6} className="table-empty"><strong>No users found</strong><br /><span className="muted">Check the spelling, or search by student number.</span></td></tr>}
          {users.map((u) => (
            <tr key={u.user_id}>
              <td><strong>{u.full_name}</strong>{u.two_factor && <span className="badge info" style={{ marginLeft: '0.4rem' }} title="Two-factor login is on"><ShieldCheck size={12} aria-hidden />2FA</span>}<br /><span className="muted small">{u.email} · {u.student_number}</span>
                {u.locked_until && <><br /><span className="badge warn" title={`Locked until ${fmtDateTime(u.locked_until)}`}>Locked after failed logins</span></>}</td><td className="small">{u.school_name}</td>
              <td><select aria-label={`Role for ${u.full_name}`} value={u.role} disabled={u.user_id === me.user_id} onChange={(e) => setRoleChange({ user: u, value: e.target.value })} className="select-sm">
                <option value="user">User</option><option value="admin">Admin</option></select></td>
              <td className="num">{u.bookings}</td><td className="small nowrap">{fmtDate(u.created_at, { day: 'numeric', month: 'short', year: 'numeric' })}</td>
              <td className="actions">
                {/* One Manage button instead of four per row (fewer choices on screen); Unlock stays visible when needed. */}
                {u.locked_until && <button className="btn secondary sm" onClick={() => unlock(u)}><LockOpen size={15} aria-hidden />Unlock</button>}
<button className="btn secondary sm" onClick={() => setManaging(u)} aria-label={`Manage ${u.full_name}`}>Manage</button>
              </td>
            </tr>))}</tbody>}
        </table></div>
      <TableFooter meta={data?.meta} noun="users" onPage={(page) => update({ page })} onLimit={(limit) => update({ limit })} />
      <ConfirmDialog open={!!roleChange} danger={roleChange?.value === 'user'} title={roleChange?.value === 'admin' ? 'Make this person an administrator?' : 'Remove administrator access?'}
        confirmLabel={roleChange?.value === 'admin' ? 'Make administrator' : 'Remove access'} onClose={() => setRoleChange(null)} onConfirm={role}
        message={roleChange ? (roleChange.value === 'admin'
          ? `${roleChange.user.full_name} will be able to manage events, users and reports. They are logged out and sign in again with their new access.`
          : `${roleChange.user.full_name} will lose access to the admin panel and is logged out.`) : ''} />
      <Modal open={!!managing} title={managing ? `Manage ${managing.full_name}` : ''} onClose={() => setManaging(null)}>
        {managing && (
          <div className="action-list">
            <p className="muted small">{managing.email} · {managing.student_number} · {managing.school_name}</p>
            <button className="btn secondary block" onClick={() => { const u = managing; setManaging(null); sendLink(u); }}><Mail size={16} aria-hidden />Email a password reset link</button>
            <button className="btn secondary block" onClick={() => { const u = managing; setManaging(null); setTempPw(''); setResetFor(u); }}><KeyRound size={16} aria-hidden />Set a temporary password</button>
            <button className="btn danger block" disabled={managing.user_id === me.user_id} onClick={() => { const u = managing; setManaging(null); setDeleting(u); }}><Trash2 size={16} aria-hidden />Delete this user</button>
            {managing.user_id === me.user_id && <p className="small muted">You cannot delete your own account.</p>}
          </div>
        )}
      </Modal>
      <Modal open={!!resetFor} title="Reset password" onClose={() => { setResetFor(null); setTempPw(''); }}
        footer={tempPw ? <button className="btn" onClick={() => { setResetFor(null); setTempPw(''); }}>Done</button>
          : <><button className="btn secondary" onClick={() => setResetFor(null)}>Cancel</button><button className="btn" onClick={reset}>Reset password</button></>}>
        {tempPw ? (<><p>Give this temporary password to {resetFor?.full_name}. It is shown only once.</p><p><code className="k" style={{ fontSize: '1.2rem' }}>{tempPw}</code></p><p className="muted small">They can change it after logging in.</p></>)
          : <p>Create a new temporary password for {resetFor?.full_name}? Their current password will stop working.</p>}
      </Modal>
      <ConfirmDialog open={!!deleting} danger title="Delete this user?" confirmLabel="Delete user" onClose={() => setDeleting(null)} onConfirm={remove}
        message={deleting ? `${deleting.full_name} (${deleting.email}) will be removed. Users with bookings cannot be deleted.` : ''} />
    </div>
  );
}
