import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from './lib/api';
import type { JoinRequest } from './types';

type OwnerRequestsState = {
  ownerRequests: JoinRequest[];
  loading: boolean;
  error: string;
  refreshOwnerRequests: () => Promise<void>;
  updateOwnerRequest: (request: JoinRequest) => void;
};

const Context = createContext<OwnerRequestsState | null>(null);

export function OwnerRequestsProvider({ children }: { children: ReactNode }) {
  const [ownerRequests, setOwnerRequests] = useState<JoinRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const version = useRef(0);
  const { pathname } = useLocation();

  const refreshOwnerRequests = useCallback(async () => {
    const currentVersion = ++version.current;
    try {
      const requests = await api.ownerRequests();
      if (currentVersion === version.current) { setOwnerRequests(requests); setError(''); }
    } catch (caught) {
      // Keep the last known pending requests until a successful refresh.
      if (currentVersion === version.current) setError(caught instanceof Error ? caught.message : 'โหลดคำขอไม่สำเร็จ');
    } finally {
      if (currentVersion === version.current) setLoading(false);
    }
  }, []);

  const updateOwnerRequest = useCallback((updated: JoinRequest) => {
    // An older poll must not restore a request that was just decided.
    version.current += 1;
    setOwnerRequests(current => current.map(request => request.requestId === updated.requestId ? updated : request));
    setError('');
  }, []);

  useEffect(() => {
    const refreshWhenVisible = () => { if (document.visibilityState === 'visible') void refreshOwnerRequests(); };
    refreshWhenVisible();
    const timer = window.setInterval(refreshWhenVisible, 30_000);
    window.addEventListener('focus', refreshWhenVisible);
    window.addEventListener('online', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      version.current += 1;
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshWhenVisible);
      window.removeEventListener('online', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [pathname, refreshOwnerRequests]);

  return <Context.Provider value={{ ownerRequests, loading, error, refreshOwnerRequests, updateOwnerRequest }}>{children}</Context.Provider>;
}

export function useOwnerRequests() {
  const context = useContext(Context);
  if (!context) throw new Error('useOwnerRequests must be used inside OwnerRequestsProvider');
  return context;
}
