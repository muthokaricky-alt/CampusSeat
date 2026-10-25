import { useEffect, useState } from 'react';
import { KeyRound, Trash2 } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { Alert, ConfirmDialog, Empty, Modal, Spinner, useDebounced } from '../../components/ui.jsx';
import { fmtDate } from '../../lib/format.js';

export default function AdminUsers() {
  const { user: me } = useAuth();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [users, setUsers] = useState(null);
  const [error, setError] = useState('');
  const [resetFor, setResetFor] = useState(null);
  const [tempPw, setTempPw] = useState('');
  const [deleting, setDeleting] = useState(null);
  const search = useDebounced(q);
  const load = () => api.get(`/admin/users${search ? `?search=${encodeURIComponent(search)}` : ''}`).then((r) => { setUsers(r.users); setError(''); }).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [search]);

  const role = async (u, value) => {
    try { await api.patch(`/admin/users/${u.user_id}`, { role: value }); toast.ok(`${u.full_name} is now ${value === 'admin' ? 'an administrator' : 'a regular user'}.`); load(); }
    catch (e) { toast.error(e.message); }
  };
  const reset = async () => {
    try { const r = await api.post(`/admin/users/${resetFor.user_id}/reset-password`); setTempPw(r.temporary_password); toast.ok('Password reset.'); }
    catch (e) { toast.error(e.message); setResetFor(null); }
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
          <thead><tr><th>Name</th><th>Student no.</th><th>School</th><th>Role</th><th>Bookings</th><th>Joined</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{users.map((u) => (
            <tr key={u.user_id}>
              <td>{u.full_name}<br /><span className="muted small">{u.email}</span></td><td>{u.student_number}</td><td>{u.school_name}</td>
              <td><select aria-label={`Role for ${u.full_name}`} value={u.role} disabled={u.user_id === me.user_id} onChange={(e) => role(u, e.target.value)} style={{ width: 'auto', minHeight: 34, padding: '0.25rem 0.5rem' }}>
                <option value="user">User</option><option value="admin">Admin</option></select></td>
              <td>{u.bookings}</td><td>{fmtDate(u.created_at, { day: 'numeric', month: 'short', year: 'numeric' })}</td>
              <td className="actions">
                <button className="btn secondary sm" onClick={() => { setTempPw(''); setResetFor(u); }}><KeyRound size={15} aria-hidden />Reset password</button>
                <button className="btn danger sm" disabled={u.user_id === me.user_id} onClick={() => setDeleting(u)} aria-label={`Delete ${u.full_name}`}><Trash2 size={15} aria-hidden />Delete</button>
              </td>
            </tr>))}</tbody>
        </table></div>
      )}
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
