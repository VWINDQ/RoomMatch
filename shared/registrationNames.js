export const registrationNameFields = {
  firstName: { label: 'ชื่อ', max: 100, required: true },
  lastName: { label: 'นามสกุล', max: 100, required: true },
};

export function registrationNameError(field, raw) {
  const value = typeof raw === 'string' ? raw.trim() : '';
  const { label, max } = registrationNameFields[field];
  if (!value) return `กรุณากรอก${label}`;
  return value.length > max ? `${label}ต้องไม่เกิน ${max} ตัวอักษร` : '';
}
