import { useEffect, useState } from 'react';
import { api, SessionChangedError } from '../lib/api';
import { Button } from './UI';

export function GoogleSignIn({ disabled, returnTo = '/rooms' }: { disabled: boolean; returnTo?: string }) {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setFailed(false);
    api.oauthProviders().then(providers => { if (active) setEnabled(providers.google); })
      .catch(error => { if (active && !(error instanceof SessionChangedError)) setFailed(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [attempt]);
  return <div className="auth-oauth">
    <p className="field-hint">หรือใช้บัญชี Google</p>
    {enabled && !loading && !failed
      ? <a className="button button-secondary w-full" href={`/api/auth/oauth/google?returnTo=${encodeURIComponent(returnTo)}`}
        aria-disabled={disabled || undefined} onClick={event => { if (disabled) event.preventDefault(); }}>
        ดำเนินการต่อด้วย Google
      </a>
      : <Button type="button" variant="secondary" className="w-full" loading={loading} disabled={!failed || disabled}
        onClick={() => setAttempt(value => value + 1)}>
        {loading ? 'กำลังตรวจสอบ Google…' : failed ? 'ลองเชื่อมต่อ Google อีกครั้ง' : 'Google ยังไม่เปิดใช้งาน'}
      </Button>}
    {failed && <p className="field-hint" role="status">ตรวจสอบการเข้าสู่ระบบด้วย Google ไม่สำเร็จ คุณยังใช้อีเมลและรหัสผ่านได้</p>}
  </div>;
}
