export function formatBirthDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

export function parseBirthDate(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);
  if (!match) throw new Error('กรอกวันเกิดเป็น วว/ดด/ปปปป โดยใช้ปี ค.ศ.');
  const [, day, month, year] = match;
  const iso = `${year}-${month}-${day}`;
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number(year) < 100 || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== iso) {
    throw new Error('กรุณากรอกวันเกิดที่มีอยู่จริง');
  }
  if (iso > new Date().toISOString().slice(0, 10)) {
    throw new Error('วันเกิดต้องไม่เป็นวันในอนาคต และปีต้องเป็น ค.ศ.');
  }
  return iso;
}
