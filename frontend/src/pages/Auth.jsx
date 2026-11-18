import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Alert, Field } from '../components/ui.jsx';

/** Shared submit handling: runs the action, shows API messages next to the right field. */
function useSubmit(action) {
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setErrors({}); setFormError(''); setBusy(true);
    try { await action(); }
    catch (err) { err.field ? setErrors({ [err.field]: err.message }) : setFormError(err.message); }
    finally { setBusy(false); }
  };
  return { errors, formError, busy, submit };
}

export function Login() {
  const { user, login, verify2fa } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState(null);
  const [code, setCode] = useState('');
  const done = (u) => {
    toast.ok(`Welcome back, ${u.full_name.split(' ')[0]}.`);
    nav(loc.state?.from || (u.role === 'admin' ? '/admin' : '/'), { replace: true });
  };
  const { errors, formError, busy, submit } = useSubmit(async () => {
    if (challenge) {
      try { done(await verify2fa(challenge, code)); }
      catch (err) { if (err.code === 'CHALLENGE_EXPIRED' || err.code === 'ACCOUNT_LOCKED') { setChallenge(null); setCode(''); } throw err; }
      return;
    }
    const r = await login(email, password);
    if (r.mfa_required) { setChallenge(r.challenge); setPassword(''); return; }
    done(r);
  });
  if (challenge && !user) return (
    <div className="auth-wrap card">
      <h1 style={{ fontSize: '1.8rem' }}>Two-factor check</h1>
      <p className="muted">Open your authenticator app and enter the 6-digit code for CampusSeat. Lost your phone? Enter one of your backup codes instead.</p>
      {formError && <Alert>{formError}</Alert>}
      <form onSubmit={submit} noValidate style={{ marginTop: '1rem' }}>
        <Field label="Code" error={errors.code}>{(p) => <input {...p} inputMode="numeric" autoComplete="one-time-code" autoFocus value={code} onChange={(e) => setCode(e.target.value)} placeholder="123 456" />}</Field>
        <button className="btn block" disabled={busy || !code.trim()}>{busy ? 'Checking…' : 'Verify and log in'}</button>
      </form>
      <p className="small" style={{ marginTop: '1rem' }}><button type="button" className="linklike" onClick={() => { setChallenge(null); setCode(''); }}>Use a different account</button></p>
    </div>
  );
  // Already signed in (or just signed in): go back to where the person was heading.
  if (user) return <Navigate to={loc.state?.from || (user.role === 'admin' ? '/admin' : '/')} replace />;
  return (
    <div className="auth-wrap card">
      <h1 style={{ fontSize: '1.8rem' }}>Log in</h1>
      <p className="muted">Use your university email to book seats.</p>
      {formError && <Alert>{formError}</Alert>}
      <form onSubmit={submit} noValidate style={{ marginTop: '1rem' }}>
        <Field label="Email" error={errors.email}>{(p) => <input {...p} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@university.ac.ke" required />}</Field>
        <Field label="Password" error={errors.password}>{(p) => <input {...p} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />}</Field>
        <button className="btn block" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
      </form>
      <p className="small" style={{ marginTop: '1rem' }}><Link to="/forgot-password">Forgot your password?</Link> · <Link to="/register">Create an account</Link></p>
    </div>
  );
}

export function Register() {
  const { user, register } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [schools, setSchools] = useState([]);
  const [f, setF] = useState({ full_name: '', student_number: '', email: '', school_id: '', password: '' });
  useEffect(() => { api.get('/schools').then((r) => setSchools(r.schools)).catch(() => {}); }, []);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const { errors, formError, busy, submit } = useSubmit(async () => {
    await register({ ...f, school_id: Number(f.school_id) || null });
    toast.ok('Account created. You are logged in.');
    nav('/', { replace: true });
  });
  if (user) return <Navigate to="/" replace />;
  return (
    <div className="auth-wrap card">
      <h1 style={{ fontSize: '1.8rem' }}>Create your account</h1>
      {formError && <Alert>{formError}</Alert>}
      <form onSubmit={submit} noValidate style={{ marginTop: '1rem' }}>
        <Field label="Full name" error={errors.full_name}>{(p) => <input {...p} autoComplete="name" value={f.full_name} onChange={set('full_name')} />}</Field>
        <Field label="Student or staff number" error={errors.student_number}>{(p) => <input {...p} value={f.student_number} onChange={set('student_number')} />}</Field>
        <Field label="Email" error={errors.email}>{(p) => <input {...p} type="email" autoComplete="email" value={f.email} onChange={set('email')} />}</Field>
        <Field label="School" error={errors.school_id}>{(p) => (
          <select {...p} value={f.school_id} onChange={set('school_id')}>
            <option value="">Select your school</option>
            {schools.map((s) => <option key={s.school_id} value={s.school_id}>{s.school_name}</option>)}
          </select>)}</Field>
        <Field label="Password" error={errors.password} hint="At least 8 characters, with a letter and a number.">{(p) => <input {...p} type="password" autoComplete="new-password" value={f.password} onChange={set('password')} />}</Field>
        <button className="btn block" disabled={busy}>{busy ? 'Creating account…' : 'Create account'}</button>
      </form>
      <p className="small" style={{ marginTop: '1rem' }}>Already registered? <Link to="/login">Log in</Link></p>
    </div>
  );
}

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState('');
  const { errors, formError, busy, submit } = useSubmit(async () => {
    const r = await api.post('/auth/forgot-password', { email });
    setSent(r.message);
  });
  return (
    <div className="auth-wrap card">
      <h1 style={{ fontSize: '1.8rem' }}>Reset your password</h1>
      {sent ? (
        <>
          <Alert type="ok">{sent}</Alert>
          <p className="muted" style={{ marginTop: '1rem' }}>The link works once and expires after a short time. No email? Check the address and try again in a minute.</p>
          <button className="btn secondary block" style={{ marginTop: '1rem' }} onClick={() => setSent('')}>Use a different email</button>
        </>
      ) : (
        <>
          <p className="muted">Enter the email on your account and we will send you a link to choose a new password.</p>
          {formError && <Alert>{formError}</Alert>}
          <form onSubmit={submit} noValidate style={{ marginTop: '1rem' }}>
            <Field label="Email" error={errors.email}>{(p) => <input {...p} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@university.ac.ke" />}</Field>
            <button className="btn block" disabled={busy}>{busy ? 'Sending…' : 'Send reset link'}</button>
          </form>
        </>
      )}
      <p className="small" style={{ marginTop: '1rem' }}><Link to="/login">Back to log in</Link></p>
    </div>
  );
}

/** Opened from the emailed link. The token is in the URL fragment (#token=...), which is never sent to the server. */
export function ResetPassword() {
  const nav = useNavigate();
  const toast = useToast();
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('token') || '');
  const [valid, setValid] = useState(null);
  const [pw, setPw] = useState('');
  useEffect(() => {
    // Remove the token from the address bar and history straight away.
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);
    if (!token) { setValid(false); return; }
    api.post('/auth/reset-password/verify', { token }).then((r) => setValid(r.valid)).catch(() => setValid(false));
  }, [token]);
  const { errors, formError, busy, submit } = useSubmit(async () => {
    await api.post('/auth/reset-password', { token, new_password: pw });
    toast.ok('Password changed. Log in with your new password.');
    nav('/login', { replace: true });
  });
  return (
    <div className="auth-wrap card">
      <h1 style={{ fontSize: '1.8rem' }}>Choose a new password</h1>
      {valid === null && <p className="muted">Checking your link…</p>}
      {valid === false && (
        <>
          <Alert>This reset link is invalid, has already been used or has expired.</Alert>
          <Link className="btn block" style={{ marginTop: '1rem' }} to="/forgot-password">Send a new link</Link>
        </>
      )}
      {valid && (
        <>
          <p className="muted">After saving, you will be logged out on every device and can log in with the new password.</p>
          {formError && <Alert>{formError}</Alert>}
          <form onSubmit={submit} noValidate style={{ marginTop: '1rem' }}>
            <Field label="New password" error={errors.new_password} hint="At least 8 characters, with a letter and a number.">{(p) => <input {...p} type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />}</Field>
            <button className="btn block" disabled={busy}>{busy ? 'Saving…' : 'Save new password'}</button>
          </form>
        </>
      )}
    </div>
  );
}
