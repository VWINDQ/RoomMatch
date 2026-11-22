import { genderLabel } from '../lib/profileLabels';
import './ProfileDemographics.css';

export function ProfileDemographics({ age, gender }: { age: number | null; gender: string }) {
  const ageText = age === null ? 'ยังไม่ระบุอายุ' : `อายุ ${age} ปี`;
  const genderText = genderLabel(gender);
  return <p className="profile-demographics">{ageText} · {genderText === 'ยังไม่ระบุ' ? 'ยังไม่ระบุเพศ' : `เพศ${genderText}`}</p>;
}
