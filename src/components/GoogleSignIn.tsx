import { useEffect, useState } from 'react';
import { api, SessionChangedError } from '../lib/api';
import { Button } from './UI';
import './GoogleSignIn.css';

function GoogleLogo() {
  return <img className="google-sign-in-logo" src="/assets/google-g.png" width={20} height={20} alt="" aria-hidden="true" />;
}

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
    <p className="field-hint google-sign-in-divider">หรือใช้บัญชี Google</p>
    {enabled && !loading && !failed
      ? <a className="button button-secondary google-sign-in w-full" href={`/api/auth/oauth/google?returnTo=${encodeURIComponent(returnTo)}`}
        aria-disabled={disabled || undefined} onClick={event => { if (disabled) event.preventDefault(); }}>
        <GoogleLogo /><span>ดำเนินการต่อด้วย Google</span>
      </a>
      : <Button type="button" variant="secondary" className="google-sign-in w-full" loading={loading} disabled={!failed || disabled}
        onClick={() => setAttempt(value => value + 1)}>
        {!loading && <GoogleLogo />}<span>{loading ? 'กำลังตรวจสอบ Google…' : failed ? 'ลองเชื่อมต่อ Google อีกครั้ง' : 'Google ยังไม่เปิดใช้งาน'}</span>
      </Button>}
    {failed && <p className="field-hint" role="status">ตรวจสอบการเข้าสู่ระบบด้วย Google ไม่สำเร็จ คุณยังใช้อีเมลและรหัสผ่านได้</p>}
  </div>;
}
