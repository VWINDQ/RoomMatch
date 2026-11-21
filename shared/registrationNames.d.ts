export const registrationNameFields: Record<'firstName' | 'lastName', { label: string; max: number; required: true }>;
export function registrationNameError(field: keyof typeof registrationNameFields, raw: unknown): string;
