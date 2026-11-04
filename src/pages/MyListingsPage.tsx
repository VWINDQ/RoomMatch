import { Building2, Edit3, Eye, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../AppContext';
import { PageHeader } from '../components/Layout';
import { Price, RoomImage } from '../components/RoomCard';
import { Button, EmptyState, Modal, SkeletonGrid, StatusBadge } from '../components/UI';
import { api } from '../lib/api';
import type { Room } from '../types';

export function MyListingsPage() {
  const navigate = useNavigate(); const { notify } = useApp(); const [rooms, setRooms] = useState<Room[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [deleting, setDeleting] = useState<Room | null>(null); const [busy, setBusy] = useState(false); const [reload, setReload] = useState(0);
  useEffect(() => { let active = true; setLoading(true); setError(''); api.myRooms().then(value => active && setRooms(value)).catch(caught => active && setError(caught instanceof Error ? caught.message : 'โหลดประกาศไม่สำเร็จ')).finally(() => active && setLoading(false)); return () => { active = false; }; }, [reload]);
  const remove = async () => { if (!deleting) return; setBusy(true); try { await api.deleteRoom(deleting.roomId); setRooms(current => current.filter(room => room.roomId !== deleting.roomId)); setDeleting(null); notify('ลบประกาศแล้ว'); } catch (caught) { notify(caught instanceof Error ? caught.message : 'ลบประกาศไม่สำเร็จ'); } finally { setBusy(false); } };
  const toggleStatus = async (room: Room) => { const status = room.status === 'inactive' ? 'available' : 'inactive'; try { const updated = await api.updateRoom(room.roomId, { status }); setRooms(current => current.map(item => item.roomId === room.roomId ? { ...item, ...updated } : item)); notify(status === 'inactive' ? 'พักประกาศแล้ว' : 'เปิดประกาศแล้ว'); } catch (caught) { notify(caught instanceof Error ? caught.message : 'อัปเดตสถานะไม่สำเร็จ'); } };
  return <div className="page"><PageHeader title="ประกาศของฉัน" subtitle="ดูแลข้อมูล ราคา และสถานะห้องที่คุณลงประกาศ" actions={<Button onClick={() => navigate('/my-listings/new')}><Plus size={18}/>ลงประกาศใหม่</Button>}/>
    {loading ? <SkeletonGrid/> : error ? <EmptyState icon={<RefreshCw/>} title="โหลดประกาศไม่สำเร็จ" text={error} action={<Button onClick={() => setReload(value => value + 1)}>ลองอีกครั้ง</Button>}/> : rooms.length ? <div className="listing-stack">{rooms.map(room => <article className="my-listing" key={room.roomId}><RoomImage room={room}/><div className="my-listing-main"><div><StatusBadge status={room.status}/><h2>{room.title}</h2><p>ว่าง {room.availableSlots} ที่ · ลงประกาศ {room.createdAt ? new Date(room.createdAt).toLocaleDateString('th-TH') : '-'}</p></div><Price amount={room.price} compact/></div>
      <div className="listing-actions"><Button variant="quiet" onClick={() => navigate(`/rooms/${room.roomId}`)}><Eye size={17}/><span className="desktop-action">ดูรายละเอียด</span><span className="mobile-action">ดู</span></Button><Button variant="secondary" onClick={() => navigate(`/my-listings/${room.roomId}/edit`)}><Edit3 size={17}/>แก้ไข</Button><button className="status-toggle" onClick={() => toggleStatus(room)}>{room.status === 'inactive' ? 'เปิดประกาศ' : 'พักประกาศ'}</button><button className="delete-action" onClick={() => setDeleting(room)} aria-label={`ลบ ${room.title}`}><Trash2 size={17}/></button></div></article>)}</div> : <EmptyState icon={<Building2/>} title="ยังไม่มีประกาศของคุณ" text="ลงประกาศห้องแรกเพื่อเริ่มรับคำขอจากเพื่อนใหม่" action={<Button onClick={() => navigate('/my-listings/new')}><Plus size={17}/>ลงประกาศห้อง</Button>}/>}
    {deleting && <Modal title="ลบประกาศนี้?" onClose={() => !busy && setDeleting(null)} actions={<><Button variant="quiet" disabled={busy} onClick={() => setDeleting(null)}>ยกเลิก</Button><Button variant="danger" loading={busy} onClick={remove}>ลบประกาศ</Button></>}><p>“{deleting.title}” และคำขอที่เกี่ยวข้องจะไม่แสดงในรายการอีก</p></Modal>}
  </div>;
}
