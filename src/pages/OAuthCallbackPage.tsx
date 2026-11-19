import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../AppContext';
import { SessionChangedError } from '../lib/api';

export function OAuthCallbackPage() {
  const { completeOAuth, notify, authLoading } = useApp();
  const navigate = useNavigate();
  const { search } = useLocation();
  const [error, setError] = useState('');
  useEffect(() => {
    if (authLoading) return;
    let active = true;
    // StrictMode replays effects. Start only after its first cleanup so a
    // single-use ticket cannot be consumed by an obsolete sign-in operation.
    queueMicrotask(async () => {
      if (!active) return;
      try {
        await completeOAuth();
        if (!active) return;
        const target = new URLSearchParams(search).get('returnTo') || '/rooms';
        const safeTarget = /^\/(rooms|favorites|my-listings|requests|matches|profile|friends)([/?#]|$)/.test(target)
          && !/[\\\u0000-\u0020]/.test(target) ? target : '/rooms';
        notify('เข้าสู่ระบบด้วย Google แล้ว');
        navigate(safeTarget, { replace: true });
      } catch (caught) {
        if (active) setError(caught instanceof SessionChangedError
          ? 'บัญชีเปลี่ยนระหว่างเข้าสู่ระบบ กรุณาลองอีกครั้ง'
          : 'เข้าสู่ระบบด้วย Google ไม่สำเร็จหรือหมดเวลา กรุณาลองอีกครั้ง');
      }
    });
    return () => { active = false; };
  }, [authLoading, completeOAuth, navigate, notify, search]);
  return <main className="route-loading">
    {error ? <><p role="alert">{error}</p><Link className="button button-primary" to="/login">กลับไปเข้าสู่ระบบ</Link></>
      : <p role="status">กำลังเข้าสู่ระบบด้วย Google…</p>}
  </main>;
}
