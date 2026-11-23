import { Skeleton } from './Skeleton';
import { HeartHandshake } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import type { FriendProfile } from '../types';

export function FriendSearchExplanation() {
  return <>ระบบค้นหาห้องที่มีที่ว่างพอ ที่ว่างอาจเปลี่ยนได้และยังไม่มีการจอง ทั้งคู่ต้องส่งคำขอแยกกันและได้รับอนุมัติเป็นรายคน ผู้ลงประกาศอาจอนุมัติเพียงคนเดียว</>;
}

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
  const soloParams = new URLSearchParams(params);
  soloParams.delete('withFriend');
  soloParams.delete('page');
  return <aside className="friends-note friend-search-context"><span><HeartHandshake/></span>{!error && !person ? <Skeleton variant="friend-context"/> : <p>{error || (person ? `กำลังหาห้องกับ ${person.firstName} ${person.lastName}` : 'กำลังโหลดข้อมูลเพื่อน…')}<br/><small>{person && <FriendSearchExplanation/>}</small></p>}<Link to={error ? '/friends' : { pathname: '/rooms', search: soloParams.toString() }}>{error ? 'กลับไปหาเพื่อน' : 'หาห้องตามปกติ'}</Link></aside>;
}
