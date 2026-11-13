import { CalendarDays, Heart, MapPin, UsersRound } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { Room } from '../types';
import { StatusBadge } from './UI';
import { RoomPhoto } from './RoomPhoto';
import { useEffect, useState, type MouseEvent } from 'react';
import { useApp } from '../AppContext';
import { api } from '../lib/api';

export function Price({ amount, compact = false }: { amount: number; compact?: boolean }) { return <p className={`price ${compact ? 'compact' : ''}`}><strong>฿{amount.toLocaleString('th-TH')}</strong><span>/ เดือน</span></p>; }
export function RoomImage({ room, className = '' }: { room: Room; className?: string }) { return <RoomPhoto className={className} src={room.images[0]?.imageUrl} alt={`ภาพห้อง ${room.title}`}/>; }

type FavoriteChangeHandler = (roomId: string, isFavorite: boolean) => void;
export function RoomCard({
  room,
  onFavoriteChange,
}: {
  room: Room;
  onFavoriteChange?: FavoriteChangeHandler;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { notify } = useApp();
  const [isFavorite, setIsFavorite] = useState(Boolean(room.isFavorite));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setIsFavorite(Boolean(room.isFavorite));
  }, [room.isFavorite]);

  const open = () =>
  navigate(`/rooms/${room.roomId}`, {
    state: { from: location.pathname + location.search },
  });

const toggleFavorite = async (event: MouseEvent<HTMLButtonElement>) => {
  event.stopPropagation();
  if (saving) return;

  setSaving(true);
  try {
    if (isFavorite) {
      await api.removeFavorite(room.roomId);
      setIsFavorite(false);
      onFavoriteChange?.(room.roomId, false);
      notify('เอาห้องออกจากรายการโปรดแล้ว');
    } else {
      await api.addFavorite(room.roomId);
      setIsFavorite(true);
      onFavoriteChange?.(room.roomId, true);
      notify('บันทึกห้องโปรดแล้ว');
    }
  } catch (caught) {
    notify(caught instanceof Error ? caught.message : 'อัปเดตรายการโปรดไม่สำเร็จ');
  } finally {
    setSaving(false);
  }
};

  return (
    <article
      className={`room-card ${room.status !== 'available' ? 'is-unavailable' : ''}`}
      tabIndex={0}
      onClick={open}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          open();
        }
      }}
    >
      <div className="room-card-image">
        <RoomImage room={room} />
        <StatusBadge status={room.status} />
        <button
          type="button"
          className={`favorite-button ${isFavorite ? 'is-favorite' : ''}`}
          aria-label={isFavorite ? 'เอาออกจากรายการโปรด' : 'เพิ่มในรายการโปรด'}
          aria-pressed={isFavorite}
          disabled={saving}
          onClick={toggleFavorite}
          onKeyDown={event => event.stopPropagation()}
        >
          <Heart size={19} fill={isFavorite ? 'currentColor' : 'none'} />
        </button>
      </div>

      <div className="room-card-copy">
        <div className="room-title-price">
          <h2>{room.title}</h2>
          <Price amount={room.price} compact />
        </div>
        <p className="location">
          <MapPin size={15} />
          <span>{room.googleMapsUrl ? 'มีตำแหน่งบนแผนที่' : 'ยังไม่ระบุตำแหน่ง'}</span>
        </p>
        <div className="room-card-meta">
          <span><UsersRound size={15} />ว่าง {room.availableSlots} ที่ · จุ {room.capacity} คน</span>
          <span><CalendarDays size={15} />{room.createdAt ? new Date(room.createdAt).toLocaleDateString('th-TH') : '-'}</span>
        </div>
      </div>
    </article>
  );
}

export function RoomGrid({
  rooms,
  onFavoriteChange,
}: {
  rooms: Room[];
  onFavoriteChange?: FavoriteChangeHandler;
}) {
  return (
    <div className="room-grid">
      {rooms.map(room => (
        <RoomCard
          key={room.roomId}
          room={room}
          onFavoriteChange={onFavoriteChange}
        />
      ))}
    </div>
  );
}