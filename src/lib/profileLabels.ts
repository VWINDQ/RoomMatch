const genderLabels = new Map([
  ['male', 'ชาย'], ['female', 'หญิง'], ['non_binary', 'นอนไบนารี'], ['other', 'อื่น ๆ'], ['any', 'ไม่จำกัด'],
]);

export function genderLabel(value?: string) {
  return genderLabels.get(value || '') || 'ยังไม่ระบุ';
}
