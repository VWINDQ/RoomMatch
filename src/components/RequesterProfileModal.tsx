import { RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';
import type { FriendProfile, JoinRequest } from '../types';
import { ProfilePhoto } from './ProfilePhoto';
import { Button, Modal } from './UI';
import './RequesterProfileModal.css';

function budgetText(profile: FriendProfile) {
  const amount = (value: number) => `฿${value.toLocaleString('th-TH')}`;
  if (profile.budgetMin === null && profile.budgetMax === null) return 'ยังไม่ได้ระบุงบประมาณ';
  if (profile.budgetMin === null) return `ไม่เกิน ${amount(profile.budgetMax!)} / เดือน`;
  if (profile.budgetMax === null) return `ตั้งแต่ ${amount(profile.budgetMin)} / เดือน`;
  return `${amount(profile.budgetMin)}–${amount(profile.budgetMax)} / เดือน`;
}

export function RequesterProfileModal({ request, onClose, onDecide }: { request: JoinRequest; onClose: () => void; onDecide?: (status: 'approved' | 'rejected') => void }) {
  const [profile, setProfile] = useState<FriendProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Retrying removes the focused retry button; keep keyboard focus in the dialog.
    if (!loading && container.current && !container.current.contains(document.activeElement)) {
      container.current.querySelector<HTMLButtonElement>('button[aria-label="ปิด"]')?.focus();
    }
  }, [loading]);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setProfile(null);
    api.requesterProfile(request.requestId).then(result => { if (active) setProfile(result); })
      .catch(caught => {
        if (!active) return;
        setError(caught instanceof ApiError && caught.status === 404 ? 'ไม่พบคำขอหรือโปรไฟล์นี้อาจไม่เปิดใช้งานแล้ว'
          : caught instanceof ApiError && caught.status === 403 ? 'คุณไม่มีสิทธิ์ดูโปรไฟล์จากคำขอนี้'
            : caught instanceof Error ? caught.message : 'โหลดโปรไฟล์ไม่สำเร็จ');
      }).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [request.requestId, reload]);

  const canDecide = request.status === 'pending' && !loading && !error && profile && onDecide;
  return <div ref={container} className="requester-profile-dialog"><Modal title="โปรไฟล์ผู้ขอเข้าพัก" onClose={onClose} actions={<>
    {canDecide && <><Button variant="quiet" onClick={() => onDecide('rejected')}>ปฏิเสธคำขอ</Button><Button onClick={() => onDecide('approved')}>อนุมัติเข้าพัก</Button></>}
    <Button className="profile-return" variant="quiet" onClick={onClose}>กลับไปดูคำขอ</Button>
  </>}>
    {loading ? <div className="requester-profile-loading" role="status"><span className="clay-loader"/><p>กำลังโหลดโปรไฟล์…</p></div>
      : error || !profile ? <div className="requester-profile-error"><p role="alert">{error || 'ไม่พบโปรไฟล์ผู้ขอเข้าพัก'}</p><Button variant="secondary" onClick={() => setReload(value => value + 1)}><RefreshCw size={17}/>ลองอีกครั้ง</Button></div>
        : <div className="requester-profile">
          <header><div className="requester-profile-avatar"><ProfilePhoto src={profile.profileImage} fallback={profile.firstName.charAt(0) || 'R'}/></div><div><h3>{profile.firstName} {profile.lastName}</h3><p>{profile.university || 'ยังไม่ได้ระบุมหาวิทยาลัย'}</p></div></header>
          <p className="requester-profile-room">ขอเข้าพักที่ {request.room?.title || 'ห้องของคุณ'}</p>
          <section><h3>เกี่ยวกับฉัน</h3><p>{profile.bio || 'ยังไม่ได้เขียนแนะนำตัว'}</p></section>
          <section><h3>ไลฟ์สไตล์</h3><p>{profile.lifestyle || 'ยังไม่ได้ระบุไลฟ์สไตล์'}</p></section>
          <section className="requester-profile-budget"><h3>งบค่าห้องที่ตั้งไว้</h3><p>{budgetText(profile)}</p></section>
          <p className="requester-profile-note">ดูช่องทางติดต่อหลังอนุมัติได้ที่หน้าสมาชิกห้อง</p>
        </div>}
  </Modal></div>;
}
