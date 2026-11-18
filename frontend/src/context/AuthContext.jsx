// Authentication state for the whole app. The session itself is an httpOnly cookie set by the
// server; this context only keeps who is logged in and the CSRF token for unsafe requests.
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, setCsrfToken, setUnauthorizedHandler } from '../lib/api.js';
import { clearOfflineData } from '../pwa.js';

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  // We cannot read the cookie, so always ask the server once on load.
  const [loading, setLoading] = useState(true);

  const clear = useCallback(() => { setCsrfToken(null); setUser(null); clearOfflineData(); }, []);
  useEffect(() => { setUnauthorizedHandler(clear); }, [clear]);

  useEffect(() => {
    api.get('/auth/session')
      .then((r) => { setCsrfToken(r.csrf_token); setUser(r.user); })
      .catch(clear)
      .finally(() => setLoading(false));
  }, [clear]);

  const accept = (r) => { setCsrfToken(r.csrf_token); setUser(r.user); return r.user; };
  const value = {
    user, loading, isAdmin: user?.role === 'admin',
    // Returns the user, or { mfa_required, challenge } when the account has two-factor login on.
    login: async (email, password) => {
      const r = await api.post('/auth/login', { email, password });
      return r.mfa_required ? r : accept(r);
    },
    verify2fa: async (challenge, code) => accept(await api.post('/auth/2fa', { challenge, code })),
    refresh: async () => { const r = await api.get('/auth/session'); setCsrfToken(r.csrf_token); setUser(r.user); },
    register: async (data) => accept(await api.post('/auth/register', data)),
    logout: async () => { try { await api.post('/auth/logout'); } catch { /* already signed out */ } clear(); },
    logoutEverywhere: async () => { try { await api.post('/auth/logout-all'); } catch { /* already signed out */ } clear(); },
  };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
