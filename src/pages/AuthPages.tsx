import { useMemo, useRef, useState, type FocusEvent, type FormEvent } from 'react';
import { Building2, Eye, EyeOff } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../AppContext';
import { Button, Input } from '../components/UI';
import { useFormFeedback } from '../components/FormFeedback';
import { ApiError, SessionChangedError } from '../lib/api';
import { BirthDateInput } from '../components/BirthDateInput';
import { parseBirthDate } from '../lib/birthDate';
import { GoogleSignIn } from '../components/GoogleSignIn';
import { AccountProfileFields } from '../components/AccountProfileFields';
import { readUniversity } from '../components/UniversityPicker';
import { validateAccountProfile } from '../../shared/accountProfile.js';
import { registrationNameError, registrationNameFields } from '../../shared/registrationNames.js';

const oauthErrors: Record<string, string> = {
  cancelled: 'ยกเลิกการเข้าสู่ระบบด้วย Google แล้ว คุณสามารถลองใหม่ได้',
  email_exists: 'อีเมลนี้มีบัญชี RoomMatch แล้ว กรุณาเข้าสู่ระบบด้วยรหัสผ่านเดิม',
  invalid_state: 'การเข้าสู่ระบบด้วย Google หมดเวลาหรือไม่ตรงกับเบราว์เซอร์นี้ กรุณาลองใหม่',
  invalid_identity: 'ไม่สามารถยืนยันบัญชี Google ได้ กรุณาใช้บัญชีที่ยืนยันอีเมลแล้ว',
  account_unavailable: 'บัญชีนี้ไม่พร้อมใช้งาน',
  unavailable: 'ยังไม่ได้เปิดใช้งานการเข้าสู่ระบบด้วย Google',
  failed: 'เข้าสู่ระบบด้วย Google ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
};

const registrationFields = {
  ...registrationNameFields,
  phone: { label: 'เบอร์โทรศัพท์', max: 10, required: true },
  gender: { label: 'เพศ', max: 50, required: false },
  dateOfBirth: { label: 'วันเกิด', max: 10, required: true },
  accountType: { label: 'สถานะผู้ใช้', max: 50, required: true },
  university: { label: 'มหาวิทยาลัย', max: 255, required: false },
  email: { label: 'อีเมล', max: 320, required: true },
  password: { label: 'รหัสผ่าน', max: 256, required: true },
};

type RegistrationField = keyof typeof registrationFields;

function isRegistrationField(name: string): name is RegistrationField {
  return Object.hasOwn(registrationFields, name);
}

function registrationFieldError(name: RegistrationField, raw: string) {
  if (name === 'firstName' || name === 'lastName') return registrationNameError(name, raw);
  const value = raw.trim();
  const { label, max, required } = registrationFields[name];
  if (!value) return required ? `กรุณากรอก${label}` : '';
  if (name === 'phone' && !/^\d{10}$/.test(value)) return 'กรอกเบอร์โทรศัพท์เป็นตัวเลข 10 หลัก';
  if (name === 'dateOfBirth') {
    try { parseBirthDate(value); }
    catch (error) { return error instanceof Error ? error.message : 'กรุณากรอกวันเกิดให้ถูกต้อง'; }
  }
  if (value.length > max) return `${label}ต้องไม่เกิน ${max} ตัวอักษร`;
  if (name === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'กรุณากรอกอีเมลให้ถูกต้อง เช่น name@example.com';
  if (name === 'password' && value.length < 8) return 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร';
  return '';
}

function loginFieldError(name: 'email' | 'password', raw: string) {
  const value = raw.trim();
  if (!value) return name === 'email' ? 'กรอกอีเมลที่ใช้สมัครบัญชี เช่น name@example.com' : 'กรอกรหัสผ่านที่ตั้งไว้ตอนสมัครบัญชี';
  if (name === 'email') {
    if (value.length > 320) return 'อีเมลยาวเกิน 320 ตัวอักษร กรุณาตรวจสอบว่าคัดลอกข้อมูลมาเกินหรือไม่';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'รูปแบบอีเมลไม่ถูกต้อง ใช้รูปแบบ name@example.com โดยมี @ และชื่อโดเมน';
  } else {
    if (value.length < 8) return 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร กรุณาตรวจสอบว่ากรอกครบแล้ว';
    if (value.length > 256) return 'รหัสผ่านยาวเกิน 256 ตัวอักษร กรุณาตรวจสอบว่าคัดลอกข้อมูลมาเกินหรือไม่';
  }
  return '';
}

function loginFailure(caught: unknown) {
  if (caught instanceof ApiError) {
    if (caught.status === 401 || caught.status === 403) return {
      message: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง',
      advice: 'ตรวจสอบอีเมลที่ใช้สมัคร ภาษาแป้นพิมพ์ และ Caps Lock หรือกดแสดงรหัสผ่านเพื่อตรวจสอบก่อนลองอีกครั้ง',
    };
    if (caught.networkError || caught.status === 0) return {
      message: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้',
      advice: 'ตรวจสอบการเชื่อมต่ออินเทอร์เน็ตแล้วลองอีกครั้ง หากยังไม่ได้ ให้รอสักครู่ ข้อมูลที่กรอกยังอยู่',
    };
    if (caught.status === 429) return {
      message: 'พยายามเข้าสู่ระบบบ่อยเกินไป',
      advice: 'รอสักครู่ก่อนลองอีกครั้ง ไม่ต้องกดเข้าสู่ระบบซ้ำติดกัน ข้อมูลที่กรอกยังอยู่',
    };
    if (caught.status >= 500) return {
      message: 'บริการเข้าสู่ระบบขัดข้องชั่วคราว',
      advice: 'ข้อมูลที่กรอกยังอยู่ กรุณารอสักครู่แล้วลองอีกครั้ง โดยไม่ต้องเปลี่ยนอีเมลหรือรหัสผ่าน',
    };
  }
  return {
    message: 'เข้าสู่ระบบไม่สำเร็จ',
    advice: 'ระบบยังตรวจสอบบัญชีไม่สำเร็จ ข้อมูลที่กรอกยังอยู่ กรุณาลองเข้าสู่ระบบอีกครั้ง',
  };
}

function AuthShell({ mode }: { mode: 'login' | 'register' }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, register, notify } = useApp();

  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loginAdvice, setLoginAdvice] = useState('');
  const [error, setError] = useState(() => {
    const reason = new URLSearchParams(location.search).get('oauth_error') ?? '';
    return Object.hasOwn(oauthErrors, reason) ? oauthErrors[reason] : '';
  });
  const submissionVersion = useRef(0);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [accountType, setAccountType] = useState('');
  const [focusErrors, setFocusErrors] = useState(Boolean(error));

  const formRef = useRef<HTMLFormElement>(null);
  const formErrors = useMemo(() => {
    const feedback = { ...fieldErrors };
    if (error) feedback.form = error;
    return feedback;
  }, [error, fieldErrors]);
  const summaryRef = useFormFeedback(formErrors, formRef, focusErrors);

  const validateField = (event: FocusEvent<HTMLFormElement> | FormEvent<HTMLFormElement>, onlyInvalid = false) => {
    const field = event.target;
    if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement)) return;
    if (mode === 'login') {
      const name = field.name;
      if (name !== 'email' && name !== 'password') return;
      if (onlyInvalid) {
        setError('');
        setLoginAdvice('');
      }
      if (onlyInvalid && !fieldErrors[name]) return;
      const message = loginFieldError(name, field.value);
      setFocusErrors(false);
      setFieldErrors(current => {
        const next = { ...current };
        if (message) next[name] = message;
        else delete next[name];
        return next;
      });
      return;
    }
    if (field.name === 'universityQuery' && (onlyInvalid || field.form?.elements.namedItem('university'))) return;
    const name = field.name === 'universityQuery' ? 'university' : field.name;
    if (!isRegistrationField(name)) return;
    if (onlyInvalid && !fieldErrors[name]) return;
    const message = name === 'accountType' || name === 'university'
      ? validateAccountProfile(name === 'accountType' ? field.value : accountType, readUniversity(new FormData(event.currentTarget)))[name] || ''
      : registrationFieldError(name, field.value);
    // Keep a server-side error (such as a taken email) until the value changes.
    if (!onlyInvalid && !message) return;
    setFocusErrors(false);
    setFieldErrors(current => {
      if (message) return current[name] === message ? current : { ...current, [name]: message };
      if (!current[name]) return current;
      const remaining = { ...current };
      delete remaining[name];
      return remaining;
    });
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mode === 'register' && loading) return;
    setError('');
    setLoginAdvice('');
    const data = new FormData(event.currentTarget);
    if (mode === 'login') {
      const errors: Record<string, string> = {};
      for (const name of ['email', 'password'] as const) {
        const message = loginFieldError(name, String(data.get(name) ?? ''));
        if (message) errors[name] = message;
      }
      setFieldErrors(errors);
      setFocusErrors(true);
      if (Object.keys(errors).length) return;
    }
    if (mode === 'register') {
      const errors: Record<string, string> = {};
      for (const name of Object.keys(registrationFields).filter(isRegistrationField)) {
        if (name === 'accountType' || name === 'university') continue;
        const message = registrationFieldError(name, String(data.get(name) ?? ''));
        if (message) errors[name] = message;
      }
      Object.assign(errors, validateAccountProfile(data.get('accountType'), readUniversity(data)));
      setFieldErrors(errors);
      setFocusErrors(true);
      if (Object.keys(errors).length) return;
    }
    const version = ++submissionVersion.current;
    setLoading(true);

    try {
      const email = String(data.get('email') ?? '').trim();
      const password = String(data.get('password') ?? '');

      if (mode === 'login') {
        await login(email, password);
      } else {
        await register({
          firstName: String(data.get('firstName') ?? '').trim(),
          lastName: String(data.get('lastName') ?? '').trim(),
          email,
          password,
          phone: String(data.get('phone') ?? '').trim(),
          gender: String(data.get('gender') ?? ''),
          dateOfBirth: parseBirthDate(String(data.get('dateOfBirth') ?? '')),
          accountType: String(data.get('accountType') ?? ''),
          university: readUniversity(data),
        });
      }

      notify(
        mode === 'login'
          ? 'เข้าสู่ระบบแล้ว'
          : 'สร้างบัญชีเรียบร้อยแล้ว',
      );

      if (mode === 'login') {
        const destination =
          (location.state as { from?: string } | null)?.from || '/rooms';
        navigate(destination, { replace: true });
      }
    } catch (caught) {
      if (caught instanceof SessionChangedError) return;
      if (mode === 'login') {
        const feedback = loginFailure(caught);
        setError(feedback.message);
        setLoginAdvice(feedback.advice);
        setFocusErrors(true);
        return;
      }
      if (mode === 'register' && caught instanceof ApiError) {
        const errors = Object.fromEntries(Object.entries(caught.fieldErrors).filter(([name, message]) => isRegistrationField(name) && message));
        if (Object.keys(errors).length) {
          setFieldErrors(errors);
          setFocusErrors(true);
          return;
        }
      }
      setFocusErrors(true);
      setError(
        caught instanceof Error ? caught.message : 'ดำเนินการไม่สำเร็จ',
      );
    } finally {
      if (version === submissionVersion.current) setLoading(false);
    }
  };

  return (
    <main className="auth-page">
      <section className="auth-aside">
        <Link to="/login" className="auth-logo">
          <span><Building2 size={22} /></span>
          ROOMMATCH
        </Link>

        <div>
          <p>พื้นที่สำหรับนักศึกษา</p>
          <h1>
            {mode === 'login'
              ? 'หาห้องพัก และ Roommate ที่เข้ากันได้'
              : 'เริ่มต้นสร้าง RoomMatch Account ของคุณ'}
          </h1>
          <p className="auth-note">
            ค้นหาห้อง ส่งคำขอ และจัดการสมาชิก
          </p>
        </div>

        <small>University housing, made friendlier.</small>
      </section>

      <section className="auth-form-wrap">
        <div className="auth-form-card">
          <header>
            <span>
              {mode === 'login' ? 'Welcome back!' : 'Glad to meet you'}
            </span>
            <h2>{mode === 'login' ? 'เข้าสู่ระบบ' : 'สมัครสมาชิก'}</h2>
          </header>

          <form ref={formRef} onSubmit={submit} className={mode === 'register' ? 'register-form' : 'login-form'}
            noValidate
            onBlur={validateField}
            onChange={event => validateField(event, true)}>
            {mode === 'register' && (
              <>
                <div className="two-fields">
                  <Input
                    label="ชื่อ *"
                    name="firstName"
                    autoComplete="given-name"
                    error={fieldErrors.firstName}
                    required
                  />
                  <Input
                    label="นามสกุล *"
                    name="lastName"
                    autoComplete="family-name"
                    error={fieldErrors.lastName}
                    required
                  />
                </div>

                <Input
                  label="เบอร์โทรศัพท์ *"
                  name="phone"
                  type="tel"
                  inputMode="numeric"
                  maxLength={10}
                  onInput={event => {
                    event.currentTarget.value = event.currentTarget.value
                      .replace(/\D/g, '')
                      .slice(0, 10);
                  }}
                  autoComplete="tel"
                  error={fieldErrors.phone}
                  required
                />

                <div className="two-fields">
                  <label className="field">
                    <span className="field-label">เพศ</span>
                    <select name="gender" defaultValue="" aria-invalid={fieldErrors.gender ? true : undefined} aria-describedby={fieldErrors.gender ? 'registration-gender-error' : undefined}>
                      <option value="">ไม่ระบุ</option>
                      <option value="male">ชาย</option>
                      <option value="female">หญิง</option>
                      <option value="other">อื่น ๆ</option>
                    </select>
                    {fieldErrors.gender && <span id="registration-gender-error" className="field-error">{fieldErrors.gender}</span>}
                  </label>

                  <BirthDateInput required error={fieldErrors.dateOfBirth} />
                </div>

                <AccountProfileFields required accountType={accountType} errors={fieldErrors} onUniversitySelect={() => {
                  setFocusErrors(false);
                  setFieldErrors(({ university: _university, ...remaining }) => remaining);
                }} onAccountTypeChange={value => {
                  setAccountType(value);
                  setFocusErrors(false);
                  setFieldErrors(({ university: _university, ...remaining }) => remaining);
                }}/>
              </>
            )}

            <Input
              label={mode === 'register' ? 'อีเมล *' : 'อีเมล'}
              name="email"
              type="email"
              autoComplete="email"
              placeholder="name@example.com"
              error={fieldErrors.email}
              required
            />

            <label className="field">
              <span className="field-label">รหัสผ่าน{mode === 'register' && <> <span className="required-marker" aria-hidden="true">*</span></>}</span>
              <span className="password-field">
                <input
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={
                    mode === 'login' ? 'current-password' : 'new-password'
                  }
                  minLength={8}
                  aria-invalid={fieldErrors.password ? true : undefined}
                  aria-describedby={fieldErrors.password ? 'registration-password-error' : undefined}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(value => !value)}
                  aria-label={
                    showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'
                  }
                >
                  {showPassword
                    ? <EyeOff size={19} />
                    : <Eye size={19} />}
                </button>
              </span>
              {fieldErrors.password && <span id="registration-password-error" className="field-error">{fieldErrors.password}</span>}
            </label>

            {!fieldErrors.password && <p className="field-hint">รหัสผ่านอย่างน้อย 8 ตัวอักษร</p>}

            {error && (
              <div
                ref={summaryRef}
                tabIndex={-1}
                className="form-alert"
                role="alert"
              >
                {loginAdvice ? <><strong>{error}</strong><p>{loginAdvice}</p></> : error}
              </div>
            )}

            <Button className="w-full" loading={loading} onMouseDown={event => {
              // Validate on submit before a blur message can move the button under the pointer.
              if (event.button === 0) event.preventDefault();
            }}>
              {mode === 'login' ? 'เข้าสู่ระบบ' : 'สร้างบัญชี'}
            </Button>
          </form>

          <GoogleSignIn disabled={loading} returnTo={(location.state as { from?: string } | null)?.from} />

          <p className="auth-switch">
            {mode === 'login' ? 'ยังไม่มีบัญชี?' : 'มีบัญชีแล้ว?'}{' '}
            <Link
              to={mode === 'login' ? '/register' : '/login'}
              state={location.state}
            >
              {mode === 'login' ? 'สมัครสมาชิก' : 'เข้าสู่ระบบ'}
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}

export const LoginPage = () => <AuthShell mode="login" />;
export const RegisterPage = () => <AuthShell mode="register" />;
