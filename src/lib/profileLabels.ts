const genderLabels = new Map([
  ['male', 'ชาย'], ['female', 'หญิง'], ['non_binary', 'นอนไบนารี'], ['other', 'อื่น ๆ'], ['any', 'ไม่จำกัด'],
]);

export function genderLabel(value?: string) {
  return genderLabels.get(value || '') || 'ยังไม่ระบุ';
}

export function ageRange(minimum?: number | null, maximum?: number | null, empty = 'ยังไม่ระบุ') {
  if (minimum == null && maximum == null) return empty;
  if (minimum == null) return `ไม่เกิน ${maximum} ปี`;
  if (maximum == null) return `ตั้งแต่ ${minimum} ปี`;
  return `${minimum}–${maximum} ปี`;
}
export function roommateGenderLabel(value?: string) {
  return value === 'any' ? 'สะดวกแชร์ห้องได้ทุกเพศ' : genderLabel(value);
}
