import { ProfilePhoto } from '../components/ProfilePhoto';
import { AtSign, MessageCircle, RefreshCw, Sparkles, UsersRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { Button, EmptyState } from '../components/UI';
import { api } from '../lib/api';
import type { Match, RoomMember } from '../types';

export function MatchesPage() {
  const [matches, setMatches] = useState<Match[]>([]); const [members, setMembers] = useState<Record<string, RoomMember[]>>({}); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    api.matches().then(async result => {
      const roomIds = [...new Set(result.map(match => match.room?.roomId).filter(Boolean))] as string[];
      const roomMembers = await Promise.all(roomIds.map(async roomId => [roomId, await api.roomMembers(roomId)] as const));
      if (!active) return;
      setMatches(result);
      setMembers(Object.fromEntries(roomMembers));
    }).catch(caught => active && setError(caught instanceof Error ? caught.message : 'โหลดแมตช์ไม่สำเร็จ'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [reload]);
  return <div className="page matches-page"><PageHeader title="เพื่อนร่วมห้อง" subtitle="แมตช์ที่เกิดขึ้นหลังเจ้าของห้องอนุมัติคำขอเข้าพัก"/>
    {loading ? <div className="match-grid"><div className="match-skeleton"/><div className="match-skeleton"/></div> : error ? <EmptyState icon={<RefreshCw/>} title="โหลดแมตช์ไม่สำเร็จ" text={error} action={<Button onClick={() => setReload(value => value + 1)}>ลองอีกครั้ง</Button>}/> : matches.length ? <div className="match-grid">{matches.map(match => { const other = match.otherUser; const roomId = match.room?.roomId || ''; return <article className="match-card" key={match.matchId}><header><span className="match-spark"><Sparkles/></span><div><small>แมตช์เมื่อ {match.matchedAt ? new Date(match.matchedAt).toLocaleDateString('th-TH') : '-'}</small><h2>{match.room?.title || 'ห้องของคุณ'}</h2></div></header><div className="match-person"><div className="match-avatar"><ProfilePhoto src={other?.profileImage || ''} fallback={other?.firstName?.charAt(0) || 'R'}/></div><div><h3>{other?.firstName} {other?.lastName}</h3><p>{other?.bio || 'สมาชิก RoomMatch คนใหม่ของคุณ'}</p></div></div><div className="match-contact">{other?.lineId && <span><MessageCircle/>LINE: {other.lineId}</span>}{other?.instagram && <span><AtSign/>Instagram: {other.instagram}</span>}{!other?.lineId && !other?.instagram && <span>ยังไม่ได้เพิ่มช่องทางติดต่อ</span>}</div>{members[roomId]?.length > 0 && <div className="member-strip"><strong><UsersRound/>สมาชิก {members[roomId].length} คน</strong><div>{members[roomId].map(member => <span key={member.userId} title={`${member.user?.firstName || ''} ${member.user?.lastName || ''}`}><ProfilePhoto src={member.user?.profileImage || ''} fallback={member.user?.firstName?.charAt(0) || 'R'}/></span>)}</div></div>}<Link className="button button-secondary w-full" to={`/rooms/${roomId}`}>ดูห้องและสมาชิก</Link></article>; })}</div> : <EmptyState icon={<Sparkles/>} title="ยังไม่มีแมตช์" text="เมื่อคำขอเข้าพักได้รับอนุมัติ เพื่อนร่วมห้องและช่องทางติดต่อจะปรากฏที่นี่" action={<Button onClick={() => location.assign('/rooms')}>ค้นหาห้อง</Button>}/>}
  </div>;
}
