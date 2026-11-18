import { useEffect, useState } from 'react';
import { KeyRound, LockOpen, Mail, Trash2 } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { Alert, ConfirmDialog, Empty, Modal, Pager, Spinner, useDebounced } from '../../components/ui.jsx';
import { fmtDate, fmtDateTime } from '../../lib/format.js';

export default function AdminUsers() {
  const { user: me } = useAuth();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [users, setUsers] = useState(null);
  const [meta, setMeta] = useState(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [resetFor, setResetFor] = useState(null);
  const [tempPw, setTempPw] = useState('');
  const [deleting, setDeleting] = useState(null);
  const [managing, setManaging] = useState(null);
  const search = useDebounced(q);
  const load = () => {
    const p = new URLSearchParams({ page, limit: 50 }); if (search) p.set('search', search);
    return api.get(`/admin/users?${p}`).then((r) => { setUsers(r.users); setMeta(r.meta); setError(''); }).catch((e) => setError(e.message));
  };
  useEffect(() => { setPage(1); }, [search]);
  useEffect(() => { load(); }, [search, page]);

  const role = async (u, value) => {
    try { await api.patch(`/admin/users/${u.user_id}`, { role: value }); toast.ok(`${u.full_name} is now ${value === 'admin' ? 'an administrator' : 'a regular user'}.`); load(); }
    catch (e) { toast.error(e.message); }
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
      <div className="page-head"><h1>Users</h1><p>Manage accounts, roles and passwords.</p></div>
      <div className="toolbar"><div className="field search"><label htmlFor="uq"><span className="label">Search users</span></label>
        <input id="uq" type="search" placeholder="Name, email or student number" value={q} onChange={(e) => setQ(e.target.value)} /></div></div>
      {error && <Alert>{error}</Alert>}
      {!users && !error && <Spinner />}
      {users?.length === 0 && <Empty title="No users found" />}
      {users?.length > 0 && (
        <div className="table-wrap"><table>
          <thead><tr><th>Person</th><th>School</th><th>Role</th><th>Bookings</th><th>Joined</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{users.map((u) => (
            <tr key={u.user_id}>
              <td><strong>{u.full_name}</strong>{u.two_factor && <span className="badge info" style={{ marginLeft: '0.4rem' }}>2FA</span>}<br /><span className="muted small">{u.email} · {u.student_number}</span>
                {u.locked_until && <><br /><span className="badge warn" title={`Locked until ${fmtDateTime(u.locked_until)}`}>Locked after failed logins</span></>}</td><td className="small">{u.school_name}</td>
              <td><select aria-label={`Role for ${u.full_name}`} value={u.role} disabled={u.user_id === me.user_id} onChange={(e) => role(u, e.target.value)} style={{ width: 'auto', minHeight: 34, padding: '0.25rem 0.5rem' }}>
                <option value="user">User</option><option value="admin">Admin</option></select></td>
              <td>{u.bookings}</td><td>{fmtDate(u.created_at, { day: 'numeric', month: 'short', year: 'numeric' })}</td>
              <td className="actions">
                {/* One Manage button instead of four per row (fewer choices on screen); Unlock stays visible when needed. */}
                {u.locked_until && <button className="btn secondary sm" onClick={() => unlock(u)}><LockOpen size={15} aria-hidden />Unlock</button>}
<button className="btn secondary sm" onClick={() => setManaging(u)} aria-label={`Manage ${u.full_name}`}>Manage</button>
              </td>
            </tr>))}</tbody>
        </table></div>
      )}
      {meta && meta.total > meta.limit && <Pager page={meta.page} total={meta.total} limit={meta.limit} onPage={setPage} />}
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
