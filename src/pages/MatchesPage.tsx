import { ProfilePhoto } from '../components/ProfilePhoto';
import { RefreshCw, Sparkles, UsersRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { ContactActions } from '../components/ContactActions';
import { Button, EmptyState } from '../components/UI';
import { api } from '../lib/api';
import type { Match, RoomMember } from '../types';

export function MatchesPage() {
  const location = useLocation();
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
    }).catch(caught => active && setError(caught instanceof Error ? caught.message : 'โหลดสมาชิกห้องไม่สำเร็จ'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [reload]);
  return <div className="page matches-page"><PageHeader title="สมาชิกห้องของฉัน" subtitle="ดูห้องและสมาชิกที่ได้รับอนุมัติแล้ว การหาเพื่อนก่อนเข้าห้องอยู่ที่เมนูหาเพื่อน"/>
    {loading ? <div className="match-grid"><div className="match-skeleton"/><div className="match-skeleton"/></div> : error ? <EmptyState icon={<RefreshCw/>} title="โหลดสมาชิกห้องไม่สำเร็จ" text={error} action={<Button onClick={() => setReload(value => value + 1)}>ลองอีกครั้ง</Button>}/> : matches.length ? <div className="match-grid">{matches.map(match => { const other = match.otherUser; const roomId = match.room?.roomId || ''; return <article id={`match-${match.matchId}`} tabIndex={-1} className="match-card" key={match.matchId}><header><span className="match-spark"><Sparkles/></span><div><small>เข้าร่วมเมื่อ {match.matchedAt ? new Date(match.matchedAt).toLocaleDateString('th-TH') : '-'}</small><h2>{match.room?.title || 'ห้องของคุณ'}</h2></div></header><div className="match-person"><div className="match-avatar"><ProfilePhoto src={other?.profileImage || ''} fallback={other?.firstName?.charAt(0) || 'R'}/></div><div><h3>{other?.firstName} {other?.lastName}</h3><span className="room-role">{match.otherRole === 'owner' ? 'เจ้าของห้อง' : 'สมาชิกห้อง'}</span><p>{other?.bio || 'สมาชิก RoomMatch คนใหม่ของคุณ'}</p></div></div><ContactActions lineId={other?.lineId} instagram={other?.instagram}/>{members[roomId]?.length > 0 && <div className="member-strip"><strong><UsersRound/>สมาชิก {members[roomId].length} คน</strong><div>{members[roomId].map(member => <span key={member.userId} title={`${member.user?.firstName || ''} ${member.user?.lastName || ''}`}><ProfilePhoto src={member.user?.profileImage || ''} fallback={member.user?.firstName?.charAt(0) || 'R'}/></span>)}</div></div>}<Link className="button button-secondary w-full" to={`/rooms/${roomId}`} state={{ from: location.pathname + location.search, focusReturnId: `match-${match.matchId}` }}>ดูห้องและสมาชิก</Link></article>; })}</div> : <EmptyState icon={<Sparkles/>} title="ยังไม่มีห้องที่คุณร่วมเป็นสมาชิก" text="เมื่อคำขอเข้าพักได้รับอนุมัติ เพื่อนร่วมห้องและช่องทางติดต่อจะปรากฏที่นี่" action={<Link className="button button-primary" to="/rooms">ค้นหาห้อง</Link>}/>}
  </div>;
}
