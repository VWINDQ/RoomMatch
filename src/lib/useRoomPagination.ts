import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigationType, useSearchParams } from 'react-router-dom';
import type { RoomPage } from './api';

export function useRoomPagination(load: (params: URLSearchParams) => Promise<RoomPage>, pageSize: number, overrides: Record<string, string> = {}, delay = 0) {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigationType = useNavigationType();
  const listStartRef = useRef<HTMLDivElement>(null);
  const pageScrollIntent = useRef<string | null>(null);
  const readyScroll = useRef<{ key: string; locationKey: string; generation: number } | null>(null);
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
    const scrollRequested = pageScrollIntent.current === key && navigationType === 'PUSH';
    pageScrollIntent.current = null;
    readyScroll.current = null;
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
        if (scrollRequested && response.page === Number(page)) {
          readyScroll.current = { key: canonicalKey, locationKey: location.key, generation: requestGeneration };
        }
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
  }, [key, searchKey, overridesKey, revision, load, pageSize, delay, setParams, location.key, navigationType]);

  useLayoutEffect(() => {
    const pending = readyScroll.current;
    const target = listStartRef.current;
    if (!pending || !target || loading || error || resultKey !== key) return;
    readyScroll.current = null;
    if (pending.key !== key || pending.locationKey !== location.key || pending.generation !== generation.current || navigationType !== 'PUSH') return;

    // Scroll the actual layout scroller after the selected page has committed.
    // Never focus the target: keyboard focus remains with the user's control.
    const workspace = target.closest<HTMLElement>('.workspace');
    const scrollsWorkspace = workspace && /auto|scroll/.test(getComputedStyle(workspace).overflowY);
    const rootTop = scrollsWorkspace ? workspace.getBoundingClientRect().top : 0;
    const header = document.querySelector<HTMLElement>('.compact-header');
    const headerBottom = header && /sticky|fixed/.test(getComputedStyle(header).position) ? header.getBoundingClientRect().bottom : 0;
    const currentTop = scrollsWorkspace ? workspace.scrollTop : window.scrollY;
    const top = Math.max(0, currentTop + target.getBoundingClientRect().top - Math.max(rootTop, headerBottom) - 16);
    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth';
    if (scrollsWorkspace) workspace.scrollTo({ top, behavior });
    else window.scrollTo({ top, behavior });
  }, [result, resultKey, key, loading, error, location.key, navigationType]);

  const refresh = () => {
    pageScrollIntent.current = null; readyScroll.current = null;
    generation.current += 1; // Invalidate an older response before the next effect runs.
    setRevision(value => value + 1);
  };
  const changeParams = (changes: Record<string, string>) => {
    pageScrollIntent.current = null; readyScroll.current = null;
    setParams(current => {
      const next = new URLSearchParams(current);
      for (const [name, value] of Object.entries(changes)) { if (value) next.set(name, value); else next.delete(name); }
      if (!Object.hasOwn(changes, 'page')) next.delete('page');
      return next;
    });
  };
  const changePage = (page: number) => {
    if (loading || resultKey !== key || pageScrollIntent.current !== null || page === result.page) return;
    const next = new URLSearchParams(params);
    if (page === 1) next.delete('page'); else next.set('page', String(page));
    pageScrollIntent.current = JSON.stringify([next.toString(), overridesKey, revision]);
    setParams(next);
  };
  const setRooms: React.Dispatch<React.SetStateAction<RoomPage['rooms']>> = update => setResult(current => ({
    ...current, rooms: typeof update === 'function' ? update(current.rooms) : update,
  }));
  return { ...result, params, loading: loading || resultKey !== key, error, refresh, changeParams, changePage, listStartRef, setRooms };
}
