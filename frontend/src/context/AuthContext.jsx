// This file is part of the frontend of the application. It defines an authentication context using React's Context API. 
// The context provides authentication-related state and functions to its children components.
import { createContext, useCallback, useContext, useEffect, useState } from 'react';

// importing utility functions from the api module to handle API requests and token management.
import { api, getToken, setToken, setUnauthorizedHandler } from '../lib/api.js';

// Creating a new context for authentication and a custom hook to access it.
const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

// The AuthProvider component wraps its children with the AuthCtx.Provider, providing authentication state and functions.
export function AuthProvider({ children }) {

  // State variables to hold the current user and loading status.
  const [user, setUser] = useState(null);
  // The loading state is initialized based on whether a token exists, indicating if the user is already authenticated.
  const [loading, setLoading] = useState(!!getToken());

  // The clear function resets the authentication state by clearing the token and user information.
  const clear = useCallback(() => { setToken(null); setUser(null); }, []);
  useEffect(() => { setUnauthorizedHandler(clear); }, [clear]);

  // The useEffect hook fetches the current user's information if a token is present. 
  // It updates the user state and handles loading status accordingly.
  useEffect(() => {
    if (!getToken()) return;
    api.get('/auth/me').then((r) => setUser(r.user)).catch(clear).finally(() => setLoading(false));
  }, [clear]);

  // The accept function is a helper that updates the token and user state upon successful authentication.
  const accept = (r) => { setToken(r.token); setUser(r.user); return r.user; };
  const value = {
    user, loading, isAdmin: user?.role === 'admin',
    login: async (email, password) => accept(await api.post('/auth/login', { email, password })),
    register: async (data) => accept(await api.post('/auth/register', data)),
    logout: async () => { try { await api.post('/auth/logout'); } catch { /* already signed out */ } clear(); },
  };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
