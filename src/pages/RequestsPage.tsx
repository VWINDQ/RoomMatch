import { ProfilePhoto } from '../components/ProfilePhoto';
import { ArrowUpRight, Inbox, RefreshCw, Send, UserCheck, UserRound, UserX } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { useApp } from '../AppContext';
import { useOwnerRequests } from '../OwnerRequestsContext';
import { PageHeader } from '../components/Layout';
import { RequesterProfileModal } from '../components/RequesterProfileModal';
import { Button, EmptyState, Modal, StatusBadge } from '../components/UI';
import { api, ApiError } from '../lib/api';
import type { JoinRequest, Room } from '../types';

type RequestView = 'incoming' | 'sent';
type Decision = { request: JoinRequest; status: 'approved' | 'rejected'; fromProfile: boolean };

export function RequestsPage() {
  const { notify } = useApp();
  const [mine, setMine] = useState<JoinRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [reload, setReload] = useState(0);
  const { ownerRequests: owner, loading: ownerLoading, error: ownerError, refreshOwnerRequests, updateOwnerRequest } = useOwnerRequests();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const view = (['incoming', 'sent'].includes(params.get('view') || '') ? params.get('view') : null) as RequestView | null;
  const setView = (value: RequestView) => setParams(current => { const next = new URLSearchParams(current); next.set('view', value); return next; }, { replace: true });
  const [withdrawing, setWithdrawing] = useState<JoinRequest | null>(null);
  const [cancelError, setCancelError] = useState('');
  const sentTab = useRef<HTMLButtonElement>(null);
  const cancelFeedback = useRef<HTMLParagraphElement>(null);
  const decisionFeedback = useRef<HTMLParagraphElement>(null);
  const [cancelNeedsRefresh, setCancelNeedsRefresh] = useState(false);
  const currentWithdrawal = withdrawing ? mine.find(request => request.requestId === withdrawing.requestId) || withdrawing : null;
  useEffect(() => { if (cancelError && !busyId) cancelFeedback.current?.focus(); }, [cancelError, busyId]);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [selectedRequester, setSelectedRequester] = useState<JoinRequest | null>(null);
  const [actionError, setActionError] = useState('');
  const [room, setRoom] = useState<Room | null>(null);
  const [roomLoading, setRoomLoading] = useState(false);
  const [roomError, setRoomError] = useState('');
  const [roomReload, setRoomReload] = useState(0);
  const [approvedNotice, setApprovedNotice] = useState(false);
  const incomingTab = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (actionError && !busyId) decisionFeedback.current?.focus(); }, [actionError, busyId]);
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

  const openDecision = (request: JoinRequest, status: Decision['status'], fromProfile = false) => {
    setActionError(''); setRoom(null); setRoomError(''); setRoomLoading(status === 'approved');
    setSelectedRequester(null);
    setDecision({ request, status, fromProfile });
  };
  const closeDecision = () => { if (!busyId) { if (decision?.fromProfile) setSelectedRequester(owner.find(request => request.requestId === decision.request.requestId) || decision.request); setDecision(null); setActionError(''); } };
  const stillPending = decision && owner.some(request => request.requestId === decision.request.requestId && request.status === 'pending');
  const canApprove = room && room.status === 'available' && room.availableSlots > 0;
  const decide = async () => {
    if (!decision || busyId || ownerError || !stillPending || (decision.status === 'approved' && !canApprove)) return;
    const { request, status } = decision;
    setActionError(''); setBusyId(request.requestId);
    try {
      const updated = await api.decideRequest(request.requestId, status);
      updateOwnerRequest(updated);
      setDecision(null);
      if (status === 'approved') setApprovedNotice(true);
      notify(status === 'approved' ? 'อนุมัติคำขอและเพิ่มสมาชิกแล้ว' : 'ปฏิเสธคำขอแล้ว');
      window.requestAnimationFrame(() => incomingTab.current?.focus());
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'ดำเนินการไม่สำเร็จ');
      if (caught instanceof ApiError && caught.status === 409) {
        await refreshOwnerRequests();
        setRoomReload(value => value + 1);
      }
    } finally { setBusyId(''); }
  };

  const closeWithdrawal = () => {
    if (busyId) return;
    setWithdrawing(null);
    if (currentWithdrawal?.status !== 'pending') requestAnimationFrame(() => sentTab.current?.focus());
  };
  const refreshSentRequests = async () => {
    const latest = await api.mineRequests();
    setMine(latest); setCancelNeedsRefresh(false);
  };
  const retryWithdrawalStatus = async () => {
    if (busyId || !withdrawing) return;
    setBusyId(withdrawing.requestId);
    try { await refreshSentRequests(); setCancelError(''); }
    catch (caught) { setCancelError(caught instanceof Error ? caught.message : 'ตรวจสถานะล่าสุดไม่สำเร็จ'); }
    finally { setBusyId(''); }
  };
  const withdraw = async () => {
    if (!currentWithdrawal || currentWithdrawal.status !== 'pending' || cancelNeedsRefresh || busyId) return;
    setBusyId(currentWithdrawal.requestId); setCancelError('');
    try {
      const updated = await api.cancelRequest(currentWithdrawal.requestId);
      setMine(current => current.map(item => item.requestId === updated.requestId ? updated : item));
      setWithdrawing(null); notify('ถอนคำขอแล้ว ประวัติยังอยู่ และคุณขอห้องใหม่ได้');
      requestAnimationFrame(() => sentTab.current?.focus());
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'ถอนคำขอไม่สำเร็จ';
      setCancelError(message);
      if (caught instanceof ApiError && caught.status === 409) {
        setCancelNeedsRefresh(true);
        try { await refreshSentRequests(); }
        catch { setCancelError(`${message} ยังตรวจสถานะล่าสุดไม่ได้ กรุณากดอัปเดตสถานะคำขอ`); }
      }
    }
    finally { setBusyId(''); }
  };
  const roomLinkState = (request: JoinRequest) => ({ from: location.pathname + location.search, focusReturnId: `request-${request.requestId}` });
  const ownerCard = (request: JoinRequest) => <article id={`request-${request.requestId}`} tabIndex={-1} className="request-card owner-request-card" key={request.requestId}>
    <div className="request-person"><ProfilePhoto src={request.requester?.profileImage || ''} fallback={request.requester?.firstName?.charAt(0) || 'R'}/></div>
    <div className="request-copy"><StatusBadge status={request.status}/><h3>{request.requester?.firstName} {request.requester?.lastName}</h3><p>ขอเข้าพักที่ {request.room?.title || 'ห้องของคุณ'} · {formatDate(request.requestedAt)}</p>{request.status === 'approved' && request.membershipActive === false && <p>ผู้ขอออกจากห้องแล้ว</p>}<button type="button" className="request-profile-link" disabled={Boolean(busyId)} onClick={() => setSelectedRequester(request)}><UserRound size={16}/>ดูโปรไฟล์</button></div>
    {request.status === 'pending' ? <div className="request-actions">
      <Button variant="secondary" disabled={Boolean(busyId)} onClick={() => openDecision(request, 'approved')}><UserCheck/>อนุมัติ</Button>
      <Button variant="quiet" disabled={Boolean(busyId)} onClick={() => openDecision(request, 'rejected')}><UserX/>ปฏิเสธ</Button>
    </div> : <div className="request-history-actions"><Link className="button button-quiet" to={`/rooms/${request.room?.roomId}`} state={roomLinkState(request)}><ArrowUpRight size={17}/>ดูห้อง</Link>{request.status === 'approved' && request.membershipActive !== false && <Link className="request-profile-link" to="/matches">ดูสมาชิกห้อง</Link>}</div>}
  </article>;

  return <div className="page requests-page">
    <PageHeader title="คำขอเข้าพัก" subtitle="ติดตามคำขอของคุณ และจัดการคำขอสำหรับห้องที่คุณเป็นเจ้าของ"/>
    <nav className="request-tabs" aria-label="หมวดคำขอเข้าพัก">
      <button ref={incomingTab} className={activeView === 'incoming' ? 'selected' : ''} aria-pressed={activeView === 'incoming'} onClick={() => setView('incoming')}><Inbox size={18}/>คำขอถึงฉัน{pending.length > 0 && <span>{pending.length}</span>}</button>
      <button ref={sentTab} className={activeView === 'sent' ? 'selected' : ''} aria-pressed={activeView === 'sent'} onClick={() => setView('sent')}><Send size={18}/>คำขอที่ฉันส่ง</button>
    </nav>
    {approvedNotice && <p className="success-next-step" role="status">อนุมัติและเพิ่มสมาชิกแล้ว <Link to="/matches">ดูสมาชิกห้องและช่องทางติดต่อ</Link></p>}
    {viewLoading ? <div className="request-skeleton" aria-label="กำลังโหลดคำขอ"><span/><span/><span/></div>
      : viewError ? <EmptyState icon={<RefreshCw/>} title="โหลดคำขอไม่สำเร็จ" text={viewError} action={<Button onClick={() => { setReload(value => value + 1); void refreshOwnerRequests(); }}>ลองอีกครั้ง</Button>}/>
      : <div className="request-panel">{activeView === 'incoming'
        ? <RequestSection icon={<Inbox/>} title="คำขอถึงฉัน" count={pending.length}>
          {owner.length ? <>{pending.length > 0 ? <><p className="request-group-label">รอพิจารณา {pending.length} คำขอ</p>{pending.map(ownerCard)}</> : <p className="request-group-label">ไม่มีคำขอรอพิจารณาแล้ว</p>}
            {history.length > 0 && <><p className="request-group-label request-history-label">ประวัติคำขอ · {history.length} รายการ</p>{history.map(ownerCard)}</>}</>
            : <MiniEmpty icon={<Inbox/>} title="ยังไม่มีคำขอเข้ามา" text="คำขอจากผู้สนใจห้องของคุณจะปรากฏที่นี่"/>}
        </RequestSection>
        : <RequestSection icon={<Send/>} title="คำขอที่ฉันส่ง" count={mine.length}>
          {mine.length ? mine.map(request => <article id={`request-${request.requestId}`} tabIndex={-1} className="request-card" key={request.requestId}><div className="request-person room-request-icon"><Send/></div><div className="request-copy"><StatusBadge status={request.status}/><h3>{request.room?.title || 'ประกาศห้อง'}</h3><p>ส่งเมื่อ {formatDate(request.requestedAt)}</p>{request.status === 'pending' && <p className="request-next-step">รอเจ้าของห้องพิจารณา ดูผลที่หน้านี้ หากเปลี่ยนแผนคุณถอนคำขอได้</p>}{request.status === 'approved' && request.membershipActive !== false && <p className="request-next-step">คุณเป็นสมาชิกห้องแล้ว ดูเพื่อนร่วมห้องและช่องทางติดต่อได้ที่สมาชิกห้อง</p>}{request.status === 'rejected' && <p className="request-next-step">เจ้าของไม่อนุมัติคำขอนี้ คุณเลือกห้องอื่น หรือส่งคำขอใหม่ได้หากห้องยังเปิดรับ</p>}{request.status === 'approved' && request.membershipActive === false && <p>คำขอนี้เคยได้รับอนุมัติ ขณะนี้คุณออกจากห้องแล้ว</p>}{request.status === 'cancelled' && <p>คุณถอนคำขอนี้แล้ว หากห้องยังว่างสามารถส่งคำขอใหม่ได้</p>}</div><div className="request-history-actions"><Link className="button button-quiet" to={`/rooms/${request.room?.roomId}`} state={roomLinkState(request)}><ArrowUpRight size={17}/>ดูห้อง</Link>{request.status === 'pending' && <Button variant="quiet" disabled={Boolean(busyId)} onClick={() => { setCancelError(''); setCancelNeedsRefresh(false); setWithdrawing(request); }}>ถอนคำขอ</Button>}{request.status === 'approved' && request.membershipActive !== false && <Link className="request-profile-link" to="/matches">ดูสมาชิกห้อง</Link>}</div></article>)
            : <MiniEmpty icon={<Inbox/>} title="ยังไม่ได้ส่งคำขอ" text="เมื่อเจอห้องที่สนใจ คุณส่งคำขอได้จากหน้ารายละเอียดห้อง" action={<Link className="button button-secondary" to="/rooms">ค้นหาห้อง</Link>}/>}

        </RequestSection>}</div>}
    {withdrawing && <Modal title="ถอนคำขอเข้าพัก?" onClose={closeWithdrawal} actions={<><Button variant="quiet" disabled={Boolean(busyId)} onClick={closeWithdrawal}>{currentWithdrawal?.status === 'pending' ? 'เก็บคำขอไว้' : 'กลับไปดูสถานะ'}</Button><Button variant="danger" loading={Boolean(busyId)} disabled={cancelNeedsRefresh || currentWithdrawal?.status !== 'pending'} onClick={withdraw}>ยืนยันถอนคำขอ</Button></>}><p>ถอนคำขอสำหรับ “{withdrawing.room?.title}” เจ้าของห้องจะเห็นว่าคุณถอนแล้ว ประวัติจะยังอยู่และส่งคำขอใหม่ได้หากห้องยังว่าง</p>{currentWithdrawal?.status !== 'pending' && <p className="inline-note" role="status">{currentWithdrawal?.status === 'approved' ? 'คำขอนี้ได้รับอนุมัติแล้ว จึงถอนไม่ได้ ดูข้อมูลสมาชิกปัจจุบันได้ที่รายการคำขอ' : 'คำขอนี้ไม่ได้รอพิจารณาแล้ว ดูสถานะล่าสุดได้ที่รายการคำขอ'}</p>}{cancelError && <p ref={cancelFeedback} tabIndex={-1} className="form-alert" role="alert">{cancelError}</p>}{cancelNeedsRefresh && <Button variant="secondary" loading={Boolean(busyId)} onClick={retryWithdrawalStatus}>อัปเดตสถานะคำขอ</Button>}</Modal>}
    {selectedRequester && <RequesterProfileModal key={selectedRequester.requestId} request={owner.find(request => request.requestId === selectedRequester.requestId) || selectedRequester} onClose={() => setSelectedRequester(null)} onDecide={status => openDecision(selectedRequester, status, true)}/>}
    {decision && <Modal title={decision.status === 'approved' ? 'ยืนยันอนุมัติเข้าพัก' : 'ยืนยันปฏิเสธคำขอ'} onClose={closeDecision} actions={<>
      <Button variant="quiet" disabled={Boolean(busyId)} onClick={closeDecision}>ยกเลิก</Button>
      <Button variant={decision.status === 'approved' ? 'primary' : 'danger'} loading={Boolean(busyId)} disabled={Boolean(ownerError) || !stillPending || (decision.status === 'approved' && (roomLoading || Boolean(roomError) || !canApprove))} onClick={decide}>{decision.status === 'approved' ? 'ยืนยันอนุมัติ' : 'ยืนยันปฏิเสธ'}</Button>
    </>}>
      <div className="request-confirm-summary"><strong>{`${decision.request.requester?.firstName || ''} ${decision.request.requester?.lastName || ''}`.trim() || 'ผู้ขอเข้าพัก'}</strong><span>{decision.request.room?.title || 'ห้องของคุณ'}</span></div>
      <p className="request-confirm-message">{decision.status === 'approved' ? 'เมื่อยืนยัน ผู้ขอจะเป็นสมาชิกห้อง และทั้งสองฝ่ายจะเห็นข้อมูลในเมนูสมาชิกห้องพร้อมช่องทางติดต่อ' : 'เมื่อยืนยัน ผู้ขอจะเห็นสถานะไม่อนุมัติ หากห้องยังรับอยู่ ผู้ขอสามารถส่งคำขอใหม่ได้'}</p>
      {decision.status === 'approved' && (roomLoading ? <p className="request-confirm-note" role="status">กำลังตรวจสอบที่ว่างล่าสุด…</p>
        : roomError ? <div className="request-confirm-note"><p role="alert">ตรวจสอบที่ว่างไม่สำเร็จ: {roomError}</p><Button variant="secondary" onClick={() => setRoomReload(value => value + 1)}>ลองตรวจสอบอีกครั้ง</Button></div>
          : canApprove ? <p className="request-confirm-note">ว่างอยู่ {room!.availableSlots} ที่ · หลังอนุมัติจะเหลือ {room!.availableSlots - 1} ที่</p>
            : <p className="form-alert" role="alert">{room?.status === 'inactive' ? 'ประกาศนี้พักรับคำขออยู่ เปิดรับในหน้าประกาศของฉันก่อนอนุมัติ' : 'ห้องนี้เต็มแล้ว จึงอนุมัติสมาชิกเพิ่มไม่ได้'}</p>)}
      {!stillPending && <p className="form-alert" role="alert">คำขอนี้ถูกจัดการแล้ว กรุณาปิดหน้าต่างเพื่อดูสถานะล่าสุด</p>}
      {ownerError && <div className="request-confirm-note"><p role="alert">ยังตรวจสถานะคำขอล่าสุดไม่ได้: {ownerError}</p><Button variant="secondary" disabled={Boolean(busyId)} onClick={() => { void refreshOwnerRequests(); }}>อัปเดตสถานะคำขอ</Button></div>}{actionError && <p ref={decisionFeedback} tabIndex={-1} className="form-alert" role="alert">{actionError}</p>}
    </Modal>}
  </div>;
}

function RequestSection({ icon, title, count, children }: { icon: React.ReactNode; title: string; count: number; children: React.ReactNode }) { return <section className="request-section"><header><span>{icon}</span><h2>{title}</h2><i>{count}</i></header><div className="request-list">{children}</div></section>; }
function MiniEmpty({ icon, title, text, action }: { icon: React.ReactNode; title: string; text: string; action?: React.ReactNode }) { return <div className="mini-empty"><span>{icon}</span><h3>{title}</h3><p>{text}</p>{action}</div>; }
function formatDate(value?: string) { return value ? new Date(value).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }) : '-'; }
