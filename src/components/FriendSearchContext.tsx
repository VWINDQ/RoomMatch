import { HeartHandshake } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import type { FriendProfile } from '../types';

export function FriendSearchContext() {
  const [params] = useSearchParams();
  const friendId = params.get('withFriend');
  const [person, setPerson] = useState<FriendProfile | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setPerson(null); setError('');
    if (friendId) api.friendConnections().then(connections => {
      if (!active) return;
      const connection = connections.find(item => item.status === 'accepted' && item.person.userId === friendId);
      if (connection) setPerson(connection.person);
      else setError('ต้องตอบรับคำชวนกันก่อนเริ่มหาห้องด้วยกัน');
    }).catch(caught => active && setError(caught instanceof Error ? caught.message : 'โหลดข้อมูลเพื่อนไม่สำเร็จ'));
    return () => { active = false; };
  }, [friendId]);
  if (!friendId) return null;
  return <aside className="friends-note friend-search-context"><span><HeartHandshake/></span><p>{error || (person ? `กำลังหาห้องกับ ${person.firstName} ${person.lastName}` : 'กำลังโหลดข้อมูลเพื่อน…')}<br/><small>{person ? 'คุยเรื่องงบและจำนวนที่ว่างด้วยกันก่อนส่งคำขอ การเข้าพักยังต้องให้เจ้าของห้องอนุมัติแต่ละคน' : 'ข้อมูลแมตช์และสมาชิกห้องเดิมไม่เปลี่ยนแปลง'}</small></p><Link to={error ? '/friends' : '/rooms'}>{error ? 'กลับไปหาเพื่อน' : 'หาห้องตามปกติ'}</Link></aside>;
}
