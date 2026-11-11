import { Heart, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { RoomGrid } from '../components/RoomCard';
import { Button, EmptyState, SkeletonGrid } from '../components/UI';
import { api } from '../lib/api';
import type { Room } from '../types';

export function FavoritesPage() {
  const navigate = useNavigate();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');

    api.favorites()
      .then(value => {
        if (active) setRooms(value);
      })
      .catch(caught => {
        if (active) {
          setError(caught instanceof Error ? caught.message : 'โหลดห้องโปรดไม่สำเร็จ');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [reload]);

  const handleFavoriteChange = (roomId: string, isFavorite: boolean) => {
    if (!isFavorite) {
      setRooms(current => current.filter(room => room.roomId !== roomId));
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="ห้องโปรด"
        subtitle="ห้องที่คุณบันทึกไว้"
      />

      {loading ? (
        <SkeletonGrid />
      ) : error ? (
        <EmptyState
          icon={<RefreshCw />}
          title="โหลดห้องโปรดไม่สำเร็จ"
          text={error}
          action={
            <Button onClick={() => setReload(value => value + 1)}>
              ลองอีกครั้ง
            </Button>
          }
        />
      ) : rooms.length ? (
        <RoomGrid rooms={rooms} onFavoriteChange={handleFavoriteChange} />
      ) : (
        <EmptyState
          icon={<Heart />}
          title="ยังไม่มีห้องโปรด"
          text="กดหัวใจบนการ์ดห้องเพื่อบันทึกห้องที่สนใจ"
          action={
            <Button onClick={() => navigate('/rooms')}>
              ไปดูห้องทั้งหมด
            </Button>
          }
        />
      )}
    </div>
  );
}