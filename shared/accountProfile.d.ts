export const accountTypes: Record<'student' | 'general', string>;
export function validateAccountProfile(accountType: unknown, university: unknown): { accountType?: string; university?: string };
