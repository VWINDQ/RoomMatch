export const accountTypes = {
  student: 'นักศึกษา',
  general: 'ผู้ใช้ทั่วไป',
};

export function validateAccountProfile(accountType, university) {
  if (typeof accountType !== 'string' || !Object.hasOwn(accountTypes, accountType)) {
    return { accountType: accountType ? 'กรุณาเลือกสถานะผู้ใช้ให้ถูกต้อง' : 'กรุณาเลือกสถานะผู้ใช้' };
  }
  if (accountType !== 'student') return {};
  if (typeof university !== 'string' || !university.trim()) return { university: 'กรุณาเลือกหรือกรอกชื่อมหาวิทยาลัย' };
  return university.trim().length > 255 ? { university: 'ชื่อมหาวิทยาลัยต้องไม่เกิน 255 ตัวอักษร' } : {};
}
