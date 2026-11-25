type Contacts = { lineId?: string; instagram?: string; phone?: string; email?: string };

export function contactDetails(person?: Contacts | null) {
  return {
    lineId: person?.lineId?.trim() || undefined,
    instagram: person?.instagram?.trim() || undefined,
    phone: person?.phone?.trim() || undefined,
    email: person?.email?.trim() || undefined,
  };
}

export function matchContactDetails(person?: Contacts | null) {
  const { lineId, instagram, phone } = contactDetails(person);
  return { lineId, instagram, phone: lineId || instagram ? undefined : phone };
}

export function contactNames({ lineId, instagram, phone, email }: Contacts) {
  const names = [lineId && 'LINE', instagram && 'Instagram', phone && 'เบอร์โทร', email && 'อีเมล'].filter(Boolean);
  const last = names.pop();
  return names.length ? `${names.join(', ')} และ ${last}` : last || '';
}
