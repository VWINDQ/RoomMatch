import { ProfilePhoto } from '../components/ProfilePhoto';
import { ArrowUpRight, Inbox, RefreshCw, Send, UserCheck, UserX } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../AppContext';
import { PageHeader } from '../components/Layout';
import { Button, EmptyState, StatusBadge } from '../components/UI';
import { api } from '../lib/api';
import type { JoinRequest } from '../types';

export function RequestsPage() {
  const { notify } = useApp(); const [mine, setMine] = useState<JoinRequest[]>([]); const [owner, setOwner] = useState<JoinRequest[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [busyId, setBusyId] = useState(''); const [reload, setReload] = useState(0);
  const [actionError, setActionError] = useState('');
  useEffect(() => { let active = true; setLoading(true); setError(''); Promise.all([api.mineRequests(), api.ownerRequests()]).then(([mineRequests, ownerRequests]) => { if (active) { setMine(mineRequests); setOwner(ownerRequests); } }).catch(caught => active && setError(caught instanceof Error ? caught.message : 'โหลดคำขอไม่สำเร็จ')).finally(() => active && setLoading(false)); return () => { active = false; }; }, [reload]);
  const decide = async (requestId: string, status: 'approved' | 'rejected') => { if (busyId) return; setActionError(''); setBusyId(requestId); try { const updated = await api.decideRequest(requestId, status); setOwner(current => current.map(request => request.requestId === requestId ? updated : request)); notify(status === 'approved' ? 'อนุมัติคำขอและสร้างแมตช์แล้ว' : 'ปฏิเสธคำขอแล้ว'); } catch (caught) { setActionError(caught instanceof Error ? caught.message : 'ดำเนินการไม่สำเร็จ'); } finally { setBusyId(''); } };
  return <div className="page requests-page"><PageHeader title="คำขอเข้าพัก" subtitle="ติดตามคำขอของคุณ และจัดการคำขอสำหรับห้องที่คุณเป็นเจ้าของ"/>
    {actionError && <p className="form-alert" role="alert">{actionError}</p>}
    {loading ? <div className="request-skeleton"><span/><span/><span/></div> : error ? <EmptyState icon={<RefreshCw/>} title="โหลดคำขอไม่สำเร็จ" text={error} action={<Button onClick={() => setReload(value => value + 1)}>ลองอีกครั้ง</Button>}/> : <div className="request-columns">
      <RequestSection icon={<Send/>} title="คำขอที่ฉันส่ง" count={mine.length}>{mine.length ? mine.map(request => <article className="request-card" key={request.requestId}><div className="request-person room-request-icon"><Send/></div><div className="request-copy"><StatusBadge status={request.status}/><h3>{request.room?.title || 'ประกาศห้อง'}</h3><p>ส่งเมื่อ {formatDate(request.requestedAt)}</p></div><Link className="icon-button" to={`/rooms/${request.room?.roomId}`} aria-label="ดูห้อง"><ArrowUpRight/></Link></article>) : <MiniEmpty icon={<Inbox/>} title="ยังไม่ได้ส่งคำขอ" text="เมื่อเจอห้องที่สนใจ คุณส่งคำขอได้จากหน้ารายละเอียดห้อง"/>}</RequestSection>
      <RequestSection icon={<Inbox/>} title="คำขอที่รอฉันพิจารณา" count={owner.filter(request => request.status === 'pending').length}>{owner.length ? owner.map(request => <article className="request-card owner-request-card" key={request.requestId}><div className="request-person"><ProfilePhoto src={request.requester?.profileImage || ''} fallback={request.requester?.firstName?.charAt(0) || 'R'}/></div><div className="request-copy"><StatusBadge status={request.status}/><h3>{request.requester?.firstName} {request.requester?.lastName}</h3><p>ขอเข้าพักที่ {request.room?.title || 'ห้องของคุณ'} · {formatDate(request.requestedAt)}</p></div>{request.status === 'pending' ? <div className="request-actions"><Button variant="secondary" loading={busyId === request.requestId} disabled={Boolean(busyId)} onClick={() => decide(request.requestId, 'approved')}><UserCheck/>อนุมัติ</Button><Button variant="quiet" disabled={Boolean(busyId)} onClick={() => decide(request.requestId, 'rejected')}><UserX/>ปฏิเสธ</Button></div> : <Link className="icon-button" to={`/rooms/${request.room?.roomId}`} aria-label="ดูห้อง"><ArrowUpRight/></Link>}</article>) : <MiniEmpty icon={<Inbox/>} title="ยังไม่มีคำขอเข้ามา" text="คำขอจากผู้สนใจจะปรากฏที่นี่"/>}</RequestSection>
    </div>}
  </div>;
}

function RequestSection({ icon, title, count, children }: { icon: React.ReactNode; title: string; count: number; children: React.ReactNode }) { return <section className="request-section"><header><span>{icon}</span><h2>{title}</h2><i>{count}</i></header><div className="request-list">{children}</div></section>; }
function MiniEmpty({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) { return <div className="mini-empty"><span>{icon}</span><h3>{title}</h3><p>{text}</p></div>; }
function formatDate(value?: string) { return value ? new Date(value).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }) : '-'; }
