// API client. The login session lives in an httpOnly cookie that page scripts cannot read,
// so nothing secret is stored in localStorage. Unsafe requests carry the CSRF token the server
// gave us at login (or from /auth/session), which proves the request comes from this site.
let csrfToken = null;
export const setCsrfToken = (t) => { csrfToken = t || null; };

// Clean up the token older versions of the app kept in localStorage.
try { localStorage.removeItem('campusseat_token'); } catch { /* storage unavailable */ }

export class ApiError extends Error {
  // `data` is the whole error body (e.g. the person behind an already-used ticket).
  constructor(status, code, message, field, data = {}) { super(message); this.status = status; this.code = code; this.field = field; this.data = data; }
}
let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

async function send(method, path, body) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (UNSAFE.has(method) && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  try {
    return await fetch(`/api${path}`, { method, headers, credentials: 'same-origin', body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection and try again.');
  }
}

async function request(method, path, body, { raw = false, retried = false } = {}) {
  const res = await send(method, path, body);
  if (!res.ok) {
    let e = {};
    try { e = (await res.json()).error || {}; } catch { /* not json */ }
    // The CSRF token can go stale (e.g. logged in again in another tab): refresh it once and retry.
    if (res.status === 403 && e.code === 'CSRF_FAILED' && !retried) {
      const s = await fetch('/api/auth/session', { credentials: 'same-origin' }).then((r) => r.json()).catch(() => ({}));
      if (s.csrf_token) { setCsrfToken(s.csrf_token); return request(method, path, body, { raw, retried: true }); }
    }
    if (res.status === 401 && e.code === 'SESSION_EXPIRED') onUnauthorized();
    throw new ApiError(res.status, e.code || 'ERROR', e.message || 'Something went wrong. Please try again.', e.field, e);
  }
  return raw ? res : res.json();
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, b = {}) => request('POST', p, b),
  put: (p, b) => request('PUT', p, b),
  patch: (p, b) => request('PATCH', p, b),
  del: (p) => request('DELETE', p),
  /** Download (or open) an authenticated file such as a PDF. The session cookie is sent automatically. */
  async file(path, { filename, open = false } = {}) {
    const res = await request('GET', path, undefined, { raw: true });
    const url = URL.createObjectURL(await res.blob());
    if (open) window.open(url, '_blank', 'noopener');
    else { const a = document.createElement('a'); a.href = url; a.download = filename || 'download'; document.body.appendChild(a); a.click(); a.remove(); }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  },
};
