import { Coffee, MessageCircle, Pencil } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../AppContext';
import { SessionChangedError } from '../lib/api';
import { Button, Modal } from './UI';
import './ProfileReminder.css';

export function ProfileReminder() {
  const { user, acknowledgeProfileReminder } = useApp();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const locked = useRef(false);
  const mounted = useRef(true);
  const visible = user?.profileReminderSeen === false && !user.profileSetupPending;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!visible) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [visible]);

  const acknowledge = async (editProfile = false) => {
    if (locked.current) return;
    locked.current = true;
    setSaving(true);
    setError('');
    try {
      await acknowledgeProfileReminder();
      if (mounted.current && editProfile) navigate('/profile', { state: { editProfile: true } });
    } catch (caught) {
      if (mounted.current && !(caught instanceof SessionChangedError)) {
        setError('บันทึกการรับทราบไม่สำเร็จ ลองกดอีกครั้ง ข้อมูลโปรไฟล์ของคุณยังอยู่');
      }
    } finally {
      locked.current = false;
      if (mounted.current) setSaving(false);
    }
  };

  // Older API responses omit this flag; never interrupt mandatory Google account setup.
  if (!visible) return null;
  return <Modal title="เติมโปรไฟล์ให้เพื่อนรู้จักคุณ" className="profile-reminder" onClose={() => { void acknowledge(); }} actions={<>
    <Button variant="quiet" disabled={saving} onClick={() => { void acknowledge(); }}>ไว้ทีหลัง</Button>
    <Button loading={saving} onClick={() => { void acknowledge(true); }}><Pencil size={17} aria-hidden="true"/>ไปเติมโปรไฟล์</Button>
  </>}>
    <div aria-busy={saving}>
      <p>ก่อนเริ่มหาห้องหรือหาเพื่อน อย่าลืมเพิ่มข้อมูลอีกนิด เพื่อให้คนที่เข้ากันได้รู้จักคุณมากขึ้น</p>
      <ul className="profile-reminder-list">
        <li><span className="profile-reminder-icon lifestyle"><Coffee size={21} aria-hidden="true"/></span><div><strong>ไลฟ์สไตล์ของคุณ</strong><span>เช่น เวลานอน การสูบบุหรี่ หรือความชอบเวลาพักผ่อน</span></div></li>
        <li><span className="profile-reminder-icon contact"><MessageCircle size={21} aria-hidden="true"/></span><div><strong>ช่องทางการติดต่อ</strong><span>เพิ่ม LINE ID หรือ Instagram ไว้คุยรายละเอียดกันต่อ</span></div></li>
      </ul>
      <p className="profile-reminder-note">ยังไม่พร้อมก็ข้ามได้ แล้วกลับมาเติมที่หน้าโปรไฟล์ภายหลัง</p>
      {error && <p className="form-alert" role="alert">{error}</p>}
    </div>
  </Modal>;
}
