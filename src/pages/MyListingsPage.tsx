import { Skeleton } from '../components/Skeleton';
import { Building2, Edit3, Eye, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../AppContext';
import { PageHeader } from '../components/Layout';
import { Price, RoomImage } from '../components/RoomCard';
import { Button, EmptyState, Modal, StatusBadge } from '../components/UI';
import { api, SessionChangedError } from '../lib/api';
import { createListingStatusActions } from '../lib/listingStatus';
import { Pagination, pageRange, PersonalListToolbar } from '../components/Pagination';
import { useRoomPagination } from '../lib/useRoomPagination';
import type { Room } from '../types';

export function MyListingsPage() {
  const location = useLocation(); const navigate = useNavigate(); const { notify } = useApp(); const [deleting, setDeleting] = useState<Room | null>(null); const [busy, setBusy] = useState(false);
  const { rooms, setRooms, page, total, totalPages, params, loading, error, refresh, changeParams, changePage, listStartRef } = useRoomPagination(api.myRoomsPage, 10);
  const deleteLocked = useRef(false);
  const filtered = ['status', 'q', 'minPrice', 'maxPrice', 'minSlots', 'priceBasis'].some(key => Boolean(params.get(key)));
  const listState = { from: location.pathname + location.search };
  const remove = async () => {
    if (!deleting || deleteLocked.current || statusActions.isPending(deleting.roomId)) return;
    deleteLocked.current = true; setBusy(true);
    try { await api.deleteRoom(deleting.roomId); setDeleting(null); refresh(); notify('ลบประกาศแล้ว'); }
    catch (caught) { if (caught instanceof SessionChangedError) return; notify(caught instanceof Error ? caught.message : 'ลบประกาศไม่สำเร็จ'); }
    finally { deleteLocked.current = false; setBusy(false); }
  };
  const [pendingRooms, setPendingRooms] = useState(new Set<string>());
  const [statusActions] = useState(() => createListingStatusActions({
    update: (roomId, payload) => api.updateRoom(roomId, payload),
    onPending: setPendingRooms,
    onUpdated: updated => {
      setRooms(current => current.map(item => item.roomId === updated.roomId ? updated : item));
      refresh();
      notify(updated.status === 'inactive' ? 'พักประกาศแล้ว' : updated.status === 'full' ? 'เปิดประกาศแล้ว (ห้องเต็ม)' : 'เปิดประกาศแล้ว');
    },
    onError: message => notify(message),
  }));
  const roomLocked = (roomId: string) => statusActions.isPending(roomId) || deleting?.roomId === roomId;
  return <div className="page"><PageHeader title="ประกาศของฉัน" subtitle="ดูแลข้อมูล ราคา และสถานะห้องที่คุณลงประกาศ" actions={<Button onClick={() => navigate('/my-listings/new', { state: listState })}><Plus size={18}/>ลงประกาศใหม่</Button>}/>
    <PersonalListToolbar listStartRef={listStartRef} count={loading ? 'กำลังค้นหา…' : error ? 'ยังโหลดจำนวนประกาศไม่ได้' : pageRange(page, 10, rooms.length, total, 'ประกาศ')} status={params.get('status') || ''} sort={params.get('sort') || 'newest'} onChange={changeParams}/>
    {loading ? <Skeleton variant="listings"/> : error ? <EmptyState icon={<RefreshCw/>} title="โหลดประกาศไม่สำเร็จ" text={error} action={<Button onClick={() => refresh()}>ลองอีกครั้ง</Button>}/> : rooms.length ? <div className="listing-stack">{rooms.map(room => <article id={`listing-${room.roomId}`} tabIndex={-1} className="my-listing" key={room.roomId}><RoomImage room={room}/><div className="my-listing-main"><div><StatusBadge status={room.status}/><h2>{room.title}</h2><p>ว่าง {room.availableSlots} ที่ · ลงประกาศ {room.createdAt ? new Date(room.createdAt).toLocaleDateString('th-TH') : '-'}</p></div><Price amount={room.price} basis={room.priceBasis} compact/></div>
      <div className="listing-actions"><Button variant="quiet" onClick={() => navigate(`/rooms/${room.roomId}`, { state: { from: location.pathname + location.search, focusReturnId: `listing-${room.roomId}` } })}><Eye size={17}/><span className="desktop-action">ดูรายละเอียด</span><span className="mobile-action">ดู</span></Button><Button variant="secondary" disabled={pendingRooms.has(room.roomId) || deleting?.roomId === room.roomId} onClick={() => { if (!roomLocked(room.roomId)) navigate(`/my-listings/${room.roomId}/edit`, { state: { ...listState, focusReturnId: `listing-${room.roomId}` } }); }}><Edit3 size={17}/>แก้ไข</Button><button className="status-toggle" disabled={pendingRooms.has(room.roomId) || deleting?.roomId === room.roomId} aria-busy={pendingRooms.has(room.roomId)} onClick={() => { if (!roomLocked(room.roomId)) void statusActions.toggle(room); }}>{pendingRooms.has(room.roomId) ? 'กำลังบันทึก…' : room.status === 'inactive' ? 'เปิดประกาศ' : 'พักประกาศ'}</button><button className="delete-action" disabled={pendingRooms.has(room.roomId) || deleting?.roomId === room.roomId} onClick={() => { if (!roomLocked(room.roomId)) setDeleting(room); }} aria-label={`ลบ ${room.title}`}><Trash2 size={17}/></button></div></article>)}</div> : <EmptyState icon={<Building2/>} title={filtered ? 'ไม่พบประกาศที่ตรงกับเงื่อนไข' : 'ยังไม่มีประกาศของคุณ'} text={filtered ? 'ลองเปลี่ยนตัวกรองเพื่อดูประกาศอื่น' : 'ลงประกาศห้องแรกเพื่อเริ่มรับคำขอจากเพื่อนใหม่'} action={<Button onClick={() => navigate('/my-listings/new', { state: listState })}><Plus size={17}/>ลงประกาศห้อง</Button>}/>}
    {!error && <Pagination page={page} totalPages={totalPages} busy={loading || busy || pendingRooms.size > 0} onChange={changePage}/>}
    {deleting && <Modal title="ลบประกาศนี้?" onClose={() => !busy && setDeleting(null)} actions={<><Button variant="quiet" disabled={busy} onClick={() => setDeleting(null)}>ยกเลิก</Button><Button variant="danger" loading={busy} onClick={remove}>ลบประกาศ</Button></>}><p>“{deleting.title}” จะถูกลบพร้อมคำขอ สมาชิก และแมตช์ที่เกี่ยวข้อง หากต้องการเก็บประวัติไว้ให้เลือกพักประกาศแทน</p></Modal>}
  </div>;
}
