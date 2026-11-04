import { CalendarDays, MapPin, UsersRound } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { Room } from '../types';
import { StatusBadge } from './UI';
import { RoomPhoto } from './RoomPhoto';

export function Price({ amount, compact = false }: { amount: number; compact?: boolean }) { return <p className={`price ${compact ? 'compact' : ''}`}><strong>฿{amount.toLocaleString('th-TH')}</strong><span>/ เดือน</span></p>; }
export function RoomImage({ room, className = '' }: { room: Room; className?: string }) { return <RoomPhoto className={className} src={room.images[0]?.imageUrl} alt={`ภาพห้อง ${room.title}`}/>; }

export function RoomCard({ room }: { room: Room }) {
  const navigate = useNavigate(); const open = () => navigate(`/rooms/${room.roomId}`);
  return <article className={`room-card ${room.status !== 'available' ? 'is-unavailable' : ''}`} tabIndex={0} onClick={open} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } }}>
    <div className="room-card-image"><RoomImage room={room}/><StatusBadge status={room.status}/></div><div className="room-card-copy">
      <div className="room-title-price"><h2>{room.title}</h2><Price amount={room.price} compact/></div>
      <p className="location"><MapPin size={15}/><span>{room.googleMapsUrl ? 'มีตำแหน่งบนแผนที่' : 'ยังไม่ระบุตำแหน่ง'}</span></p>
      <div className="room-card-meta"><span><UsersRound size={15}/>ว่าง {room.availableSlots} ที่ · จุ {room.capacity} คน</span><span><CalendarDays size={15}/>{room.createdAt ? new Date(room.createdAt).toLocaleDateString('th-TH') : '-'}</span></div>
    </div>
  </article>;
}

export function RoomGrid({ rooms }: { rooms: Room[] }) { return <div className="room-grid">{rooms.map(room => <RoomCard key={room.roomId} room={room}/>)}</div>; }
