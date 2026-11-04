import { ArrowLeft, CalendarDays, ExternalLink, MapPin, RefreshCw, ShieldCheck, UserRound, UsersRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../AppContext';
import { RoomGallery } from '../components/RoomGallery';
import { ProfilePhoto } from '../components/ProfilePhoto';
import { Price } from '../components/RoomCard';
import { Button, EmptyState, StatusBadge } from '../components/UI';
import { api } from '../lib/api';
import type { Room } from '../types';

export function RoomDetailPage() {
  const { id = '' } = useParams(); const navigate = useNavigate(); const { notify } = useApp();
  const [room, setRoom] = useState<Room | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [sending, setSending] = useState(false); const [reload, setReload] = useState(0);
  const [requestError, setRequestError] = useState('');
  useEffect(() => { let active = true; setLoading(true); setError(''); api.room(id).then(value => active && setRoom(value)).catch(caught => active && setError(caught instanceof Error ? caught.message : 'โหลดห้องไม่สำเร็จ')).finally(() => active && setLoading(false)); return () => { active = false; }; }, [id, reload]);
  const requestRoom = async () => { if (!room || sending) return; setRequestError(''); setSending(true); try { const request = await api.createJoinRequest(room.roomId); setRoom(current => current ? { ...current, requestStatus: request.status } : current); notify('ส่งคำขอเข้าพักแล้ว'); } catch (caught) { setRequestError(caught instanceof Error ? caught.message : 'ส่งคำขอไม่สำเร็จ'); } finally { setSending(false); } };
  if (loading) return <div className="page"><div className="detail-skeleton"><span/><span/><span/></div></div>;
  if (error || !room) return <div className="page"><EmptyState icon={<RefreshCw/>} title="เปิดประกาศนี้ไม่ได้" text={error || 'ไม่พบประกาศห้องนี้'} action={<Button onClick={() => setReload(value => value + 1)}>ลองอีกครั้ง</Button>}/></div>;
  const requestLabel = room.requestStatus === 'pending' ? 'ส่งคำขอแล้ว · รอพิจารณา' : room.requestStatus === 'approved' ? 'คุณเป็นสมาชิกห้องนี้แล้ว' : room.status !== 'available' || room.availableSlots < 1 ? 'ห้องนี้เต็มแล้ว' : 'ขอเข้าพักห้องนี้';
  return <div className="page detail-page"><button className="back-link" onClick={() => navigate('/rooms')}><ArrowLeft size={18}/>กลับไปดูห้องทั้งหมด</button>
    <div className="detail-title"><div><StatusBadge status={room.status}/><h1>{room.title}</h1><p><MapPin size={16}/>{room.googleMapsUrl ? 'ดูตำแหน่งจากลิงก์แผนที่' : 'ยังไม่ระบุตำแหน่ง'}</p></div></div><RoomGallery room={room}/>
    <div className="detail-layout"><div className="detail-main"><section><h2>เกี่ยวกับห้องนี้</h2><p className="description">{room.description || 'เจ้าของห้องยังไม่ได้เพิ่มรายละเอียด'}</p><div className="fact-row"><span><UsersRound/>จุ {room.capacity} คน (รวมเจ้าของ)</span><span><UserRound/>ว่าง {room.availableSlots} ที่</span><span><CalendarDays/>ลงประกาศ {room.createdAt ? new Date(room.createdAt).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }) : '-'}</span></div></section>
      <section className="capacity-note"><ShieldCheck/><div><h2>จำนวนผู้พักคิดรวมเจ้าของห้อง</h2><p>เมื่อห้องเต็ม ระบบจะหยุดรับคำขอใหม่โดยอัตโนมัติ</p></div></section>
      <section><h2>สมาชิกห้อง</h2><div className="detail-member-list"><Member person={room.owner} label="เจ้าของห้อง"/>{room.members?.map(member => <Member key={member.userId} person={member.user} label="สมาชิก"/>)}</div></section>
      {room.googleMapsUrl && <section className="map-preview"><div><MapPin/><span><strong>ตำแหน่งห้อง</strong><small>เปิด Google Maps ในแท็บใหม่</small></span></div><a className="button button-secondary" href={room.googleMapsUrl} target="_blank" rel="noreferrer">ดูบนแผนที่ <ExternalLink size={16}/></a></section>}
    </div><aside className="detail-sidebar"><Price amount={room.price}/><StatusBadge status={room.status}/><hr/><h2>เจ้าของประกาศ</h2><div className="owner-mini"><span><ProfilePhoto src={room.owner?.profileImage || ''} fallback={room.owner?.firstName?.charAt(0) || 'R'}/></span><div><strong>{room.owner ? `${room.owner.firstName} ${room.owner.lastName}` : 'สมาชิก RoomMatch'}</strong><small>{room.owner?.university || 'ผู้ลงประกาศ'}</small></div></div>
      {room.isOwner ? <Button className="w-full" onClick={() => navigate(`/my-listings/${room.roomId}/edit`)}>แก้ไขประกาศของฉัน</Button> : <Button className="w-full" loading={sending} disabled={room.requestStatus === 'pending' || room.requestStatus === 'approved' || room.status !== 'available' || room.availableSlots < 1} onClick={requestRoom}>{requestLabel}</Button>}
      {requestError && <p className="form-alert" role="alert">{requestError}</p>}
      {room.requestStatus === 'rejected' && <p className="inline-note">คำขอก่อนหน้าไม่ได้รับการอนุมัติ</p>}<Link className="detail-text-link" to="/requests">ดูสถานะคำขอทั้งหมด</Link>
    </aside></div>
  </div>;
}

function Member({ person, label }: { person?: { firstName?: string; lastName?: string; profileImage?: string }; label: string }) {
  return <div className="detail-member"><span><ProfilePhoto src={person?.profileImage || ''} fallback={person?.firstName?.charAt(0) || 'R'}/></span><div><strong>{person ? `${person.firstName || ''} ${person.lastName || ''}`.trim() : 'สมาชิก RoomMatch'}</strong><small>{label}</small></div></div>;
}
