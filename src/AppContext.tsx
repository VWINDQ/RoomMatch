import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, SessionChangedError, subscribeUnauthorized, tokenStorage } from './lib/api';
import type { User } from './types';

type RegisterPayload = { firstName: string; lastName: string; email: string; password: string; phone: string; gender?: string; dateOfBirth?: string; university?: string };
type AppState = {
  user: User | null; authLoading: boolean; authError: string; toast: string;
  login: (email: string, password: string) => Promise<void>;
  register: (payload: RegisterPayload) => Promise<void>;
  completeOAuth: () => Promise<void>;
  logout: () => boolean; registerLogoutGuard: (guard: () => boolean) => () => void;
  refreshUser: (updated?: User) => Promise<void>; retryAuth: () => Promise<void>; notify: (message: string) => void;
};

const Context = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(Boolean(tokenStorage.get()));
  const [authError, setAuthError] = useState('');
  const [toast, setToast] = useState('');
  // A newer auth operation takes precedence over any pending account check.
  const authVersion = useRef(0);
  // Login and registration share a sequence independent of account refreshes.
  const signInVersion = useRef(0);
  const logoutGuard = useRef<(() => boolean) | null>(null);
  const registerLogoutGuard = useCallback((guard: () => boolean) => {
    logoutGuard.current = guard;
    return () => { if (logoutGuard.current === guard) logoutGuard.current = null; };
  }, []);
  const notify = useCallback((message: string) => setToast(message), []);
  const clearSession = useCallback(() => {
    signInVersion.current += 1;
    authVersion.current += 1;
    tokenStorage.clear();
    setUser(null);
    setAuthError('');
    setAuthLoading(false);
  }, []);
  const expireSession = useCallback((rejectedToken: string) => {
    if (tokenStorage.get() !== rejectedToken) return;
    clearSession();
    notify('การเข้าสู่ระบบสิ้นสุด กรุณาเข้าสู่ระบบอีกครั้ง');
  }, [clearSession, notify]);
  const logout = useCallback(() => {
    // Only an explicit logout may wait for unsaved edits; session expiry must not.
    if (logoutGuard.current?.()) return false;
    clearSession();
    return true;
  }, [clearSession]);

  useEffect(() => subscribeUnauthorized(expireSession), [expireSession]);

  const refreshUser = useCallback(async (updated?: User) => {
    const token = tokenStorage.get();
    const version = authVersion.current;
    const result = updated ?? await api.me();
    if (token && token === tokenStorage.get() && version === authVersion.current) setUser(result);
  }, []);
  const retryAuth = useCallback(async () => {
    const token = tokenStorage.get();
    if (!token) {
      clearSession();
      return;
    }
    const version = ++authVersion.current;
    setAuthLoading(true);
    setAuthError('');
    try {
      await refreshUser();
    } catch (caught) {
      if (version !== authVersion.current || token !== tokenStorage.get()) return;
      if (caught instanceof ApiError && caught.status === 401) expireSession(token);
      else setAuthError(caught instanceof Error ? caught.message : 'ตรวจสอบการเข้าสู่ระบบไม่สำเร็จ');
    } finally {
      if (version === authVersion.current && token === tokenStorage.get()) setAuthLoading(false);
    }
  }, [clearSession, expireSession, refreshUser]);

  const acceptSession = useCallback((result: { token: string; user: User }) => {
    authVersion.current += 1;
    tokenStorage.set(result.token);
    setUser(result.user);
    setAuthError('');
    setAuthLoading(false);
  }, []);

  const signIn = useCallback(async (request: () => Promise<{ token: string; user: User }>) => {
    const version = ++signInVersion.current;
    try {
      const result = await request();
      if (version !== signInVersion.current) throw new SessionChangedError();
      acceptSession(result);
    } catch (caught) {
      if (version !== signInVersion.current) throw new SessionChangedError();
      throw caught;
    }
  }, [acceptSession]);
  const completeOAuth = useCallback(() => signIn(() => api.completeOAuth()), [signIn]);

  useEffect(() => {
    const unsubscribe = tokenStorage.subscribe(() => {
      signInVersion.current += 1;
      authVersion.current += 1;
      setUser(null);
      setAuthError('');
      setToast('');
      // Storage already changed in the other tab; do not write it back from here.
      if (tokenStorage.get()) void retryAuth();
      else setAuthLoading(false);
    });
    if (tokenStorage.get()) void retryAuth();
    return () => {
      signInVersion.current += 1;
      unsubscribe();
    };
  }, [retryAuth]);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(''), 2600); return () => window.clearTimeout(timer); }, [toast]);

  const value = useMemo<AppState>(() => ({
    user, authLoading, authError, toast, notify, refreshUser, retryAuth, completeOAuth,
    login: (email, password) => signIn(() => api.login({ email, password })),
    register: payload => signIn(() => api.register(payload)),
    logout, registerLogoutGuard,
  }), [authError, authLoading, completeOAuth, logout, registerLogoutGuard, notify, refreshUser, retryAuth, signIn, toast, user]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useApp() {
  const context = useContext(Context);
  if (!context) throw new Error('useApp must be used inside AppProvider');
  return context;
}
