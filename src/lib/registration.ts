import { readUniversity } from '../components/UniversityPicker';
import { parseBirthDate } from './birthDate';
import { validateAccountProfile } from '../../shared/accountProfile.js';
import { registrationNameError, registrationNameFields } from '../../shared/registrationNames.js';

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

export function isRegistrationField(name: string): name is RegistrationField {
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

export function validateRegistration(data: FormData, google = false) {
  const errors: Record<string, string> = {};
  for (const name of Object.keys(registrationFields).filter(isRegistrationField)) {
    if (name === 'accountType' || name === 'university' || (google && (name === 'email' || name === 'password'))) continue;
    const message = registrationFieldError(name, String(data.get(name) ?? ''));
    if (message) errors[name] = message;
  }
  return { ...errors, ...validateAccountProfile(data.get('accountType'), readUniversity(data)) };
}

export function registrationFieldFeedback(field: HTMLInputElement | HTMLSelectElement, form: HTMLFormElement, accountType: string, errors: Record<string, string>, onlyInvalid: boolean) {
  if (field.name === 'universityQuery' && (onlyInvalid || field.form?.elements.namedItem('university'))) return;
  const name = field.name === 'universityQuery' ? 'university' : field.name;
  if (!isRegistrationField(name) || (onlyInvalid && !errors[name])) return;
  const message = name === 'accountType' || name === 'university'
    ? validateAccountProfile(name === 'accountType' ? field.value : accountType, readUniversity(new FormData(form)))[name] || ''
    : registrationFieldError(name, field.value);
  if (!onlyInvalid && !message) return;
  return { name, message };
}

export type RegistrationProfile = {
  firstName: string; lastName: string; phone: string; gender?: string; dateOfBirth: string;
  accountType: string; university?: string;
};

export function readRegistrationProfile(data: FormData): RegistrationProfile {
  return {
    firstName: String(data.get('firstName') ?? '').trim(),
    lastName: String(data.get('lastName') ?? '').trim(),
    phone: String(data.get('phone') ?? '').trim(),
    gender: String(data.get('gender') ?? ''),
    dateOfBirth: parseBirthDate(String(data.get('dateOfBirth') ?? '')),
    accountType: String(data.get('accountType') ?? ''),
    university: readUniversity(data),
  };
}
