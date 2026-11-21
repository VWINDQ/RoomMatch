import { Coffee, MessageCircle, Pencil } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useApp } from '../AppContext';
import { Button, Modal } from './UI';
import './ProfileReminder.css';

export function ProfileReminder({ onEdit }: { onEdit: () => void }) {
  const { consumeRegistrationReminder } = useApp();
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (consumeRegistrationReminder()) setVisible(true);
  }, [consumeRegistrationReminder]);
  useEffect(() => {
    if (!visible) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [visible]);

  if (!visible) return null;
  const close = () => setVisible(false);
  return <Modal title="เติมโปรไฟล์ให้เพื่อนรู้จักคุณ" className="profile-reminder" onClose={close} actions={<>
    <Button variant="quiet" onClick={close}>ไว้ทีหลัง</Button>
    <Button onClick={() => { close(); onEdit(); }}><Pencil size={17} aria-hidden="true"/>ไปเติมโปรไฟล์</Button>
  </>}>
    <div>
      <p>ก่อนเริ่มหาห้องหรือหาเพื่อน อย่าลืมเพิ่มข้อมูลอีกนิด เพื่อให้คนที่เข้ากันได้รู้จักคุณมากขึ้น</p>
      <ul className="profile-reminder-list">
        <li><span className="profile-reminder-icon lifestyle"><Coffee size={21} aria-hidden="true"/></span><div><strong>ไลฟ์สไตล์ของคุณ</strong><span>เช่น เวลานอน การสูบบุหรี่ หรือความชอบเวลาพักผ่อน</span></div></li>
        <li><span className="profile-reminder-icon contact"><MessageCircle size={21} aria-hidden="true"/></span><div><strong>ช่องทางการติดต่อ</strong><span>เพิ่ม LINE ID หรือ Instagram ไว้คุยรายละเอียดกันต่อ</span></div></li>
      </ul>
      <p className="profile-reminder-note">ยังไม่พร้อมก็ข้ามได้ แล้วกลับมาเติมที่หน้าโปรไฟล์ภายหลัง</p>
    </div>
  </Modal>;
}
