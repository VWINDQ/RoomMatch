import { useId } from 'react';
import { accountTypes } from '../../shared/accountProfile.js';
import { Input } from './UI';
import { UniversityPicker } from './UniversityPicker';

export function AccountProfileFields({ accountType, onAccountTypeChange, onUniversitySelect, university = '', required, errors }: {
  accountType: string; onAccountTypeChange: (value: string) => void; university?: string;
  required: boolean; errors: Record<string, string>; onUniversitySelect: () => void;
}) {
  const errorId = useId();
  return <>
    <label className="field">
      <span className="field-label">สถานะผู้ใช้{required && <> <span className="required-marker" aria-hidden="true">*</span></>}</span>
      <select name="accountType" value={accountType} required={required} onChange={event => onAccountTypeChange(event.target.value)}
        aria-invalid={errors.accountType ? true : undefined} aria-describedby={errors.accountType ? errorId : undefined}>
        <option value="">เลือกสถานะผู้ใช้</option>
        {Object.entries(accountTypes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      {errors.accountType && <span id={errorId} className="field-error">{errors.accountType}</span>}
    </label>
    {accountType === 'student' && <UniversityPicker university={university} error={errors.university} onSelect={onUniversitySelect}/>}
    {!required && !accountType && <Input key="legacy" label="มหาวิทยาลัย" name="university" defaultValue={university} maxLength={255} error={errors.university}/>}
  </>;
}
