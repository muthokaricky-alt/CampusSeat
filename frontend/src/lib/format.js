export const fmtDate = (d, opts = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) =>
  d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', opts) : '';
export const fmtTime = (t) => (t ? String(t).slice(0, 5) : '');
export const fmtDateTime = (dt) => (dt ? new Date(String(dt).replace(' ', 'T')).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
export const today = () => new Date().toLocaleDateString('en-CA');
