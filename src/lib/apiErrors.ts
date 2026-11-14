const messages: Record<string, string> = {
  'Invalid email or password': 'อีเมลหรือรหัสผ่านไม่ถูกต้อง',
  'Email is already registered': 'อีเมลนี้มีบัญชีแล้ว กรุณาเข้าสู่ระบบหรือใช้อีเมลอื่น',
  'Authentication required': 'กรุณาเข้าสู่ระบบอีกครั้ง',
  'Invalid or expired authentication token': 'การเข้าสู่ระบบหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง',
  'password must be at least 8 characters': 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร',
  'email must be valid': 'กรุณากรอกอีเมลให้ถูกต้อง',
  'This room has no available place': 'ห้องนี้ไม่มีที่ว่างแล้ว กรุณาเลือกห้องอื่น',
  'This room has reached capacity': 'ห้องเต็มแล้ว กรุณาตรวจสอบรายการล่าสุด',
  'A pending request already exists': 'คุณส่งคำขอห้องนี้ไว้แล้ว ดูสถานะได้ที่คำขอที่ฉันส่ง',
  'This request has already been handled': 'คำขอนี้ถูกจัดการแล้ว กรุณาโหลดรายการล่าสุด',
  'Only a pending request can be withdrawn': 'ถอนคำขอได้เฉพาะรายการที่ยังรอเจ้าของห้องพิจารณา',
  'Accepted friendship is required': 'ต้องตอบรับเป็นเพื่อนกันก่อน กรุณากลับไปตรวจสอบคำชวน',
  'Inactive rooms cannot accept requests': 'ประกาศนี้พักรับคำขอแล้ว',
  'Request not found': 'ไม่พบคำขอนี้ กรุณาโหลดรายการล่าสุด',
  'Room not found': 'ไม่พบประกาศห้องนี้',
};
const fields: Record<string,string> = { firstName: 'ชื่อ', lastName: 'นามสกุล', phone: 'เบอร์โทรศัพท์', email: 'อีเมล', password: 'รหัสผ่าน', title: 'หัวข้อประกาศ', description: 'รายละเอียด', bio: 'คำแนะนำตัว', lifestyleName: 'ไลฟ์สไตล์', locality: 'ย่านหรือทำเล', costNotes: 'ค่าใช้จ่ายเพิ่มเติม', price: 'ราคา', capacity: 'จำนวนผู้พัก' };

export function friendlyApiError(message: string, status: number) {
  if (messages[message]) return messages[message];
  if (/[ก-๙]/.test(message)) return message;
  const fieldError = /^(\w+) (is required|is too long|must be a non-negative integer)$/.exec(message);
  if (fieldError && fields[fieldError[1]]) return fieldError[2] === 'is required' ? `กรุณากรอก${fields[fieldError[1]]}` : fieldError[2] === 'is too long' ? `${fields[fieldError[1]]}ยาวเกินกำหนด กรุณาย่อข้อความ` : `${fields[fieldError[1]]}ต้องเป็นจำนวนเต็มตั้งแต่ 0`;
  if (status === 401) return 'กรุณาเข้าสู่ระบบอีกครั้ง';
  if (status === 403) return 'บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้';
  if (status === 404) return 'ไม่พบข้อมูลนี้ กรุณากลับไปตรวจสอบรายการ';
  if (status === 409) return 'ข้อมูลหรือที่ว่างเปลี่ยนไปแล้ว กรุณาโหลดรายการล่าสุดแล้วลองอีกครั้ง';
  if (status >= 500) return 'ระบบขัดข้องชั่วคราว กรุณาลองอีกครั้ง';
  return 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบช่องที่กรอกแล้วลองอีกครั้ง';
}
