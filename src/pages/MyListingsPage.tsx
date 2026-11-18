import { Skeleton } from '../components/Skeleton';
import { Building2, Edit3, Eye, Plus, RefreshCw, SlidersHorizontal, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../AppContext';
import { FilterSheetLayout } from '../components/FilterSheet';
import { Price, RoomImage } from '../components/RoomCard';
import { Button, EmptyState, Modal, StatusBadge } from '../components/UI';
import { api, SessionChangedError } from '../lib/api';
import { createListingStatusActions } from '../lib/listingStatus';
import { Pagination, PersonalListFields, PersonalListToolbar } from '../components/Pagination';
import { useRoomPagination } from '../lib/useRoomPagination';
import type { Room } from '../types';

const defaultFilters = { status: '', sort: '' };

export function MyListingsPage() {
  const location = useLocation(); const navigate = useNavigate(); const { notify } = useApp(); const [deleting, setDeleting] = useState<Room | null>(null); const [busy, setBusy] = useState(false);
  const { rooms, setRooms, page, totalPages, params, loading, error, refresh, changeParams, changePage, listStartRef } = useRoomPagination(api.myRoomsPage, 10);
  const status = params.get('status') || '';
  const sort = params.get('sort') || '';
  const [draftFilters, setDraftFilters] = useState<typeof defaultFilters | null>(null);
  const filterOpen = draftFilters !== null;
  const clickedFilterSheet = useRef(false);
  const guardFilterClick = (event: MouseEvent<HTMLDivElement>) => {
    const insideSheet = filterOpen && event.target instanceof Element && Boolean(event.target.closest('.filter-layer'));
    if (event.type === 'click' && event.detail === 1) clickedFilterSheet.current = insideSheet;
    // After the sheet unmounts, a repeated press can move focus and click the listing underneath.
    if (event.detail > 1 && clickedFilterSheet.current && !insideSheet) {
      event.preventDefault();
      if (event.type === 'click') event.stopPropagation();
    }
  };
  const commitFilters = (filters: typeof defaultFilters) => {
    if (filters.status !== status || filters.sort !== sort || params.has('page')) changeParams(filters);
    setDraftFilters(null);
  };
  useEffect(() => {
    if (!filterOpen) return;
    // Match the sidebar breakpoint so resizing clears the dialog's focus trap.
    const sidebar = window.matchMedia('(min-width: 1024px)');
    const closeForSidebar = () => { if (sidebar.matches) setDraftFilters(null); };
    closeForSidebar();
    sidebar.addEventListener('change', closeForSidebar);
    return () => sidebar.removeEventListener('change', closeForSidebar);
  }, [filterOpen]);
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
  return <div className="page my-listings-page" onMouseDownCapture={guardFilterClick} onClickCapture={guardFilterClick}>
    <div className="my-listings-header">
      <header className="my-listings-heading">
        <h1>ประกาศของฉัน</h1>
        <p>ดูแลข้อมูล ราคา และสถานะห้องที่คุณลงประกาศ</p>
      </header>
      <div ref={listStartRef}>
        <div className="my-listings-actions">
          <Button onClick={() => navigate('/my-listings/new', { state: listState })}><Plus size={18}/>ลงประกาศ</Button>
          <Button type="button" variant="secondary" aria-haspopup="dialog" aria-expanded={filterOpen}
            aria-label={status ? 'ตัวกรอง มีตัวกรองสถานะ 1 รายการ' : 'ตัวกรอง'}
            onClick={event => {
              event.currentTarget.focus();
              setDraftFilters({ status, sort });
            }}>
            <SlidersHorizontal size={18}/>ตัวกรอง{status && <span className="my-listings-filter-count" aria-hidden="true">1</span>}
          </Button>
        </div>
        <PersonalListToolbar status={status} sort={sort || 'newest'} onChange={changeParams}/>
      </div>
    </div>
    {draftFilters && <FilterSheetLayout open={filterOpen} title="ตัวกรองประกาศของฉัน"
      onClose={() => setDraftFilters(null)} onReset={() => commitFilters(defaultFilters)}
      onApply={() => commitFilters(draftFilters)}>
      <div className="my-listings-filter-fields field">
        <PersonalListFields status={draftFilters.status} sort={draftFilters.sort || 'newest'}
          onChange={changes => setDraftFilters({ ...draftFilters, ...changes })}/>
      </div>
    </FilterSheetLayout>}
    {loading ? <Skeleton variant="listings"/> : error ? <EmptyState icon={<RefreshCw/>} title="โหลดประกาศไม่สำเร็จ" text={error} action={<Button onClick={() => refresh()}>ลองอีกครั้ง</Button>}/> : rooms.length ? <div className="listing-stack">{rooms.map(room => <article id={`listing-${room.roomId}`} tabIndex={-1} className="my-listing" key={room.roomId}><RoomImage room={room}/><div className="my-listing-main"><div><StatusBadge status={room.status}/><h2>{room.title}</h2><p>ว่าง {room.availableSlots} ที่ · ลงประกาศ {room.createdAt ? new Date(room.createdAt).toLocaleDateString('th-TH') : '-'}</p></div><Price amount={room.price} basis={room.priceBasis} compact/></div>
      <div className="listing-actions"><Button variant="quiet" onClick={() => navigate(`/rooms/${room.roomId}`, { state: { from: location.pathname + location.search, focusReturnId: `listing-${room.roomId}` } })}><Eye size={17}/><span className="desktop-action">ดูรายละเอียด</span><span className="mobile-action">ดู</span></Button><Button variant="secondary" disabled={pendingRooms.has(room.roomId) || deleting?.roomId === room.roomId} onClick={() => { if (!roomLocked(room.roomId)) navigate(`/my-listings/${room.roomId}/edit`, { state: { ...listState, focusReturnId: `listing-${room.roomId}` } }); }}><Edit3 size={17}/>แก้ไข</Button><button className="status-toggle" disabled={pendingRooms.has(room.roomId) || deleting?.roomId === room.roomId} aria-busy={pendingRooms.has(room.roomId)} onClick={() => { if (!roomLocked(room.roomId)) void statusActions.toggle(room); }}>{pendingRooms.has(room.roomId) ? 'กำลังบันทึก…' : room.status === 'inactive' ? 'เปิดประกาศ' : 'พักประกาศ'}</button><button className="delete-action" disabled={pendingRooms.has(room.roomId) || deleting?.roomId === room.roomId} onClick={() => { if (!roomLocked(room.roomId)) setDeleting(room); }} aria-label={`ลบ ${room.title}`}><Trash2 size={17}/></button></div></article>)}</div> : <EmptyState icon={<Building2/>} title={filtered ? 'ไม่พบประกาศที่ตรงกับเงื่อนไข' : 'ยังไม่มีประกาศของคุณ'} text={filtered ? 'ลองเปลี่ยนตัวกรองเพื่อดูประกาศอื่น' : 'ลงประกาศห้องแรกเพื่อเริ่มรับคำขอจากเพื่อนใหม่'} action={<Button className="my-listings-empty-create" onClick={() => navigate('/my-listings/new', { state: listState })}><Plus size={17}/>ลงประกาศห้อง</Button>}/>}
    {!error && <Pagination page={page} totalPages={totalPages} busy={loading || busy || pendingRooms.size > 0} onChange={changePage}/>}
    {deleting && <Modal title="ลบประกาศนี้?" onClose={() => !busy && setDeleting(null)} actions={<><Button variant="quiet" disabled={busy} onClick={() => setDeleting(null)}>ยกเลิก</Button><Button variant="danger" loading={busy} onClick={remove}>ลบประกาศ</Button></>}><p>“{deleting.title}” จะถูกลบพร้อมคำขอ สมาชิก และแมตช์ที่เกี่ยวข้อง หากต้องการเก็บประวัติไว้ให้เลือกพักประกาศแทน</p></Modal>}
  </div>;
}
