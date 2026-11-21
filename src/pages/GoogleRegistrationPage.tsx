import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../AppContext';
import { Button, Input } from '../components/UI';
import { api, ApiError } from '../lib/api';
import { registrationNameError, registrationNameFields } from '../../shared/registrationNames.js';

const expiredMessage = 'การสมัครด้วย Google หมดอายุหรือไม่ตรงกับเบราว์เซอร์นี้ กรุณาเริ่มใหม่';
const nameFields = ['firstName', 'lastName'] as const;

export function GoogleRegistrationPage() {
  const [params] = useSearchParams();
  const flow = params.get('flow') || '';
  const validFlow = /^[A-Za-z0-9_-]{43}$/.test(flow) && params.getAll('flow').length === 1;
  return <main className="auth-form-wrap"><div className="auth-form-card">
    <header><h1>สมัครสมาชิกด้วย Google</h1></header>
    {validFlow ? <RegistrationForm key={flow} flow={flow}/> : <RegistrationError message={expiredMessage}/>}
  </div></main>;
}

function RegistrationError({ message }: { message: string }) {
  return <><p className="form-alert" role="alert">{message}</p>
    <Link className="button button-secondary" to="/login">กลับไปเข้าสู่ระบบ</Link></>;
}

function RegistrationForm({ flow }: { flow: string }) {
  const { registerGoogle, notify } = useApp();
  const navigate = useNavigate();
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof api.googleRegistrationPreview>> | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [terminalError, setTerminalError] = useState('');
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);

  useEffect(() => {
    let active = true;
    // Let AppProvider initialize the tab's session revision before making the request.
    queueMicrotask(async () => {
      if (!active) return;
      try {
        const result = await api.googleRegistrationPreview(flow);
        if (active) setPreview(result);
      } catch (caught) {
        if (active) setTerminalError(caught instanceof ApiError && caught.status === 401
          ? expiredMessage : 'เปิดหน้าสมัครด้วย Google ไม่สำเร็จ กรุณาเริ่มใหม่');
      }
    });
    return () => { active = false; };
  }, [flow]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked.current) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const names = { firstName: String(values.get('firstName') ?? '').trim(), lastName: String(values.get('lastName') ?? '').trim() };
    const errors = Object.fromEntries(nameFields.map(field => [field, registrationNameError(field, names[field])]).filter(([, message]) => message));
    setFieldErrors(errors);
    setError('');
    const firstInvalid = nameFields.find(field => errors[field]);
    if (firstInvalid) {
      (form.elements.namedItem(firstInvalid) as HTMLInputElement).focus();
      return;
    }
    locked.current = true;
    setBusy(true);
    try {
      await registerGoogle(flow, names);
      notify('สร้างบัญชีเรียบร้อยแล้ว');
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) setTerminalError(expiredMessage);
      else if (caught instanceof ApiError && caught.status === 409) setTerminalError('บัญชีหรืออีเมลนี้สมัครแล้ว กรุณาเข้าสู่ระบบอีกครั้ง');
      else if (caught instanceof ApiError && Object.keys(caught.fieldErrors).length) setFieldErrors(caught.fieldErrors);
      else setError('สมัครสมาชิกไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }

  async function cancel() {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      await api.cancelGoogleRegistration(flow);
      navigate('/login', { replace: true });
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) navigate('/login', { replace: true });
      else setError('ยกเลิกการสมัครไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }

  if (terminalError) return <RegistrationError message={terminalError}/>;
  if (!preview) return <p role="status">กำลังโหลดข้อมูลจาก Google…</p>;
  return <form className="register-form" onSubmit={submit} noValidate>
    <Input label="อีเมล" value={preview.email} type="email" readOnly/>
    {nameFields.map(field => <Input key={field} label={`${registrationNameFields[field].label} *`} name={field}
      defaultValue={preview[field]} maxLength={registrationNameFields[field].max} required disabled={busy}
      error={fieldErrors[field]} onChange={event => {
        if (fieldErrors[field]) setFieldErrors({ ...fieldErrors, [field]: registrationNameError(field, event.target.value) });
      }}/>)}
    {error && <p className="form-alert" role="alert">{error}</p>}
    <Button className="w-full" type="submit" disabled={busy}>สมัครสมาชิก</Button>
    <Button className="w-full" type="button" variant="quiet" disabled={busy} onClick={cancel}>ยกเลิก</Button>
  </form>;
}
