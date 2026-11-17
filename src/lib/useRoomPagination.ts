import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { RoomPage } from './api';

export function useRoomPagination(load: (params: URLSearchParams) => Promise<RoomPage>, pageSize: number, overrides: Record<string, string> = {}, delay = 0) {
  const [params, setParams] = useSearchParams();
  const searchKey = params.toString();
  const overridesKey = JSON.stringify(overrides);
  const [result, setResult] = useState<RoomPage>({ rooms: [], total: 0, page: 1, pageSize, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [resultKey, setResultKey] = useState('');
  const canonicalRequest = useRef<string | null>(null);
  const generation = useRef(0);
  const key = JSON.stringify([searchKey, overridesKey, revision]);

  useEffect(() => {
    if (canonicalRequest.current === key) {
      canonicalRequest.current = null;
      setLoading(false);
      return;
    }
    canonicalRequest.current = null;
    let active = true;
    const requestGeneration = ++generation.current;
    setLoading(true); setError('');
    const timer = window.setTimeout(async () => {
      const requestParams = new URLSearchParams(searchKey);
      const rawPage = requestParams.get('page') || '1';
      const page = /^[1-9]\d*$/.test(rawPage) && Number.isSafeInteger(Number(rawPage)) ? rawPage : '1';
      requestParams.delete('limit'); requestParams.delete('offset');
      for (const [name, value] of Object.entries(JSON.parse(overridesKey) as Record<string, string>)) {
        if (value) requestParams.set(name, value); else requestParams.delete(name);
      }
      // Paging belongs to the URL/page configuration, never to filter defaults.
      requestParams.set('page', page); requestParams.set('pageSize', String(pageSize));
      try {
        const response = await load(requestParams);
        if (!active || generation.current !== requestGeneration) return;
        const canonical = new URLSearchParams(searchKey);
        if (response.page === 1) canonical.delete('page'); else canonical.set('page', String(response.page));
        const canonicalKey = JSON.stringify([canonical.toString(), overridesKey, revision]);
        setResult(response); setResultKey(canonicalKey);
        if (canonical.toString() !== searchKey) {
          canonicalRequest.current = canonicalKey;
          setParams(canonical, { replace: true });
        }
      } catch (caught) {
        if (active && generation.current === requestGeneration) {
          setResultKey(key); setError(caught instanceof Error ? caught.message : 'โหลดรายการไม่สำเร็จ');
        }
      } finally {
        if (active && generation.current === requestGeneration) setLoading(false);
      }
    }, delay);
    return () => { active = false; window.clearTimeout(timer); };
  }, [key, searchKey, overridesKey, revision, load, pageSize, delay, setParams]);

  const refresh = () => {
    generation.current += 1; // Invalidate an older response before the next effect runs.
    setRevision(value => value + 1);
  };
  const changeParams = (changes: Record<string, string>) => setParams(current => {
    const next = new URLSearchParams(current);
    for (const [name, value] of Object.entries(changes)) { if (value) next.set(name, value); else next.delete(name); }
    if (!Object.hasOwn(changes, 'page')) next.delete('page');
    return next;
  });
  const setRooms: React.Dispatch<React.SetStateAction<RoomPage['rooms']>> = update => setResult(current => ({
    ...current, rooms: typeof update === 'function' ? update(current.rooms) : update,
  }));
  return { ...result, params, loading: loading || resultKey !== key, error, refresh, changeParams, setRooms };
}
