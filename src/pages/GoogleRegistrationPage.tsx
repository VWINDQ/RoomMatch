import { useEffect, useRef, useState, type FocusEvent, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../AppContext';
import { Button, Input } from '../components/UI';
import { api, ApiError } from '../lib/api';
import { RegistrationProfileFields } from '../components/RegistrationProfileFields';
import { useFormFeedback } from '../components/FormFeedback';
import { readRegistrationProfile, registrationFieldFeedback, validateRegistration } from '../lib/registration';

const expiredMessage = 'การสมัครด้วย Google หมดอายุหรือไม่ตรงกับเบราว์เซอร์นี้ กรุณาเริ่มใหม่';

export function GoogleRegistrationPage() {
  const [params] = useSearchParams();
  const flow = params.get('flow') || '';
  const validFlow = /^[A-Za-z0-9_-]{43}$/.test(flow) && params.getAll('flow').length === 1;
  return <main className="auth-form-wrap"><div className="auth-form-card">
    <header className="text-center"><h1>สมัครสมาชิกด้วย Google</h1></header>
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
  const [accountType, setAccountType] = useState('');
  const [focusErrors, setFocusErrors] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  useFormFeedback(fieldErrors, formRef, focusErrors);
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

  function validateField(event: FocusEvent<HTMLFormElement> | FormEvent<HTMLFormElement>, onlyInvalid = false) {
    const field = event.target;
    if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement) || field.name === 'email') return;
    const feedback = registrationFieldFeedback(field, event.currentTarget, accountType, fieldErrors, onlyInvalid);
    if (!feedback) return;
    const { name, message } = feedback;
    setFocusErrors(false);
    setFieldErrors(current => {
      const next = { ...current };
      if (message) next[name] = message;
      else delete next[name];
      return next;
    });
  }

  function clearUniversityError() {
    setFocusErrors(false);
    setFieldErrors(({ university: _university, ...remaining }) => remaining);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked.current) return;
    const values = new FormData(event.currentTarget);
    const errors = validateRegistration(values, true);
    setFieldErrors(errors);
    setError('');
    setFocusErrors(true);
    if (Object.keys(errors).length) return;
    locked.current = true;
    setBusy(true);
    try {
      await registerGoogle(flow, readRegistrationProfile(values));
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
  return <form ref={formRef} className="register-form" onSubmit={submit} noValidate
    onBlur={validateField} onChange={event => validateField(event, true)}>
    <fieldset className="contents" disabled={busy}>
      <RegistrationProfileFields firstName={preview.firstName} lastName={preview.lastName} accountType={accountType}
        fieldErrors={fieldErrors} onUniversitySelect={clearUniversityError} onAccountTypeChange={value => {
          setAccountType(value);
          clearUniversityError();
        }}/>
      <Input label="อีเมล *" name="email" value={preview.email} type="email" readOnly required/>
    </fieldset>
    {error && <p className="form-alert" role="alert">{error}</p>}
    <Button className="w-full" type="submit" disabled={busy}>สมัครสมาชิก</Button>
    <Button className="w-full" type="button" variant="quiet" disabled={busy} onClick={cancel}>ยกเลิก</Button>
  </form>;
}
