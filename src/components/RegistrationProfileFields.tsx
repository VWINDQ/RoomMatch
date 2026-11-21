import { useId } from 'react';
import { AccountProfileFields } from './AccountProfileFields';
import { BirthDateInput } from './BirthDateInput';
import { Input } from './UI';

export function RegistrationProfileFields({ firstName, lastName, accountType, fieldErrors, onAccountTypeChange, onUniversitySelect }: {
  firstName?: string; lastName?: string; accountType: string; fieldErrors: Record<string, string>;
  onAccountTypeChange: (value: string) => void; onUniversitySelect: () => void;
}) {
  const genderErrorId = useId();
  return <>
    <div className="two-fields">
      <Input
        label="ชื่อ *"
        name="firstName"
        defaultValue={firstName}
        autoComplete="given-name"
        error={fieldErrors.firstName}
        required
      />
      <Input
        label="นามสกุล *"
        name="lastName"
        defaultValue={lastName}
        autoComplete="family-name"
        error={fieldErrors.lastName}
        required
      />
    </div>

    <Input
      label="เบอร์โทรศัพท์ *"
      name="phone"
      type="tel"
      inputMode="numeric"
      maxLength={10}
      onInput={event => {
        event.currentTarget.value = event.currentTarget.value
          .replace(/\D/g, '')
          .slice(0, 10);
      }}
      autoComplete="tel"
      error={fieldErrors.phone}
      required
    />

    <div className="two-fields">
      <label className="field">
        <span className="field-label">เพศ</span>
        <select name="gender" defaultValue="" aria-invalid={fieldErrors.gender ? true : undefined} aria-describedby={fieldErrors.gender ? genderErrorId : undefined}>
          <option value="">ไม่ระบุ</option>
          <option value="male">ชาย</option>
          <option value="female">หญิง</option>
          <option value="other">อื่น ๆ</option>
        </select>
        {fieldErrors.gender && <span id={genderErrorId} className="field-error">{fieldErrors.gender}</span>}
      </label>

      <BirthDateInput required error={fieldErrors.dateOfBirth} />
    </div>
    <AccountProfileFields required accountType={accountType} errors={fieldErrors}
      onAccountTypeChange={onAccountTypeChange} onUniversitySelect={onUniversitySelect}/>
  </>;
}
