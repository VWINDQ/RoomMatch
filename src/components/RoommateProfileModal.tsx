import type { ReactNode } from 'react';
import { ageRange, roommateGenderLabel } from '../lib/profileLabels';
import type { RoommateProfile } from '../types';
import { ProfileDemographics } from './ProfileDemographics';
import { ProfilePhoto } from './ProfilePhoto';
import { Modal } from './UI';
import './RoommateProfileModal.css';

export function roommateBudgetLabel({ budgetMin, budgetMax }: RoommateProfile) {
  if (budgetMin === null && budgetMax === null) return 'ยังไม่ได้ระบุงบประมาณ';
  if (budgetMin === null) return `ไม่เกิน ฿${budgetMax!.toLocaleString('th-TH')} / เดือน`;
  if (budgetMax === null) return `ตั้งแต่ ฿${budgetMin.toLocaleString('th-TH')} / เดือน`;
  return `฿${budgetMin.toLocaleString('th-TH')}–${budgetMax.toLocaleString('th-TH')} / เดือน`;
}

export function RoommateProfileModal({ title, person, onClose, actions, children }: {
  title: string; person: RoommateProfile; onClose: () => void; actions?: ReactNode; children?: ReactNode;
}) {
  return <Modal title={title} onClose={onClose} actions={actions} className="roommate-profile-modal">
    <div className="friend-full-profile">
      <div className="friend-avatar"><ProfilePhoto src={person.profileImage} fallback={person.firstName.charAt(0) + person.lastName.charAt(0)}/></div>
      <h2>{person.firstName} {person.lastName}</h2>
      <ProfileDemographics age={person.age} gender={person.gender}/>
      <p>{person.university || 'ยังไม่ได้ระบุมหาวิทยาลัย'}</p>
      <h3>เกี่ยวกับฉัน</h3><p>{person.bio || 'ยังไม่ได้เขียนแนะนำตัว'}</p>
      <h3>ไลฟ์สไตล์</h3><p>{person.lifestyle || 'ยังไม่ได้ระบุ'}</p>
      <h3>เพศที่สะดวกแชร์ห้อง</h3><p>{roommateGenderLabel(person.preferredGender)}</p>
      <h3>ช่วงอายุที่สะดวกแชร์ห้อง</h3><p>{ageRange(person.preferredAgeMin, person.preferredAgeMax)}</p>
      <h3>งบค่าห้องที่ตั้งไว้</h3><p>{roommateBudgetLabel(person)}</p>
      {children}
    </div>
  </Modal>;
}
