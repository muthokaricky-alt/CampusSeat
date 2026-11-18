// Authentication state for the whole app. The session itself is an httpOnly cookie set by the
// server; this context only keeps who is logged in and the CSRF token for unsafe requests.
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, setCsrfToken, setUnauthorizedHandler } from '../lib/api.js';

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  // We cannot read the cookie, so always ask the server once on load.
  const [loading, setLoading] = useState(true);

  const clear = useCallback(() => { setCsrfToken(null); setUser(null); }, []);
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
    login: async (email, password) => accept(await api.post('/auth/login', { email, password })),
    register: async (data) => accept(await api.post('/auth/register', data)),
    logout: async () => { try { await api.post('/auth/logout'); } catch { /* already signed out */ } clear(); },
    logoutEverywhere: async () => { try { await api.post('/auth/logout-all'); } catch { /* already signed out */ } clear(); },
  };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
