import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, CheckCircle2, AlertTriangle, XCircle, Undo2, ScanLine } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Alert } from '../../components/ui.jsx';
import { fmtDateTime } from '../../lib/format.js';

/**
 * Door check-in. Works three ways, all ending in the same request:
 *  - a USB/Bluetooth barcode scanner (it "types" the reference and presses Enter),
 *  - typing the reference (any case, spaces or dashes),
 *  - the device camera: the browser's BarcodeDetector where available, otherwise jsQR (loaded only then).
 * Big, colour + icon + text results (never colour alone), announced to screen readers, with a vibration
 * on phones. A mistaken check-in can be undone from the recent list.
 */
const TONES = {
  ok: { icon: CheckCircle2, title: 'Checked in' },
  warn: { icon: AlertTriangle, title: 'Already checked in' },
  bad: { icon: XCircle, title: 'Not valid here' },
};

function useScanner(onCode) {
  const video = useRef(null);
  const stream = useRef(null);
  const timer = useRef(0);
  const last = useRef({ code: '', at: 0 });
  const [on, setOn] = useState(false);
  const [err, setErr] = useState('');

  const stop = useCallback(() => {
    clearInterval(timer.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setOn(false);
  }, []);

  const start = async () => {
    setErr('');
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    } catch {
      setErr('The camera could not be opened. Allow camera access in the browser, or type the reference instead.');
      return;
    }
    setOn(true);
    const v = video.current;
    v.srcObject = stream.current;
    await v.play().catch(() => {});
    let detect;
    if ('BarcodeDetector' in window) {
      const d = new window.BarcodeDetector({ formats: ['qr_code'] });
      detect = async () => (await d.detect(v))[0]?.rawValue;
    } else {
      const jsQR = (await import('jsqr')).default; // only downloaded on browsers without BarcodeDetector (e.g. iPhone Safari)
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      detect = async () => {
        if (!v.videoWidth) return null;
        canvas.width = v.videoWidth; canvas.height = v.videoHeight;
        ctx.drawImage(v, 0, 0);
        return jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height)?.data;
      };
    }
    timer.current = setInterval(async () => {
      const code = await detect().catch(() => null);
      // The same ticket stays in view for a while: ignore repeats for 3 seconds.
      if (code && !(code === last.current.code && Date.now() - last.current.at < 3000)) {
        last.current = { code, at: Date.now() };
        onCode(code);
      }
    }, 250);
  };

  useEffect(() => stop, [stop]);
  return { video, on, err, start, stop };
}

export default function CheckIn() {
  const toast = useToast();
  const [events, setEvents] = useState(null);
  const [eventId, setEventId] = useState('');
  const [ref, setRef] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // { tone, person, message }
  const [recent, setRecent] = useState([]);
  const [counts, setCounts] = useState(null);
  const input = useRef(null);

  const loadEvents = () => api.get('/admin/check-in/events').then((r) => {
    setEvents(r.events);
    if (r.events.length === 1) setEventId(String(r.events[0].event_id));
  }).catch(() => setEvents([]));
  useEffect(() => { loadEvents(); }, []);
  useEffect(() => {
    const e = events?.find((x) => String(x.event_id) === eventId);
    setCounts(e ? { checked_in: e.checked_in, booked: e.booked } : null);
  }, [eventId, events]);

  const submit = useCallback(async (raw) => {
    const value = String(raw ?? '').trim();
    if (!value) return;
    setBusy(true);
    try {
      const r = await api.post('/admin/check-in', { ref: value, ...(eventId ? { event_id: Number(eventId) } : {}) });
      setResult({ tone: 'ok', person: r.check_in, message: `${r.check_in.full_name} is in.` });
      setCounts(r.counts);
      setRecent((l) => [{ ...r.check_in, ok: true }, ...l].slice(0, 12));
      navigator.vibrate?.(60);
    } catch (e) {
      const person = e.data?.person;
      const tone = e.code === 'ALREADY_CHECKED_IN' ? 'warn' : 'bad';
      setResult({ tone, person, message: e.code === 'ALREADY_CHECKED_IN' && person?.checked_in_at
        ? `${person.full_name} was already checked in at ${fmtDateTime(person.checked_in_at)}${person.checked_in_by ? ` by ${person.checked_in_by}` : ''}.`
        : e.message });
      if (e.data?.counts) setCounts(e.data.counts);
      navigator.vibrate?.([80, 60, 80]);
    } finally {
      setBusy(false); setRef('');
      input.current?.focus();
    }
  }, [eventId]);

  const scanner = useScanner(submit);
  const undo = async (p) => {
    try {
      const r = await api.del(`/admin/check-in/${p.booking_id}`);
      setCounts(r.counts);
      setRecent((l) => l.map((x) => (x.booking_id === p.booking_id ? { ...x, undone: true } : x)));
      toast.ok(`Check-in undone for ${p.full_name}.`);
    } catch (e) { toast.error(e.message); }
  };

  const T = result ? TONES[result.tone] : null;
  return (
    <div className="checkin">
      <div className="page-head admin-head">
        <div><h1>Check-in</h1><p>Scan each registration card at the door, or type its reference. Opens 3 hours before an event starts.</p></div>
        {counts && <div className="checkin-count" aria-live="polite"><strong>{counts.checked_in}</strong><span>of {counts.booked} in</span></div>}
      </div>

      {events && events.length === 0 && <Alert type="warn">No event is open for check-in right now. Check-in opens 3 hours before an event starts and closes 3 hours after it ends.</Alert>}
      {events?.length > 0 && (
        <div className="field" style={{ maxWidth: 520 }}>
          <label htmlFor="ci-ev"><span className="label">Event at this door</span></label>
          <select id="ci-ev" value={eventId} onChange={(e) => { setEventId(e.target.value); input.current?.focus(); }}>
            <option value="">Any event open now</option>
            {events.map((e) => <option key={e.event_id} value={e.event_id}>{e.title} ({String(e.start_time).slice(0, 5)}, {e.venue})</option>)}
          </select>
        </div>
      )}

      <div className="checkin-grid">
        <section className="card stack">
          <form onSubmit={(e) => { e.preventDefault(); submit(ref); }} className="checkin-form">
            <label htmlFor="ci-ref" className="label">Booking reference</label>
            <div className="row">
              <input id="ci-ref" ref={input} autoFocus autoComplete="off" autoCapitalize="characters" spellCheck="false" inputMode="text"
                placeholder="CS-2026-00081" value={ref} onChange={(e) => setRef(e.target.value)} className="checkin-input" />
              <button className="btn lg" disabled={busy || !ref.trim()}><ScanLine size={18} aria-hidden />Check in</button>
            </div>
            <p className="small muted">A barcode scanner works here too: it types the reference and presses Enter.</p>
          </form>
          <div>
            {!scanner.on
              ? <button type="button" className="btn secondary" onClick={scanner.start}><Camera size={18} aria-hidden />Scan with camera</button>
              : <button type="button" className="btn secondary" onClick={scanner.stop}><CameraOff size={18} aria-hidden />Stop camera</button>}
          </div>
          {scanner.err && <Alert>{scanner.err}</Alert>}
          <div className={`scanner ${scanner.on ? 'on' : ''}`}>
            <video ref={scanner.video} playsInline muted aria-label="Camera view for scanning QR codes" />
            {scanner.on && <span className="scan-frame" aria-hidden />}
          </div>
        </section>

        <section className={`card checkin-result ${result ? result.tone : 'idle'}`} aria-live="assertive" aria-atomic="true">
          {!result && <p className="muted">Results appear here: green means come in, amber means the ticket was already used, red means stop and check.</p>}
          {result && (
            <>
              <div className="result-head"><T.icon size={36} aria-hidden /><strong>{T.title}</strong></div>
              <p className="result-msg">{result.message}</p>
              {result.person && (
                <dl className="kv">
                  <div><dt>Name</dt><dd>{result.person.full_name}</dd></div>
                  <div><dt>Student no.</dt><dd>{result.person.student_number}</dd></div>
                  <div><dt>School</dt><dd>{result.person.school_name}</dd></div>
                  <div><dt>Event</dt><dd>{result.person.event_title}</dd></div>
                  <div><dt>Reference</dt><dd><code className="k">{result.person.booking_ref}</code></dd></div>
                </dl>
              )}
            </>
          )}
        </section>
      </div>

      {recent.length > 0 && (
        <section className="card" style={{ marginTop: '1.25rem' }} aria-labelledby="ci-recent">
          <h2 id="ci-recent" style={{ fontSize: '1.1rem' }}>Checked in at this screen</h2>
          <ul className="activity">
            {recent.map((p) => (
              <li key={`${p.booking_id}-${p.checked_in_at}`} className={p.undone ? 'undone' : ''}>
                <span className="avatar" aria-hidden>{p.full_name.split(' ').map((w) => w[0]).slice(0, 2).join('')}</span>
                <span className="grow"><strong>{p.full_name}</strong> <span className="muted small">{p.booking_ref} · {p.event_title}</span></span>
                <span className="muted small nowrap">{p.undone ? 'Undone' : fmtDateTime(p.checked_in_at)}</span>
                {!p.undone && <button className="btn ghost sm" onClick={() => undo(p)} aria-label={`Undo check-in for ${p.full_name}`}><Undo2 size={15} aria-hidden />Undo</button>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
