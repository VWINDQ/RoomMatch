import { useState, type FormEvent } from 'react';
import { Building2, Eye, EyeOff } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../AppContext';
import { Button, Input } from '../components/UI';

function AuthShell({ mode }: { mode: 'login' | 'register' }) {
  const navigate = useNavigate(); const location = useLocation(); const { login, register, notify } = useApp();
  const [showPassword, setShowPassword] = useState(false); const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(''); setLoading(true); const data = new FormData(event.currentTarget);
    try {
      const email = String(data.get('email')).trim(); const password = String(data.get('password'));
      if (mode === 'login') await login(email, password);
      else await register({ firstName: String(data.get('firstName')).trim(), lastName: String(data.get('lastName')).trim(), email, password, phone: String(data.get('phone')).trim(), gender: String(data.get('gender')), dateOfBirth: String(data.get('dateOfBirth')), university: String(data.get('university')).trim() });
      notify(mode === 'login' ? 'เข้าสู่ระบบแล้ว' : 'สร้างบัญชีเรียบร้อยแล้ว');
      const destination = (location.state as { from?: string } | null)?.from || '/rooms'; navigate(destination, { replace: true });
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'ดำเนินการไม่สำเร็จ'); }
    finally { setLoading(false); }
  };
  return <main className="auth-page">
    <section className="auth-aside">
      <Link to="/login" className="auth-logo">
        <span><Building2 size={22} /></span>ROOMMATCH
      </Link>
      <div>
        <p>พื้นที่สำหรับนักศึกษา</p>
        <h1>{mode === 'login' ? 'หาห้อง และเจอเพื่อนร่วมห้องที่เข้ากันได้' : 'เริ่มต้นสร้าง RoomMatch Account ของคุณ'}</h1>
        <p className="auth-note">ค้นหาห้อง ส่งคำขอ และจัดการสมาชิก</p>
      </div>
      <small>University housing, made friendlier.</small>
    </section>
    <section className="auth-form-wrap">
      <div className="auth-form-card">
        <header>
          <span>{mode === 'login' ? 'Welcome back!' : 'Grace to meet you'}</span>
          <h2>{mode === 'login' ? 'เข้าสู่ระบบ' : 'สมัครสมาชิก'}</h2></header>
      <form onSubmit={submit}>{mode === 'register' && <><div className="two-fields"><Input label="ชื่อ" name="firstName" autoComplete="given-name" required/><Input label="นามสกุล" name="lastName" autoComplete="family-name" required/></div><Input label="เบอร์โทรศัพท์" name="phone" type="tel" inputMode="numeric" maxLength={10} onInput={event => { event.currentTarget.value = event.currentTarget.value.replace(/\D/g, '').slice(0, 10); }} autoComplete="tel" required/><div className="two-fields"><label className="field"><span className="field-label">เพศ</span><select name="gender" defaultValue=""><option value="">ไม่ระบุ</option><option value="male">ชาย</option><option value="female">หญิง</option><option value="other">อื่น ๆ</option></select></label><Input label="วันเกิด" name="dateOfBirth" type="date"/></div><Input label="มหาวิทยาลัย" name="university" defaultValue="มหาวิทยาลัยเทคโนโลยีพระจอมเกล้าธนบุรี"/></>}
        <Input label="อีเมล" name="email" type="email" autoComplete="email" placeholder="name@mail.kmutt.ac.th" required/>
        <label className="field"><span className="field-label">รหัสผ่าน</span><span className="password-field"><input name="password" type={showPassword ? 'text' : 'password'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={8} required/><button type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}>{showPassword ? <EyeOff size={19}/> : <Eye size={19}/>}</button></span></label>
        {error && <p className="form-alert" role="alert">{error}</p>}<Button className="w-full" loading={loading}>{mode === 'login' ? 'เข้าสู่ระบบ' : 'สร้างบัญชี'}</Button>
      </form><p className="auth-switch">{mode === 'login' ? 'ยังไม่มีบัญชี?' : 'มีบัญชีแล้ว?'} <Link to={mode === 'login' ? '/register' : '/login'}>{mode === 'login' ? 'สมัครสมาชิก' : 'เข้าสู่ระบบ'}</Link></p>
    </div></section>
  </main>;
}

export const LoginPage = () => <AuthShell mode="login"/>;
export const RegisterPage = () => <AuthShell mode="register"/>;
