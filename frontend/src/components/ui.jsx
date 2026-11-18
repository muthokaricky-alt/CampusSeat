import { useEffect, useRef, useState } from 'react';
import { X, Loader2 } from 'lucide-react';

export const Spinner = () => <div className="loading" role="status"><span className="spinner" /><span className="sr-only">Loading</span></div>;

/** Grey placeholder blocks with a soft shimmer (static under reduced motion). Keeps layout stable while loading. */
export const Skeleton = ({ w = '100%', h = '1rem', r, style }) => (
  <span className="skeleton" style={{ width: w, height: h, borderRadius: r, ...style }} aria-hidden="true" />
);

/** Placeholder with the same shape as an event card, so nothing jumps when the real cards arrive. */
export const EventCardSkeleton = () => (
  <div className="ticket skeleton-card" aria-hidden="true">
    <div className="stub"><Skeleton w="2.2rem" h="2.2rem" r="8px" /></div>
    <div className="body">
      <Skeleton w="70%" h="1.2rem" /><Skeleton w="55%" h="0.85rem" style={{ marginTop: '0.6rem' }} />
      <Skeleton w="40%" h="0.85rem" style={{ marginTop: '0.4rem' }} /><Skeleton h="0.5rem" style={{ marginTop: '1rem' }} />
    </div>
  </div>
);

/** Whole-page placeholder for lazily loaded pages. */
export const PageSkeleton = ({ bare }) => (
  <div className={bare ? '' : 'container page'} role="status" aria-busy="true">
    <span className="sr-only">Loading</span>
    <Skeleton w="40%" h="2.2rem" r="10px" />
    <Skeleton w="60%" h="1rem" style={{ marginTop: '0.9rem' }} />
    <Skeleton h="10rem" r="12px" style={{ marginTop: '1.5rem' }} />
  </div>
);

export const Empty = ({ title, children }) => (
  <div className="empty"><h3>{title}</h3>{children && <p>{children}</p>}</div>
);

export const Alert = ({ type = 'bad', children }) => (
  <div className={`alert ${type}`} role={type === 'bad' ? 'alert' : 'status'}>{children}</div>
);

/** Label + input + error text, wired together for screen readers. */
export function Field({ label, error, hint, children, id }) {
  const fid = id || `f-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const child = children({ id: fid, 'aria-invalid': error ? 'true' : undefined, 'aria-describedby': error ? `${fid}-err` : hint ? `${fid}-hint` : undefined });
  return (
    <div className="field">
      <label htmlFor={fid}><span className="label">{label}</span></label>
      {child}
      {hint && !error && <div className="hint" id={`${fid}-hint`}>{hint}</div>}
      {error && <div className="err" id={`${fid}-err`}>{error}</div>}
    </div>
  );
}

/** Accessible modal built on the native <dialog> element (focus trap, Esc to close). */
export function Modal({ open, title, onClose, children, footer, wide }) {
  const ref = useRef(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className={wide ? 'wide' : ''} onClose={onClose} aria-labelledby="dlg-title"
      onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      {open && (
        <>
          <div className="dlg-head">
            <h2 id="dlg-title">{title}</h2>
            <button className="btn ghost icon-btn" onClick={onClose} aria-label="Close"><X size={20} /></button>
          </div>
          <div className="dlg-body">{children}</div>
          {footer && <div className="dlg-foot">{footer}</div>}
        </>
      )}
    </dialog>
  );
}

export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', danger, onConfirm, onClose }) {
  const [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); try { await onConfirm(); } finally { setBusy(false); } };
  return (
    <Modal open={open} title={title} onClose={onClose}
      footer={<>
        <button className="btn secondary" onClick={onClose}>Cancel</button>
        <button className={`btn ${danger ? 'danger' : ''}`} onClick={go} disabled={busy}>
          {busy && <Loader2 size={16} className="spinner" style={{ border: 0 }} />}{confirmLabel}
        </button>
      </>}>
      <p>{message}</p>
    </Modal>
  );
}

export const Pager = ({ page, total, limit, onPage }) => {
  const pages = Math.max(1, Math.ceil(total / limit));
  return (
    <div className="pager small muted">
      <span>{total} {total === 1 ? 'entry' : 'entries'} · page {page} of {pages}</span>
      <span className="row">
        <button className="btn secondary sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
        <button className="btn secondary sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
      </span>
    </div>
  );
};

export const useDebounced = (value, ms = 300) => {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
};
