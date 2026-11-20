import { Input } from './UI';
import { formatBirthDate } from '../lib/birthDate';

export function BirthDateInput({ defaultValue = '', error, required = false }: { defaultValue?: string; error?: string; required?: boolean }) {
  return <Input
    label={required ? 'วันเกิด (ค.ศ.) *' : 'วันเกิด (ค.ศ.)'}
    name="dateOfBirth"
    type="text"
    autoComplete="bday"
    placeholder="วว/ดด/ปปปป"
    hint="เช่น 25/12/2000"
    pattern="[0-9]{2}/[0-9]{2}/[0-9]{4}"
    title="วว/ดด/ปปปป โดยใช้ปี ค.ศ. เช่น 25/12/2000"
    maxLength={10}
    defaultValue={formatBirthDate(defaultValue)}
    error={error}
    required={required}
  />;
}
