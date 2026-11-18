import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound, LogOut, ShieldCheck, ShieldOff } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Alert, Field, Spinner } from '../components/ui.jsx';

/** Shared form state: values, per-field errors from the API, a form-level error and a busy flag. */
function useForm(initial) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setValues((v) => ({ ...v, [k]: e.target.value }));
  const run = (fn) => async (e) => {
    e?.preventDefault(); setErrors({}); setFormError(''); setBusy(true);
    try { await fn(values); } catch (err) { err.field ? setErrors({ [err.field]: err.message }) : setFormError(err.message); } finally { setBusy(false); }
  };
  return { values, setValues, set, errors, formError, busy, run };
}

function BackupCodes({ codes, onDone }) {
  const copy = async () => { try { await navigator.clipboard.writeText(codes.join('\n')); } catch { /* clipboard blocked */ } };
  return (
    <div className="stack">
      <Alert type="warn">Save these backup codes somewhere safe (a password manager, or printed). Each works once if you lose your phone. They are shown only now.</Alert>
      <ol className="backup-codes">{codes.map((c) => <li key={c}><code>{c}</code></li>)}</ol>
      <div className="row"><button type="button" className="btn secondary" onClick={copy}>Copy codes</button><button type="button" className="btn" onClick={onDone}>I have saved them</button></div>
    </div>
  );
}

function TwoFactor() {
  const toast = useToast();
  const { refresh } = useAuth();
  const [st, setSt] = useState(null);
  const [setup, setSetup] = useState(null);
  const [codes, setCodes] = useState(null);
  const f = useForm({ password: '', code: '' });
  const load = () => api.get('/account/2fa').then(setSt).catch(() => setSt({ available: false }));
  useEffect(() => { load(); }, []);
  if (!st) return <Spinner />;
  if (!st.available && !st.enabled) return null;
  const reset = () => { f.setValues({ password: '', code: '' }); setSetup(null); };

  if (codes) return <BackupCodes codes={codes} onDone={() => { setCodes(null); load(); }} />;
  if (st.enabled) return (
    <div className="stack">
      <p><span className="badge ok"><ShieldCheck size={14} aria-hidden />On</span> Logging in needs a code from your authenticator app. Backup codes left: <strong>{st.backup_codes_left}</strong>.</p>
      {f.formError && <Alert>{f.formError}</Alert>}
      <form className="stack" noValidate>
        <Field label="Your password" error={f.errors.password}>{(p) => <input {...p} type="password" autoComplete="current-password" value={f.values.password} onChange={f.set('password')} />}</Field>
        <Field label="Code from the app (or a backup code)" error={f.errors.code}>{(p) => <input {...p} inputMode="numeric" autoComplete="one-time-code" value={f.values.code} onChange={f.set('code')} />}</Field>
        <div className="row">
          <button className="btn secondary" disabled={f.busy} onClick={f.run(async (v) => { const r = await api.post('/account/2fa/backup-codes', v); reset(); setCodes(r.backup_codes); })}>New backup codes</button>
          <button className="btn danger" disabled={f.busy} onClick={f.run(async (v) => { await api.post('/account/2fa/disable', v); reset(); toast.ok('Two-factor login is off.'); load(); refresh(); })}><ShieldOff size={16} aria-hidden />Turn off</button>
        </div>
      </form>
    </div>
  );
  if (setup) return (
    <form className="stack" noValidate onSubmit={f.run(async (v) => { const r = await api.post('/account/2fa/enable', { code: v.code }); reset(); setCodes(r.backup_codes); toast.ok('Two-factor login is on.'); refresh(); })}>
      <ol className="steps">
        <li>Open an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, ...).</li>
        <li>Scan this QR code, or type the key by hand.</li>
      </ol>
      <img className="qr" src={setup.qr_data_url} width="200" height="200" alt="QR code to add CampusSeat to your authenticator app" />
      <p className="small">Key: <code className="k">{setup.secret}</code></p>
      {f.formError && <Alert>{f.formError}</Alert>}
      <Field label="6-digit code from the app" error={f.errors.code}>{(p) => <input {...p} inputMode="numeric" autoComplete="one-time-code" value={f.values.code} onChange={f.set('code')} />}</Field>
      <div className="row"><button type="button" className="btn secondary" onClick={reset}>Cancel</button><button className="btn" disabled={f.busy}>Turn on</button></div>
    </form>
  );
  return (
    <form className="stack" noValidate onSubmit={f.run(async (v) => { setSetup(await api.post('/account/2fa/setup', { password: v.password })); f.setValues({ password: '', code: '' }); })}>
      <p className="muted">Protect your administrator account with a second step: after your password, a code from your phone.</p>
      {f.formError && <Alert>{f.formError}</Alert>}
      <Field label="Confirm your password" error={f.errors.password}>{(p) => <input {...p} type="password" autoComplete="current-password" value={f.values.password} onChange={f.set('password')} />}</Field>
      <div><button className="btn" disabled={f.busy}><ShieldCheck size={16} aria-hidden />Set up two-factor login</button></div>
    </form>
  );
}

export default function Security() {
  const { user, logoutEverywhere } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const pw = useForm({ current_password: '', new_password: '' });
  const change = pw.run(async (v) => {
    const r = await api.post('/auth/change-password', v);
    pw.setValues({ current_password: '', new_password: '' });
    toast.ok(r.other_sessions_ended ? `Password changed. ${r.other_sessions_ended} other device(s) were logged out.` : 'Password changed.');
  });
  const everywhere = async () => { await logoutEverywhere(); toast.ok('You are logged out on every device.'); nav('/'); };
  return (
    <div className="container page narrow">
      <div className="page-head"><h1>Account and security</h1><p>{user.full_name} · {user.email}</p></div>
      <section className="card stack">
        <h2><KeyRound size={20} aria-hidden style={{ verticalAlign: '-3px' }} /> Change password</h2>
        {pw.formError && <Alert>{pw.formError}</Alert>}
        <form className="stack" noValidate onSubmit={change}>
          <Field label="Current password" error={pw.errors.current_password}>{(p) => <input {...p} type="password" autoComplete="current-password" value={pw.values.current_password} onChange={pw.set('current_password')} />}</Field>
          <Field label="New password" error={pw.errors.new_password} hint="At least 8 characters, with a letter and a number. Other devices will be logged out.">{(p) => <input {...p} type="password" autoComplete="new-password" value={pw.values.new_password} onChange={pw.set('new_password')} />}</Field>
          <div><button className="btn" disabled={pw.busy}>{pw.busy ? 'Saving…' : 'Change password'}</button></div>
        </form>
      </section>
      {user.role === 'admin' && (
        <section className="card stack"><h2><ShieldCheck size={20} aria-hidden style={{ verticalAlign: '-3px' }} /> Two-factor login</h2><TwoFactor /></section>
      )}
      <section className="card stack">
        <h2><LogOut size={20} aria-hidden style={{ verticalAlign: '-3px' }} /> Sessions</h2>
        <p className="muted">Lost a phone, or used a shared computer? End every login to your account, including this one.</p>
        <div><button className="btn secondary" onClick={everywhere}>Log out on all devices</button></div>
      </section>
    </div>
  );
}
