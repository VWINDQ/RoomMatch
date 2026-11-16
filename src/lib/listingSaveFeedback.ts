import { ApiError } from './api';

export function listingSaveFeedback(caught: unknown, stage: 'upload' | 'save', listingFields: string[]): Record<string, string> {
  if (caught instanceof ApiError) {
    const fields = Object.fromEntries(Object.entries(caught.fieldErrors).filter(([field]) => listingFields.includes(field)));
    if (Object.keys(fields).length) return fields;
  }
  const action = stage === 'upload' ? 'อัปโหลดรูปไม่สำเร็จ' : 'บันทึกประกาศไม่สำเร็จ';
  let message = `${action} กรุณาลองอีกครั้ง`;
  if (caught instanceof ApiError && caught.networkError) {
    message = `${action} กรุณาตรวจสอบการเชื่อมต่อแล้วลองอีกครั้ง`;
  } else if (caught instanceof ApiError && caught.status >= 400 && caught.status < 500) {
    // The API adapter has already translated these into safe, actionable messages.
    message = caught.message;
  }
  return { [stage === 'upload' ? 'images' : 'form']: message };
}
