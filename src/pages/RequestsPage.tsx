import { ProfilePhoto } from '../components/ProfilePhoto';
import { ArrowUpRight, Inbox, RefreshCw, Send, UserCheck, UserRound, UserX } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../AppContext';
import { useOwnerRequests } from '../OwnerRequestsContext';
import { PageHeader } from '../components/Layout';
import { RequesterProfileModal } from '../components/RequesterProfileModal';
import { Button, EmptyState, Modal, StatusBadge } from '../components/UI';
import { api, ApiError } from '../lib/api';
import type { JoinRequest, Room } from '../types';

type RequestView = 'incoming' | 'sent';
type Decision = { request: JoinRequest; status: 'approved' | 'rejected' };

export function RequestsPage() {
  const { notify } = useApp();
  const [mine, setMine] = useState<JoinRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [reload, setReload] = useState(0);
  const { ownerRequests: owner, loading: ownerLoading, error: ownerError, refreshOwnerRequests, updateOwnerRequest } = useOwnerRequests();
  const [view, setView] = useState<RequestView | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [selectedRequester, setSelectedRequester] = useState<JoinRequest | null>(null);
  const [actionError, setActionError] = useState('');
  const [room, setRoom] = useState<Room | null>(null);
  const [roomLoading, setRoomLoading] = useState(false);
  const [roomError, setRoomError] = useState('');
  const [roomReload, setRoomReload] = useState(0);
  const incomingTab = useRef<HTMLButtonElement>(null);
  const pending = owner.filter(request => request.status === 'pending');
  const history = owner.filter(request => request.status !== 'pending');
  const activeView = view ?? 'incoming';
  const viewLoading = activeView === 'incoming' ? ownerLoading : loading;
  const viewError = activeView === 'incoming' ? ownerError : error;

  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    api.mineRequests().then(requests => { if (active) setMine(requests); })
      .catch(caught => active && setError(caught instanceof Error ? caught.message : 'โหลดคำขอไม่สำเร็จ'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [reload]);

  useEffect(() => {
    if (!ownerLoading && !ownerError && view === null) setView(pending.length ? 'incoming' : 'sent');
  }, [ownerLoading, ownerError, pending.length, view]);

  useEffect(() => {
    let active = true;
    setRoom(null); setRoomError('');
    if (!decision || decision.status !== 'approved') { setRoomLoading(false); return; }
    setRoomLoading(true);
    api.room(decision.request.room?.roomId || '').then(result => { if (active) setRoom(result); })
      .catch(caught => active && setRoomError(caught instanceof Error ? caught.message : 'ตรวจสอบที่ว่างไม่สำเร็จ'))
      .finally(() => active && setRoomLoading(false));
    return () => { active = false; };
  }, [decision, roomReload]);

  const openDecision = (request: JoinRequest, status: Decision['status']) => {
    setActionError(''); setRoom(null); setRoomError(''); setRoomLoading(status === 'approved');
    setDecision({ request, status });
  };
  const closeDecision = () => { if (!busyId) { setDecision(null); setActionError(''); } };
  const stillPending = decision && owner.some(request => request.requestId === decision.request.requestId && request.status === 'pending');
  const canApprove = room && room.status === 'available' && room.availableSlots > 0;
  const decide = async () => {
    if (!decision || busyId || !stillPending || (decision.status === 'approved' && !canApprove)) return;
    const { request, status } = decision;
    setActionError(''); setBusyId(request.requestId);
    try {
      const updated = await api.decideRequest(request.requestId, status);
      updateOwnerRequest(updated);
      setDecision(null);
      notify(status === 'approved' ? 'อนุมัติคำขอและสร้างแมตช์แล้ว' : 'ปฏิเสธคำขอแล้ว');
      window.requestAnimationFrame(() => incomingTab.current?.focus());
    } catch (caught) {
      setActionError(caught instanceof ApiError && caught.status === 409
        ? 'คำขอหรือที่ว่างอาจเปลี่ยนแล้ว กรุณาปิดหน้าต่างและตรวจสอบรายการล่าสุด'
        : caught instanceof Error ? caught.message : 'ดำเนินการไม่สำเร็จ');
      if (caught instanceof ApiError && caught.status === 409) { void refreshOwnerRequests(); setRoomReload(value => value + 1); }
    } finally { setBusyId(''); }
  };

  const ownerCard = (request: JoinRequest) => <article className="request-card owner-request-card" key={request.requestId}>
    <div className="request-person"><ProfilePhoto src={request.requester?.profileImage || ''} fallback={request.requester?.firstName?.charAt(0) || 'R'}/></div>
    <div className="request-copy"><StatusBadge status={request.status}/><h3>{request.requester?.firstName} {request.requester?.lastName}</h3><p>ขอเข้าพักที่ {request.room?.title || 'ห้องของคุณ'} · {formatDate(request.requestedAt)}</p><button type="button" className="request-profile-link" disabled={Boolean(busyId)} onClick={() => setSelectedRequester(request)}><UserRound size={16}/>ดูโปรไฟล์</button></div>
    {request.status === 'pending' ? <div className="request-actions">
      <Button variant="secondary" disabled={Boolean(busyId)} onClick={() => openDecision(request, 'approved')}><UserCheck/>อนุมัติ</Button>
      <Button variant="quiet" disabled={Boolean(busyId)} onClick={() => openDecision(request, 'rejected')}><UserX/>ปฏิเสธ</Button>
    </div> : <Link className="icon-button" to={`/rooms/${request.room?.roomId}`} aria-label="ดูห้อง"><ArrowUpRight/></Link>}
  </article>;

  return <div className="page requests-page">
    <PageHeader title="คำขอเข้าพัก" subtitle="ติดตามคำขอของคุณ และจัดการคำขอสำหรับห้องที่คุณเป็นเจ้าของ"/>
    <nav className="request-tabs" aria-label="หมวดคำขอเข้าพัก">
      <button ref={incomingTab} className={activeView === 'incoming' ? 'selected' : ''} aria-pressed={activeView === 'incoming'} onClick={() => setView('incoming')}><Inbox size={18}/>คำขอถึงฉัน{pending.length > 0 && <span>{pending.length}</span>}</button>
      <button className={activeView === 'sent' ? 'selected' : ''} aria-pressed={activeView === 'sent'} onClick={() => setView('sent')}><Send size={18}/>คำขอที่ฉันส่ง</button>
    </nav>
    {viewLoading ? <div className="request-skeleton" aria-label="กำลังโหลดคำขอ"><span/><span/><span/></div>
      : viewError ? <EmptyState icon={<RefreshCw/>} title="โหลดคำขอไม่สำเร็จ" text={viewError} action={<Button onClick={() => { setReload(value => value + 1); void refreshOwnerRequests(); }}>ลองอีกครั้ง</Button>}/>
      : <div className="request-panel">{activeView === 'incoming'
        ? <RequestSection icon={<Inbox/>} title="คำขอถึงฉัน" count={pending.length}>
          {owner.length ? <>{pending.length > 0 ? <><p className="request-group-label">รอพิจารณา {pending.length} คำขอ</p>{pending.map(ownerCard)}</> : <p className="request-group-label">ไม่มีคำขอรอพิจารณาแล้ว</p>}
            {history.length > 0 && <><p className="request-group-label request-history-label">ประวัติคำขอ · {history.length} รายการ</p>{history.map(ownerCard)}</>}</>
            : <MiniEmpty icon={<Inbox/>} title="ยังไม่มีคำขอเข้ามา" text="คำขอจากผู้สนใจห้องของคุณจะปรากฏที่นี่"/>}
        </RequestSection>
        : <RequestSection icon={<Send/>} title="คำขอที่ฉันส่ง" count={mine.length}>
          {mine.length ? mine.map(request => <article className="request-card" key={request.requestId}><div className="request-person room-request-icon"><Send/></div><div className="request-copy"><StatusBadge status={request.status}/><h3>{request.room?.title || 'ประกาศห้อง'}</h3><p>ส่งเมื่อ {formatDate(request.requestedAt)}</p></div><Link className="icon-button" to={`/rooms/${request.room?.roomId}`} aria-label="ดูห้อง"><ArrowUpRight/></Link></article>)
            : <MiniEmpty icon={<Inbox/>} title="ยังไม่ได้ส่งคำขอ" text="เมื่อเจอห้องที่สนใจ คุณส่งคำขอได้จากหน้ารายละเอียดห้อง"/>}
        </RequestSection>}</div>}
    {selectedRequester && <RequesterProfileModal key={selectedRequester.requestId} request={selectedRequester} onClose={() => setSelectedRequester(null)}/>}
    {decision && <Modal title={decision.status === 'approved' ? 'ยืนยันอนุมัติเข้าพัก' : 'ยืนยันปฏิเสธคำขอ'} onClose={closeDecision} actions={<>
      <Button variant="quiet" disabled={Boolean(busyId)} onClick={closeDecision}>ยกเลิก</Button>
      <Button variant={decision.status === 'approved' ? 'primary' : 'danger'} loading={Boolean(busyId)} disabled={!stillPending || (decision.status === 'approved' && (roomLoading || Boolean(roomError) || !canApprove))} onClick={decide}>{decision.status === 'approved' ? 'ยืนยันอนุมัติ' : 'ยืนยันปฏิเสธ'}</Button>
    </>}>
      <div className="request-confirm-summary"><strong>{`${decision.request.requester?.firstName || ''} ${decision.request.requester?.lastName || ''}`.trim() || 'ผู้ขอเข้าพัก'}</strong><span>{decision.request.room?.title || 'ห้องของคุณ'}</span></div>
      <p className="request-confirm-message">{decision.status === 'approved' ? 'เมื่อยืนยัน ผู้ขอจะเป็นสมาชิกห้อง และทั้งสองฝ่ายจะเห็นแมตช์พร้อมช่องทางติดต่อ' : 'เมื่อยืนยัน ผู้ขอจะเห็นสถานะไม่อนุมัติ หากห้องยังรับอยู่ ผู้ขอสามารถส่งคำขอใหม่ได้'}</p>
      {decision.status === 'approved' && (roomLoading ? <p className="request-confirm-note" role="status">กำลังตรวจสอบที่ว่างล่าสุด…</p>
        : roomError ? <div className="request-confirm-note"><p role="alert">ตรวจสอบที่ว่างไม่สำเร็จ: {roomError}</p><Button variant="secondary" onClick={() => setRoomReload(value => value + 1)}>ลองตรวจสอบอีกครั้ง</Button></div>
          : canApprove ? <p className="request-confirm-note">ว่างอยู่ {room!.availableSlots} ที่ · หลังอนุมัติจะเหลือ {room!.availableSlots - 1} ที่</p>
            : <p className="form-alert" role="alert">ห้องนี้เต็มหรือปิดรับคำขอแล้ว กรุณาปิดหน้าต่างและตรวจสอบห้องอีกครั้ง</p>)}
      {!stillPending && <p className="form-alert" role="alert">คำขอนี้ถูกจัดการแล้ว กรุณาปิดหน้าต่างเพื่อดูสถานะล่าสุด</p>}
      {actionError && <p className="form-alert" role="alert">{actionError}</p>}
    </Modal>}
  </div>;
}

function RequestSection({ icon, title, count, children }: { icon: React.ReactNode; title: string; count: number; children: React.ReactNode }) { return <section className="request-section"><header><span>{icon}</span><h2>{title}</h2><i>{count}</i></header><div className="request-list">{children}</div></section>; }
function MiniEmpty({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) { return <div className="mini-empty"><span>{icon}</span><h3>{title}</h3><p>{text}</p></div>; }
function formatDate(value?: string) { return value ? new Date(value).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }) : '-'; }
