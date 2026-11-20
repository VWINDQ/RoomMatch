import { Skeleton } from '../components/Skeleton';
import { AtSign, HeartHandshake, LogOut, Mail, MessageCircle, Pencil, Phone, RefreshCw, UserRound } from 'lucide-react';
import { useEffect, useRef, useState, type FocusEvent, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../AppContext';
import { PageHeader } from '../components/Layout';
import { ProfilePhoto } from '../components/ProfilePhoto';
import { Button, EmptyState, Input, Modal, Textarea } from '../components/UI';
import { api, ApiError, SessionChangedError } from '../lib/api';
import { FormFeedback, useFormFeedback } from '../components/FormFeedback';
import { ImagePicker, savedImages, uploadSelectedImages, type SelectedImage } from '../components/ImagePicker';
import { calculateAge } from '../lib/age';
import type { ProfileBundle } from '../types';
import { BirthDateInput } from '../components/BirthDateInput';
import { formatBirthDate, parseBirthDate } from '../lib/birthDate';
import { useFormLeaveGuard } from '../lib/useFormLeaveGuard';
import { AccountProfileFields } from '../components/AccountProfileFields';
import { readUniversity } from '../components/UniversityPicker';
import { validateAccountProfile } from '../../shared/accountProfile.js';
import './ProfilePage.css';

function profileFieldError(name: string, value: string) {
  if (name === 'firstName') return value.trim() ? '' : 'กรุณากรอกชื่อ';
  if (name === 'lastName') return value.trim() ? '' : 'กรุณากรอกนามสกุล';
  if (name === 'phone') return !value.trim() ? 'กรุณากรอกเบอร์โทรศัพท์' : /^\d{10}$/.test(value.trim()) ? '' : 'กรอกเบอร์โทรศัพท์เป็นตัวเลข 10 หลัก';
  if (name === 'lifestyleName') return value.trim() ? '' : 'กรุณาระบุไลฟ์สไตล์ของคุณก่อนบันทึก';
  if (name === 'dateOfBirth') {
    if (!value.trim()) return 'กรุณากรอกวันเกิด';
    try { parseBirthDate(value); }
    catch (error) { return error instanceof Error ? error.message : 'กรุณากรอกวันเกิดให้ถูกต้อง'; }
  }
  return '';
}

export function ProfilePage() {
  const navigate = useNavigate(); const { refreshUser, notify, logout, registerLogoutGuard } = useApp(); const [profile, setProfile] = useState<ProfileBundle | null>(null); const [editing, setEditing] = useState(false); const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [error, setError] = useState(''); const [errors, setErrors] = useState<Record<string, string>>({}); const [reload, setReload] = useState(0);
  const [images, setImages] = useState<SelectedImage[]>([]);
  const [checkingImages, setCheckingImages] = useState(false);
  const [accountType, setAccountType] = useState('');
  const [clearedUniversity, setClearedUniversity] = useState(false);
  const [focusErrors, setFocusErrors] = useState(true);
  const formRef = useRef<HTMLFormElement>(null);
  const submitLocked = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const { blocker, hasChanges, markSaved, resetBlocker, proceed } = useFormLeaveGuard(formRef, images, saving || checkingImages, editing, profile);
  const [localLeave, setLocalLeave] = useState<'cancel' | 'logout' | null>(null);
  const saveBeforeLeave = useRef(false);
  useEffect(() => {
    if (!editing) return;
    return registerLogoutGuard(() => {
      if (!hasChanges()) return false;
      setLocalLeave('logout');
      return true;
    });
  }, [editing, hasChanges, registerLogoutGuard]);
  const cancelLeave = () => {
    saveBeforeLeave.current = false;
    setLocalLeave(null);
    resetBlocker();
  };
  const finishLeave = () => {
    saveBeforeLeave.current = false;
    setLocalLeave(null);
    if (localLeave === null) {
      proceed();
      return;
    }
    markSaved();
    if (localLeave === 'logout' && logout()) navigate('/login');
  };
  const leaving = blocker.state === 'blocked' || localLeave !== null;
  const summaryRef = useFormFeedback(errors, formRef, !leaving && focusErrors);
  useEffect(() => { let active = true; setLoading(true); setError(''); api.profile().then(value => { if (active) { setProfile(value); setAccountType(value.user.accountType || ''); setImages(savedImages([value.user.profileImage])); if (value.user.profileSetupPending) setEditing(true); } }).catch(caught => active && setError(caught instanceof Error ? caught.message : 'โหลดโปรไฟล์ไม่สำเร็จ')).finally(() => active && setLoading(false)); return () => { active = false; }; }, [reload]);
  const validateProfileField = (event: FocusEvent<HTMLFormElement> | FormEvent<HTMLFormElement>, onlyInvalid = false) => {
    const field = event.target;
    if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement) || !field.name) return;
    if (field.name === 'universityQuery' && (onlyInvalid || field.form?.elements.namedItem('university'))) return;
    const name = field.name === 'universityQuery' ? 'university' : field.name;
    const accountField = name === 'accountType' || name === 'university';
    const setup = profile?.user.profileSetupPending;
    if (onlyInvalid && !errors[name]) return;
    if (accountField ? !setup && !profile?.user.accountType && !accountType : !['firstName', 'lastName', 'phone', 'dateOfBirth', 'lifestyleName'].includes(name)) return;
    const accountErrors = accountField ? validateAccountProfile(name === 'accountType' ? field.value : accountType, readUniversity(new FormData(event.currentTarget))) : {};
    const optionalBlank = (name === 'dateOfBirth' && !setup) || (name === 'lifestyleName' && !profile?.lifestyle);
    const message = accountField ? accountErrors[name] : optionalBlank && !field.value.trim() ? '' : profileFieldError(name, field.value);
    if (!message && !errors[name]) return;
    setFocusErrors(false);
    setErrors(current => {
      const next = { ...current };
      if (message) next[name] = message;
      else delete next[name];
      return next;
    });
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!profile || checkingImages || submitLocked.current) return; const data = new FormData(event.currentTarget); const required = ['firstName', 'lastName', 'phone'] as const; const nextErrors: Record<string, string> = {}; required.forEach(name => { if (!String(data.get(name)).trim()) nextErrors[name] = 'กรุณากรอกข้อมูลนี้'; });
    const phone = String(data.get('phone') ?? '').trim();
    if (phone && !/^\d{10}$/.test(phone)) nextErrors.phone = 'กรอกเบอร์โทรศัพท์เป็นตัวเลข 10 หลัก';
    let dateOfBirth = '';
    try { dateOfBirth = parseBirthDate(String(data.get('dateOfBirth') ?? '')); }
    catch (caught) { nextErrors.dateOfBirth = caught instanceof Error ? caught.message : 'วันเกิดไม่ถูกต้อง'; }
    if (profile.user.profileSetupPending) {
      for (const name of ['firstName', 'lastName', 'phone', 'dateOfBirth']) {
        const message = profileFieldError(name, String(data.get(name) ?? ''));
        if (message) nextErrors[name] = message;
      }
    }
    if (profile.user.profileSetupPending || profile.user.accountType || accountType) {
      Object.assign(nextErrors, validateAccountProfile(accountType, readUniversity(data)));
    }
    const ageMinRaw = String(data.get('preferredAgeMin') || ''); const ageMaxRaw = String(data.get('preferredAgeMax') || ''); const budgetMinRaw = String(data.get('budgetMin') || ''); const budgetMaxRaw = String(data.get('budgetMax') || '');
    const ageMin = Number(ageMinRaw || 0); const ageMax = Number(ageMaxRaw || 0); const budgetMin = Number(budgetMinRaw || 0); const budgetMax = Number(budgetMaxRaw || 0);
    if (ageMinRaw && (!Number.isInteger(ageMin) || ageMin < 18 || ageMin > 120)) nextErrors.preferredAgeMin = 'กรอกอายุ 18–120 ปี'; if (ageMaxRaw && (!Number.isInteger(ageMax) || ageMax < 18 || ageMax > 120)) nextErrors.preferredAgeMax = 'กรอกอายุ 18–120 ปี'; if (ageMin && ageMax && ageMin > ageMax) nextErrors.preferredAgeMax = 'อายุสูงสุดต้องไม่น้อยกว่าอายุต่ำสุด';
    const lifestyleName = String(data.get('lifestyleName') || '').trim();
    if (lifestyle && !lifestyleName) nextErrors.lifestyleName = 'กรุณาระบุไลฟ์สไตล์ของคุณก่อนบันทึก';
    for (const [name, raw, amount] of [['budgetMin', budgetMinRaw, budgetMin], ['budgetMax', budgetMaxRaw, budgetMax]] as const) {
      if (raw && (!Number.isSafeInteger(amount) || amount < 0)) nextErrors[name] = 'กรอกงบประมาณเป็นจำนวนเต็มตั้งแต่ 0 บาท';
    }
    if (budgetMinRaw && budgetMaxRaw && budgetMin > budgetMax) nextErrors.budgetMax = 'งบสูงสุดต้องไม่น้อยกว่างบต่ำสุด';
    setFocusErrors(true);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) { cancelLeave(); return; }
    submitLocked.current = true;
    setSaving(true); try {
      const imageUrls = await uploadSelectedImages(images, uploaded => setImages(current => current.map(image => image.id === uploaded.id ? uploaded : image)));
      if (!mounted.current) return;
      const profileImage = imageUrls[0]?.trim() || '';
      const updated = await api.updateProfile({ firstName: String(data.get('firstName')).trim(), lastName: String(data.get('lastName')).trim(), phone, gender: String(data.get('gender')), dateOfBirth, university: readUniversity(data), ...(accountType ? { accountType } : {}), profileImage, bio: String(data.get('bio')).trim(), instagram: String(data.get('instagram')).trim(), lineId: String(data.get('lineId')).trim(), ...(lifestyleName ? { lifestyleName } : {}), preference: { preferredGender: String(data.get('preferredGender')), preferredAgeMin: ageMinRaw ? ageMin : null, preferredAgeMax: ageMaxRaw ? ageMax : null, budgetMin: budgetMinRaw ? budgetMin : null, budgetMax: budgetMaxRaw ? budgetMax : null } });
      if (!mounted.current) return;
      await refreshUser(updated.user);
      if (!mounted.current) return;
      setProfile(updated); setImages(savedImages([updated.user.profileImage])); setEditing(false); notify('บันทึกข้อมูลเรียบร้อยแล้ว');
      setClearedUniversity(false);
      if (saveBeforeLeave.current) finishLeave();
      else { setLocalLeave(null); markSaved(); }
    } catch (caught) {
      if (!mounted.current || caught instanceof SessionChangedError) return;
      cancelLeave();
      setErrors({ ...(caught instanceof ApiError ? caught.fieldErrors : {}), form: caught instanceof Error ? caught.message : 'บันทึกข้อมูลไม่สำเร็จ' });
    } finally { submitLocked.current = false; if (mounted.current) setSaving(false); }
  };
  if (loading) return <div className="page"><Skeleton variant="profile"/></div>;
  if (error || !profile) return <div className="page"><EmptyState icon={<RefreshCw/>} title="โหลดโปรไฟล์ไม่สำเร็จ" text={error} action={<Button onClick={() => setReload(value => value + 1)}>ลองอีกครั้ง</Button>}/></div>;
  const { user, lifestyle, preference } = profile; const initials = `${user.firstName.charAt(0)}${user.lastName.charAt(0)}` || 'R';
  const discardEdits = () => {
    setEditing(false);
    setAccountType(user.accountType || '');
    setClearedUniversity(false);
    setImages(savedImages([user.profileImage]));
    setErrors({});
  };
  const leaveDestination = localLeave === 'cancel' ? 'กลับไปดูโปรไฟล์' : localLeave === 'logout' ? 'ออกจากระบบ' : 'ไปหน้าที่เลือก';
  const age = calculateAge(user.dateOfBirth);
  return <div className="page profile-page"><PageHeader title="โปรไฟล์ของฉัน" subtitle={user.profileSetupPending ? 'กรอกข้อมูลให้ครบเพื่อเริ่มใช้งาน RoomMatch' : 'ข้อมูลส่วนตัว ไลฟ์สไตล์ ความต้องการ และช่องทางการติดต่อของคุณ'}/>
    <section className="profile-summary"><div className="profile-avatar"><ProfilePhoto src={user.profileImage} fallback={initials}/></div><div className="profile-identity"><div><h2>{user.firstName} {user.lastName}</h2><span>{user.university || (user.accountType === 'general' ? 'ผู้ใช้ทั่วไป' : 'สมาชิก RoomMatch')}</span></div><p><Mail size={16}/>{user.email}</p></div>{!editing && <Button variant="secondary" onClick={() => setEditing(true)}><Pencil size={17}/>แก้ไขโปรไฟล์</Button>}</section>
    {!editing ? <div className="profile-section-grid api-profile-view"><ProfileCard icon={<UserRound/>} title="ข้อมูลส่วนตัว"><dl className="profile-data-list profile-personal-data"><div><dt>เบอร์โทร</dt><dd><Phone size={16}/>{user.phone}</dd></div><div><dt>เพศ</dt><dd>{genderLabel(user.gender)}</dd></div><div className="profile-half-field"><dt>วันเกิด</dt><dd>{formatBirthDate(user.dateOfBirth) || 'ยังไม่ระบุ'}</dd></div><div className="profile-half-field"><dt>อายุ</dt><dd>{age === null ? 'กรอกวันเกิดในโปรไฟล์เพื่อคำนวณอายุ' : `${age} ปี`}</dd></div><div><dt>เกี่ยวกับฉัน</dt><dd>{user.bio || 'ยังไม่ได้เขียนแนะนำตัว'}</dd></div></dl></ProfileCard>
      <ProfileCard icon={<HeartHandshake/>} title="ไลฟ์สไตล์และความต้องการ"><dl className="profile-data-list"><div><dt>ไลฟ์สไตล์</dt><dd>{lifestyle?.lifestyleName || 'ยังไม่ระบุ'}</dd></div><div><dt>เพศที่สะดวกแชร์ห้อง</dt><dd>{genderLabel(preference?.preferredGender)}</dd></div><div><dt>ช่วงอายุ</dt><dd>{ageRange(preference?.preferredAgeMin, preference?.preferredAgeMax)}</dd></div><div><dt>งบประมาณ</dt><dd>{budgetRange(preference?.budgetMin, preference?.budgetMax)}</dd></div></dl></ProfileCard>
      <ProfileCard icon={<MessageCircle/>} title="ช่องทางติดต่อ"><div className="profile-contact-list"><Contact icon={<MessageCircle/>} label="LINE" value={user.lineId}/><Contact icon={<AtSign/>} label="Instagram" value={user.instagram}/><Contact icon={<Mail/>} label="อีเมลบัญชี" value={user.email}/></div></ProfileCard></div>
    : <form ref={formRef} className="profile-editor" onSubmit={submit} noValidate aria-busy={saving}
      onBlur={validateProfileField} onChange={event => validateProfileField(event, true)}><fieldset className="image-upload-fields" disabled={saving}>
      <p className="field-hint"><span className="required-marker" aria-hidden="true">*</span> หมายถึงข้อมูลจำเป็น ช่องอื่นเว้นว่างได้</p>
      <section className="form-section"><header><span>1</span><div><h2>ข้อมูลส่วนตัว</h2><p>ข้อมูลพื้นฐานและคำแนะนำตัว</p></div></header><div className="form-section-body">
        <div className="two-fields"><Input label="ชื่อ *" name="firstName" required maxLength={100} defaultValue={user.firstName} error={errors.firstName}/><Input label="นามสกุล *" name="lastName" required maxLength={100} defaultValue={user.lastName} error={errors.lastName}/></div>
        <Input label="เบอร์โทรศัพท์ *" name="phone" required type="tel" inputMode="numeric" maxLength={10} onInput={event => { event.currentTarget.value = event.currentTarget.value.replace(/\D/g, '').slice(0, 10); }} defaultValue={user.phone} error={errors.phone}/>
        <div className="two-fields"><label className="field"><span className="field-label">เพศ</span><select name="gender" defaultValue={user.gender}><option value="">ไม่ระบุ</option><option value="male">ชาย</option><option value="female">หญิง</option><option value="non_binary">นอนไบนารี</option><option value="other">อื่น ๆ</option></select></label><BirthDateInput defaultValue={user.dateOfBirth} required={user.profileSetupPending} error={errors.dateOfBirth}/></div>
        <AccountProfileFields required={Boolean(user.profileSetupPending || user.accountType || accountType)} accountType={accountType}
          university={clearedUniversity ? '' : user.university} errors={errors} onUniversitySelect={() => {
            setFocusErrors(false);
            setErrors(({ university: _university, ...remaining }) => remaining);
          }} onAccountTypeChange={value => {
            setAccountType(value);
            if (value === 'general') setClearedUniversity(true);
            setFocusErrors(false);
            setErrors(({ university: _university, ...remaining }) => remaining);
          }}/>
        <ImagePicker label="รูปโปรไฟล์" images={images} onCheckingChange={setCheckingImages} onChange={setImages} disabled={saving} error={errors.profileImage} fieldName="profileImage"/>
        <Textarea label="เกี่ยวกับฉัน" name="bio" maxLength={1000} rows={4} defaultValue={user.bio}/>
      </div></section>
      <section className="form-section"><header><span>2</span><div><h2>ไลฟ์สไตล์และความต้องการ</h2><p>ช่วยให้การจับคู่มีบริบทที่ชัดเจนขึ้น</p></div></header><div className="form-section-body"><Input label={lifestyle ? 'ไลฟ์สไตล์ *' : 'ไลฟ์สไตล์'} name="lifestyleName" required={Boolean(lifestyle)} error={errors.lifestyleName} maxLength={400} defaultValue={lifestyle?.lifestyleName} placeholder="เช่น ตื่นเช้า • ไม่สูบบุหรี่ • ชอบห้องเงียบ"/><label className="field"><span className="field-label">เพศที่สะดวกแชร์ห้อง</span><select name="preferredGender" defaultValue={preference?.preferredGender || 'any'}><option value="any">ไม่จำกัด</option><option value="male">ชาย</option><option value="female">หญิง</option><option value="non_binary">นอนไบนารี</option><option value="other">อื่น ๆ</option></select></label><div className="two-fields"><Input label="อายุต่ำสุด" name="preferredAgeMin" type="number" min={18} max={120} defaultValue={preference?.preferredAgeMin ?? ''} error={errors.preferredAgeMin}/><Input label="อายุสูงสุด" name="preferredAgeMax" type="number" min={18} max={120} defaultValue={preference?.preferredAgeMax ?? ''} error={errors.preferredAgeMax}/><Input label="งบต่ำสุด" name="budgetMin" type="number" min={0} defaultValue={preference?.budgetMin ?? ''} error={errors.budgetMin}/><Input label="งบสูงสุด" name="budgetMax" type="number" min={0} defaultValue={preference?.budgetMax ?? ''} error={errors.budgetMax}/></div></div></section>
      <section className="form-section"><header><span>3</span><div><h2>ช่องทางติดต่อ</h2><p>แชร์หลังจับคู่เพื่อคุยรายละเอียดกันต่อ</p></div></header><div className="form-section-body"><Input label="LINE ID" name="lineId" defaultValue={user.lineId}/><Input label="Instagram" name="instagram" defaultValue={user.instagram}/></div></section>
      <footer className="profile-actions"><FormFeedback errors={errors} summaryRef={summaryRef}/><div className="form-action-buttons">{!user.profileSetupPending && <Button type="button" variant="quiet" onClick={() => {
        if (hasChanges()) { setLocalLeave('cancel'); return; }
        markSaved(); discardEdits();
      }}>ยกเลิก</Button>}<Button disabled={checkingImages} loading={saving} onMouseDown={event => { if (event.button === 0) event.preventDefault(); }}>{saving ? (images.some(image => image.file) ? 'กำลังอัปโหลดรูป…' : 'กำลังบันทึก…') : 'บันทึกการเปลี่ยนแปลง'}</Button></div></footer>
    </fieldset></form>}
    <footer className="profile-sign-out"><Button variant="quiet" disabled={saving} onClick={() => { if (logout()) navigate('/login'); }}><LogOut size={18} aria-hidden="true"/>ออกจากระบบ</Button></footer>
    {leaving && <Modal className="form-leave-modal" title="ยังไม่ได้บันทึกการแก้ไขโปรไฟล์" onClose={cancelLeave} actions={<>
      <Button type="button" variant="secondary" disabled={saving || checkingImages} onClick={() => {
        discardEdits(); finishLeave();
      }}>ยกเลิกการแก้ไข</Button>
      <Button type="button" disabled={checkingImages} loading={saving} onClick={() => {
        if (submitLocked.current || checkingImages) return;
        saveBeforeLeave.current = true;
        formRef.current?.requestSubmit();
      }}>บันทึกและไปต่อ</Button>
    </>}>
      <p>คุณมีข้อมูลโปรไฟล์ที่ยังไม่ได้บันทึก ต้องการยกเลิกการแก้ไข หรือบันทึกก่อน{leaveDestination}?</p>
      <p>ปิดหน้าต่างนี้เพื่อกลับไปแก้ไขต่อ</p>
      {(saving || checkingImages) && <p role="status">{checkingImages ? 'กำลังตรวจไฟล์ภาพ…' : 'กำลังบันทึกข้อมูล กรุณารอสักครู่…'}</p>}
    </Modal>}
  </div>;
}

function ProfileCard({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) { return <section className="profile-info-card"><header><span>{icon}</span><div><h2>{title}</h2></div></header>{children}</section>; }
function Contact({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) { return <div className="profile-contact-item"><span>{icon}</span><div><small>{label}</small><strong className={value ? '' : 'empty-value'}>{value || 'ยังไม่ระบุ'}</strong></div></div>; }
function genderLabel(value?: string) { return ({ male: 'ชาย', female: 'หญิง', non_binary: 'นอนไบนารี', other: 'อื่น ๆ', any: 'ไม่จำกัด' }[value || ''] || 'ยังไม่ระบุ'); }

function ageRange(minimum?: number | null, maximum?: number | null) {
  if (minimum == null && maximum == null) return 'ยังไม่ระบุช่วงอายุ';
  if (minimum == null) return `ไม่เกิน ${maximum} ปี`;
  if (maximum == null) return `ตั้งแต่ ${minimum} ปี`;
  return `${minimum}–${maximum} ปี`;
}
function budgetRange(minimum?: number | null, maximum?: number | null) {
  if (minimum == null && maximum == null) return 'ยังไม่ระบุงบประมาณ';
  if (minimum == null) return `ไม่เกิน ฿${maximum!.toLocaleString('th-TH')} / เดือน`;
  if (maximum == null) return `ตั้งแต่ ฿${minimum.toLocaleString('th-TH')} / เดือน`;
  return `฿${minimum.toLocaleString('th-TH')}–฿${maximum.toLocaleString('th-TH')} / เดือน`;
}
