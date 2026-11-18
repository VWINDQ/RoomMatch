export function calculateAge(dateOfBirth: string, today = new Date()): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) return null;
  const [year, month, day] = dateOfBirth.split('-').map(Number);
  const birthDate = new Date(0);
  birthDate.setFullYear(year, month - 1, day);
  birthDate.setHours(0, 0, 0, 0);
  if (birthDate.getFullYear() !== year || birthDate.getMonth() !== month - 1 || birthDate.getDate() !== day || birthDate > today) return null;
  const birthdayPending = today.getMonth() + 1 < month || (today.getMonth() + 1 === month && today.getDate() < day);
  return today.getFullYear() - year - (birthdayPending ? 1 : 0);
}
