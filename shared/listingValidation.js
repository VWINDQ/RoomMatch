// Shared by the browser and API; partial validation checks only supplied fields.
export function validateListing(body, { partial = false, minimumCapacity = 1 } = {}) {
  const errors = {};
  const textFields = {
    title: ['หัวข้อประกาศ', 200, true],
    description: ['รายละเอียดห้อง', 5000, false],
    googleMapsUrl: ['ลิงก์แผนที่', 2048, true],
    locality: ['ย่านหรือถนน', 200, true],
    costNotes: ['ค่าใช้จ่ายเพิ่มเติม', 1000, false],
  };
  for (const [field, [label, max, required]] of Object.entries(textFields)) {
    if (partial && !Object.hasOwn(body, field)) continue;
    const value = body[field];
    if (value == null || value === '') {
      if (required) errors[field] = `กรุณากรอก${label}`;
      continue;
    }
    if (typeof value !== 'string') { errors[field] = `${label}ต้องเป็นข้อความ`; continue; }
    const trimmed = value.trim();
    if (required && !trimmed) errors[field] = `กรุณากรอก${label}`;
    else if (trimmed.length > max) errors[field] = `${label}ต้องไม่เกิน ${max} ตัวอักษร`;
    else if (field === 'googleMapsUrl' && !isWebUrl(trimmed)) errors[field] = 'กรุณากรอก URL แผนที่ให้สมบูรณ์ เช่น https://maps.google.com/';
  }
  for (const field of ['price', 'capacity']) {
    if (partial && !Object.hasOwn(body, field)) continue;
    const raw = body[field];
    const present = (typeof raw === 'string' && raw.trim() !== '') || typeof raw === 'number';
    if (raw == null || (typeof raw === 'string' && !raw.trim())) {
      errors[field] = field === 'price' ? 'กรุณากรอกราคา' : 'กรุณากรอกจำนวนผู้พักรวมเจ้าของ';
      continue;
    }
    const value = present ? Number(raw) : NaN;
    if (field === 'price' && (!Number.isSafeInteger(value) || value <= 0)) errors.price = 'กรุณากรอกราคาเป็นจำนวนเต็มมากกว่า 0 บาท';
    if (field === 'capacity') {
      if (!Number.isInteger(value) || value < 1 || value > 100) errors.capacity = 'จำนวนผู้พักรวมเจ้าของต้องเป็นจำนวนเต็มตั้งแต่ 1 ถึง 100 คน';
      else if (value < minimumCapacity) errors.capacity = `จำนวนผู้พักต้องไม่น้อยกว่า ${minimumCapacity} คน (รวมเจ้าของและสมาชิกปัจจุบัน)`;
    }
  }
  if ((!partial || Object.hasOwn(body, 'priceBasis')) && !['per_room', 'per_person'].includes(body.priceBasis)) errors.priceBasis = 'กรุณาเลือกหน่วยราคา';
  if (!partial || Object.hasOwn(body, 'images')) {
    if (!Array.isArray(body.images) || !body.images.length) errors.images = 'กรุณาเพิ่มรูปห้องอย่างน้อย 1 รูป';
    else if (body.images.length > 12) errors.images = 'เพิ่มรูปห้องได้สูงสุด 12 รูป';
  }
  return errors;
}

// Selected files are not saved images until the upload has returned a URL.
export function completedListingImageUrls(images) {
  return images.filter(image => !image.file && typeof image.url === 'string' && image.url.trim()).map(image => image.url);
}

export function isWebUrl(value) {
  try {
    const url = new URL(value);
    return /^https?:\/\//i.test(value) && ['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname);
  } catch { return false; }
}
