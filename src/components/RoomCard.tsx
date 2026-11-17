import { CalendarDays, Heart, MapPin, UsersRound } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useApp } from '../AppContext';
import { api, SessionChangedError } from '../lib/api';
import type { PriceBasis, Room } from '../types';
import { StatusBadge } from './UI';
import { RoomPhoto } from './RoomPhoto';

export function Price({ amount, basis, compact = false }: { amount: number; basis?: PriceBasis | null; compact?: boolean }) { return <p className={`price ${compact ? 'compact' : ''}`}><strong>฿{amount.toLocaleString('th-TH')}</strong><span>{basis === 'per_room' ? '/ ทั้งห้อง / เดือน' : basis === 'per_person' ? '/ คน / เดือน' : '/ เดือน · ยังไม่ระบุหน่วย'}</span></p>; }
export function RoomImage({ room, className = '' }: { room: Room; className?: string }) { return <RoomPhoto className={className} src={room.images[0]?.imageUrl} alt={`ภาพห้อง ${room.title}`}/>; }

type FavoriteChangeHandler = (roomId: string, isFavorite: boolean) => void;

export function RoomCard({ room, onFavoriteChange }: { room: Room; onFavoriteChange?: FavoriteChangeHandler }) {
  const location = useLocation();
  const { notify } = useApp();
  const [isFavorite, setIsFavorite] = useState(Boolean(room.isFavorite));
  const [saving, setSaving] = useState(false);
  const favoriteLocked = useRef(false);
  const id = `room-card-${room.roomId}`;

  useEffect(() => { setIsFavorite(Boolean(room.isFavorite)); }, [room.isFavorite]);
  const toggleFavorite = async () => {
    if (favoriteLocked.current) return;
    favoriteLocked.current = true;
    setSaving(true);
    try {
      if (isFavorite) await api.removeFavorite(room.roomId); else await api.addFavorite(room.roomId);
      setIsFavorite(!isFavorite);
      onFavoriteChange?.(room.roomId, !isFavorite);
      notify(isFavorite ? 'เอาห้องออกจากรายการโปรดแล้ว' : 'บันทึกห้องโปรดแล้ว');
    } catch (caught) { if (!(caught instanceof SessionChangedError)) notify(caught instanceof Error ? caught.message : 'อัปเดตรายการโปรดไม่สำเร็จ'); }
    finally { favoriteLocked.current = false; setSaving(false); }
  };

  return <article className={`room-card ${room.status !== 'available' ? 'is-unavailable' : ''}`}>
    <Link id={id} className="room-card-link" to={`/rooms/${room.roomId}`} state={{ from: location.pathname + location.search, focusReturnId: id }} aria-label={`ดูห้อง ${room.title}`} onClick={() => sessionStorage.setItem(`roommatch:focus:${location.pathname}${location.search}`, id)}>
      <div className="room-card-image"><RoomImage room={room}/><StatusBadge status={room.status}/></div><div className="room-card-copy">
        <div className="room-title-price"><h2>{room.title}</h2><Price amount={room.price} basis={room.priceBasis} compact/></div>
        <p className="location"><MapPin size={15}/><span>{room.locality || 'เจ้าของยังไม่ระบุย่าน · ดูแผนที่ในรายละเอียด'}</span></p>
        <div className="room-card-meta"><span><UsersRound size={15}/>ว่าง {room.availableSlots} ที่ · จุ {room.capacity} คน</span><span><CalendarDays size={15}/>{room.createdAt ? new Date(room.createdAt).toLocaleDateString('th-TH') : '-'}</span></div>
      </div>
    </Link>
    {/* Keep the favorite control outside the native room link for mouse and keyboard use. */}
    <button type="button" className={`favorite-button ${isFavorite ? 'is-favorite' : ''}`} aria-label={isFavorite ? 'เอาออกจากรายการโปรด' : 'เพิ่มในรายการโปรด'} aria-pressed={isFavorite} disabled={saving} onClick={toggleFavorite}><Heart size={19} fill={isFavorite ? 'currentColor' : 'none'}/></button>
  </article>;
}

export function RoomGrid({ rooms, onFavoriteChange }: { rooms: Room[]; onFavoriteChange?: FavoriteChangeHandler }) {
  return <div className="room-grid">{rooms.map(room => <RoomCard key={room.roomId} room={room} onFavoriteChange={onFavoriteChange}/>)}</div>;
}
