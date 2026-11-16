import { ProfilePhoto } from '../components/ProfilePhoto';
import { RefreshCw, Sparkles, UsersRound } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { ContactActions } from '../components/ContactActions';
import { Button, EmptyState } from '../components/UI';
import { api, ApiError } from '../lib/api';
import type { Match, RoomMember } from '../types';
import './MatchesPage.css';

type MemberLoad = {
  status: 'loading' | 'ready' | 'error';
  members: RoomMember[];
  error: string;
  accessChanged: boolean;
};

function MemberPreview({ state, roomTitle, onRetry }: { state?: MemberLoad; roomTitle: string; onRetry: () => void }) {
  const panel = useRef<HTMLElement>(null);
  const retrying = useRef(false);
  const loading = !state || state.status === 'loading';
  useEffect(() => {
    if (retrying.current && state && state.status !== 'loading') {
      retrying.current = false;
      if (document.activeElement === document.body || panel.current?.contains(document.activeElement)) {
        panel.current?.focus({ preventScroll: true });
      }
    }
  }, [state]);
  return <section ref={panel} tabIndex={-1} className={`member-strip ${state?.status === 'ready' && state.members.length ? '' : 'member-load-status'}`} aria-label={`รายชื่อสมาชิก ${roomTitle}`} aria-busy={loading}>
    {loading ? <p role="status"><RefreshCw size={16} className="animate-spin" aria-hidden="true"/>กำลังโหลดรายชื่อสมาชิก…</p>
      : state.status === 'error' ? <><p className="member-load-title" role="alert">โหลดรายชื่อสมาชิกห้องนี้ไม่สำเร็จ</p><p>{state.error}</p><Button variant="secondary" aria-label={`ลองโหลดสมาชิก ${roomTitle} อีกครั้ง`} onClick={() => { retrying.current = true; onRetry(); }}><RefreshCw size={16}/>ลองอีกครั้ง</Button></>
        : state.members.length ? <><strong><UsersRound/>สมาชิก {state.members.length} คน</strong><div>{state.members.map(member => <span key={member.userId} title={`${member.user?.firstName || ''} ${member.user?.lastName || ''}`}><ProfilePhoto src={member.user?.profileImage || ''} fallback={member.user?.firstName?.charAt(0) || 'R'}/></span>)}</div></>
          : <p role="status">ยังไม่มีรายชื่อสมาชิกให้แสดง</p>}
  </section>;
}

export function MatchesPage() {
  const location = useLocation();
  const [matches, setMatches] = useState<Match[]>([]); const [members, setMembers] = useState<Record<string, MemberLoad>>({}); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [reload, setReload] = useState(0);
  const requestRun = useRef(0);
  const loadMembers = useCallback(async (roomId: string, run: number) => {
    if (!roomId || run !== requestRun.current) return;
    setMembers(current => ({ ...current, [roomId]: { status: 'loading', members: [], error: '', accessChanged: current[roomId]?.accessChanged || false } }));
    try {
      const result = await api.roomMembers(roomId);
      if (run === requestRun.current) setMembers(current => ({ ...current, [roomId]: { status: 'ready', members: result, error: '', accessChanged: false } }));
    } catch (caught) {
      if (run !== requestRun.current) return;
      const accessChanged = caught instanceof ApiError && [401, 403, 404].includes(caught.status);
      setMembers(current => ({ ...current, [roomId]: { status: 'error', members: [], error: caught instanceof Error ? caught.message : 'โหลดรายชื่อสมาชิกไม่สำเร็จ กรุณาลองอีกครั้ง', accessChanged: current[roomId]?.accessChanged || accessChanged } }));
    }
  }, []);
  useEffect(() => {
    const run = ++requestRun.current;
    setLoading(true);
    setError('');
    setMatches([]); setMembers({});
    api.matches().then(result => {
      if (run !== requestRun.current) return;
      setMatches(result);
      const roomIds = [...new Set(result.map(match => match.room?.roomId).filter(Boolean))] as string[];
      // Match cards and each room's member preview load independently.
      for (const roomId of roomIds) void loadMembers(roomId, run);
    }).catch(caught => { if (run === requestRun.current) setError(caught instanceof Error ? caught.message : 'โหลดรายการแมตช์ไม่สำเร็จ'); })
      .finally(() => { if (run === requestRun.current) setLoading(false); });
    return () => { if (requestRun.current === run) requestRun.current += 1; };
  }, [reload, loadMembers]);
  return <div className="page matches-page"><PageHeader title="สมาชิกห้องของฉัน" subtitle="ดูห้องและสมาชิกที่ได้รับอนุมัติแล้ว การหาเพื่อนก่อนเข้าห้องอยู่ที่เมนูหาเพื่อน"/>
    {loading ? <div className="match-grid"><div className="match-skeleton"/><div className="match-skeleton"/></div> : error ? <EmptyState icon={<RefreshCw/>} title="โหลดรายการแมตช์ไม่สำเร็จ" text={error} action={<Button onClick={() => setReload(value => value + 1)}>ลองอีกครั้ง</Button>}/> : matches.length ? <div className="match-grid">{matches.map(match => { const other = match.otherUser; const roomId = match.room?.roomId || ''; return <article id={`match-${match.matchId}`} tabIndex={-1} className="match-card" key={match.matchId}><header><span className="match-spark"><Sparkles/></span><div><small>เข้าร่วมเมื่อ {match.matchedAt ? new Date(match.matchedAt).toLocaleDateString('th-TH') : '-'}</small><h2>{match.room?.title || 'ห้องของคุณ'}</h2></div></header><div className="match-person"><div className="match-avatar"><ProfilePhoto src={other?.profileImage || ''} fallback={other?.firstName?.charAt(0) || 'R'}/></div><div><h3>{other?.firstName} {other?.lastName}</h3><span className="room-role">{match.otherRole === 'owner' ? 'เจ้าของห้อง' : 'สมาชิกห้อง'}</span><p>{other?.bio || 'สมาชิก RoomMatch คนใหม่ของคุณ'}</p></div></div>{members[roomId]?.accessChanged ? <div className="match-access-note"><p>สิทธิ์เข้าถึงห้องนี้เปลี่ยนไป จึงซ่อนช่องทางติดต่อไว้ก่อน</p><Button variant="quiet" onClick={() => setReload(value => value + 1)}>อัปเดตรายการแมตช์</Button></div> : <ContactActions lineId={other?.lineId?.trim()} instagram={other?.instagram?.trim()} phone={!other?.lineId?.trim() && !other?.instagram?.trim() ? other?.phone : undefined}/>}{roomId && <MemberPreview state={members[roomId]} roomTitle={match.room?.title || 'ห้องนี้'} onRetry={() => void loadMembers(roomId, requestRun.current)}/>}<Link className="button button-secondary w-full" to={`/rooms/${roomId}`} state={{ from: location.pathname + location.search, focusReturnId: `match-${match.matchId}` }}>ดูห้องและสมาชิก</Link></article>; })}</div> : <EmptyState icon={<Sparkles/>} title="ยังไม่มีห้องที่คุณร่วมเป็นสมาชิก" text="เมื่อคำขอเข้าพักได้รับอนุมัติ เพื่อนร่วมห้องและช่องทางติดต่อจะปรากฏที่นี่" action={<Link className="button button-primary" to="/rooms">ค้นหาห้อง</Link>}/>}
  </div>;
}
