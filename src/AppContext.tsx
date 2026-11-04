import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError, tokenStorage } from './lib/api';
import type { User } from './types';

type RegisterPayload = { firstName: string; lastName: string; email: string; password: string; phone: string; gender?: string; dateOfBirth?: string; university?: string };
type AppState = {
  user: User | null; authLoading: boolean; authError: string; toast: string;
  login: (email: string, password: string) => Promise<void>;
  register: (payload: RegisterPayload) => Promise<void>;
  logout: () => void; refreshUser: (updated?: User) => Promise<void>; retryAuth: () => Promise<void>; notify: (message: string) => void;
};

const Context = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(Boolean(tokenStorage.get()));
  const [authError, setAuthError] = useState('');
  const [toast, setToast] = useState('');
  const notify = useCallback((message: string) => setToast(message), []);
  const refreshUser = useCallback(async (updated?: User) => {
    const token = tokenStorage.get();
    const result = updated ?? await api.me();
    if (token && token === tokenStorage.get()) setUser(result);
  }, []);
  const retryAuth = useCallback(async () => {
    setAuthLoading(true); setAuthError('');
    try { await refreshUser(); }
    catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) { tokenStorage.clear(); setUser(null); }
      else setAuthError(caught instanceof Error ? caught.message : 'ตรวจสอบการเข้าสู่ระบบไม่สำเร็จ');
    } finally { setAuthLoading(false); }
  }, [refreshUser]);

  useEffect(() => {
    if (!tokenStorage.get()) return;
    retryAuth();
  }, [retryAuth]);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(''), 2600); return () => window.clearTimeout(timer); }, [toast]);

  const value = useMemo<AppState>(() => ({
    user, authLoading, authError, toast, notify, refreshUser, retryAuth,
    login: async (email, password) => { const result = await api.login({ email, password }); tokenStorage.set(result.token); setUser(result.user); },
    register: async payload => { const result = await api.register(payload); tokenStorage.set(result.token); setUser(result.user); },
    logout: () => { tokenStorage.clear(); setUser(null); },
  }), [authError, authLoading, notify, refreshUser, retryAuth, toast, user]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useApp() {
  const context = useContext(Context);
  if (!context) throw new Error('useApp must be used inside AppProvider');
  return context;
}
