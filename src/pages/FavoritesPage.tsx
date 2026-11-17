import { Heart, RefreshCw } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { RoomGrid } from '../components/RoomCard';
import { Button, EmptyState, SkeletonGrid } from '../components/UI';
import { api } from '../lib/api';
import { Pagination, pageRange, PersonalListToolbar } from '../components/Pagination';
import { useRoomPagination } from '../lib/useRoomPagination';

export function FavoritesPage() {
  const navigate = useNavigate();
  const { rooms, page: currentPage, total, totalPages, params, loading, error, refresh, changeParams } = useRoomPagination(api.favoritesPage, 12);
  const restoreFavoriteFocus = useRef(false);
  const page = useRef<HTMLDivElement>(null);
  const filtered = ['status', 'q', 'minPrice', 'maxPrice', 'minSlots', 'priceBasis'].some(key => Boolean(params.get(key)));

  useEffect(() => {
    if (loading || !restoreFavoriteFocus.current) return;
    restoreFavoriteFocus.current = false;
    const target = page.current?.querySelector<HTMLElement>('.favorite-button') || page.current?.querySelector<HTMLElement>('h1');
    if (target) { if (target.tagName === 'H1') target.tabIndex = -1; target.focus(); }
  }, [loading]);
  const handleFavoriteChange = (_roomId: string, isFavorite: boolean) => {
    if (!isFavorite) { restoreFavoriteFocus.current = true; refresh(); }
  };

  return (
    <div ref={page} className="page favorites-page">
      <PageHeader
        title="ห้องโปรด"
        subtitle="ห้องที่คุณบันทึกไว้"
      />

      <PersonalListToolbar count={loading ? 'กำลังค้นหา…' : error ? 'ยังโหลดจำนวนห้องไม่ได้' : pageRange(currentPage, 12, rooms.length, total)} status={params.get('status') || ''} sort={params.get('sort') || 'saved'} favorites onChange={changeParams}/>
      {loading ? (
        <SkeletonGrid />
      ) : error ? (
        <EmptyState
          icon={<RefreshCw />}
          title="โหลดห้องโปรดไม่สำเร็จ"
          text={error}
          action={
            <Button onClick={() => refresh()}>
              ลองอีกครั้ง
            </Button>
          }
        />
      ) : rooms.length ? (
        <RoomGrid rooms={rooms} onFavoriteChange={handleFavoriteChange} />
      ) : (
        <EmptyState
          icon={<Heart />}
          title={filtered ? 'ไม่พบห้องโปรดที่ตรงกับเงื่อนไข' : 'ยังไม่มีห้องโปรด'}
          text={filtered ? 'ลองเปลี่ยนตัวกรองเพื่อดูห้องโปรดอื่น' : 'กดหัวใจบนการ์ดห้องเพื่อบันทึกห้องที่สนใจ'}
          action={
            <Button onClick={() => navigate('/rooms')}>
              ไปดูห้องทั้งหมด
            </Button>
          }
        />
      )}
      {!error && <Pagination page={currentPage} totalPages={totalPages} busy={loading} onChange={number => changeParams({ page: String(number) })}/>}
    </div>
  );
}
