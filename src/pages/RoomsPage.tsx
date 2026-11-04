import { useEffect, useState } from 'react';
import { RefreshCw, Search, SlidersHorizontal, X } from 'lucide-react';
import { useApp } from '../AppContext';
import { FilterSheet } from '../components/FilterSheet';
import { PageHeader } from '../components/Layout';
import { RoomGrid } from '../components/RoomCard';
import { Button, EmptyState, SkeletonGrid } from '../components/UI';
import { api } from '../lib/api';
import type { Room, RoomFilters } from '../types';
import { FriendSearchContext } from '../components/FriendSearchContext';

const emptyFilters: RoomFilters = { minPrice: '', maxPrice: '', status: '' };

export function RoomsPage() {
  const { user } = useApp(); const [query, setQuery] = useState(''); const [sort, setSort] = useState('newest');
  const [filterOpen, setFilterOpen] = useState(false); const [filters, setFilters] = useState<RoomFilters>(emptyFilters); const [draftFilters, setDraftFilters] = useState<RoomFilters>(emptyFilters);
  const [rooms, setRooms] = useState<Room[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true; const timer = window.setTimeout(async () => {
      setLoading(true); setError(''); const params = new URLSearchParams();
      if (query.trim()) params.set('q', query.trim()); if (filters.minPrice) params.set('minPrice', filters.minPrice); if (filters.maxPrice) params.set('maxPrice', filters.maxPrice); if (filters.status) params.set('status', filters.status); params.set('sort', sort);
      try { const result = await api.rooms(params); if (active) setRooms(result); }
      catch (caught) { if (active) setError(caught instanceof Error ? caught.message : 'โหลดประกาศไม่สำเร็จ'); }
      finally { if (active) setLoading(false); }
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [filters, query, reload, sort]);

  const activeCount = Number(Boolean(filters.minPrice || filters.maxPrice)) + Number(Boolean(filters.status));
  return <div className="page rooms-page"><PageHeader title="รวมประกาศห้อง" subtitle={`สวัสดี ${user?.firstName || ''} — กำลังมองหาห้องแบบไหน?`}/>
    <FriendSearchContext/>
    <section className="search-panel" aria-label="ค้นหาห้อง"><label className="search-input"><Search size={21}/><input aria-label="ค้นหาห้อง" value={query} onChange={event => setQuery(event.target.value)} placeholder="ค้นหาชื่อห้องหรือรายละเอียด"/>{query && <button onClick={() => setQuery('')} aria-label="ล้างคำค้น"><X size={18}/></button>}</label><Button variant="secondary" className="filter-button" onClick={() => { setDraftFilters(filters); setFilterOpen(true); }}><SlidersHorizontal size={18}/>ตัวกรอง{activeCount > 0 && <span>{activeCount}</span>}</Button></section>
    {activeCount > 0 && <div className="active-filter-row"><span>กำลังใช้ตัวกรอง</span>{filters.status && <i>{filters.status === 'available' ? 'ยังมีที่ว่าง' : 'เต็มแล้ว'}</i>}{(filters.minPrice || filters.maxPrice) && <i>฿{filters.minPrice || '0'}–฿{filters.maxPrice || '∞'}</i>}<button onClick={() => setFilters(emptyFilters)}>ล้างทั้งหมด</button></div>}
    <section className="list-section"><div className="list-toolbar"><div><h2>ห้องทั้งหมด</h2><p>{loading ? 'กำลังค้นหา...' : `พบ ${rooms.length} ห้อง`}</p></div><label><span>เรียงตาม</span><select value={sort} onChange={event => setSort(event.target.value)}><option value="newest">ล่าสุด</option><option value="price_asc">ราคาต่ำ → สูง</option><option value="price_desc">ราคาสูง → ต่ำ</option></select></label></div>
      {loading ? <SkeletonGrid/> : error ? <EmptyState icon={<RefreshCw/>} title="โหลดประกาศไม่สำเร็จ" text={error} action={<Button variant="secondary" onClick={() => setReload(value => value + 1)}>ลองอีกครั้ง</Button>}/> : rooms.length ? <RoomGrid rooms={rooms}/> : <EmptyState icon={<Search/>} title="ไม่พบห้องที่ตรงกับเงื่อนไข" text="ลองเปลี่ยนคำค้นหาหรือช่วงราคา" action={<Button variant="secondary" onClick={() => { setQuery(''); setFilters(emptyFilters); }}>ล้างการค้นหา</Button>}/>}
    </section><FilterSheet open={filterOpen} value={draftFilters} onChange={setDraftFilters} onClose={() => setFilterOpen(false)} onApply={() => { setFilters(draftFilters); setFilterOpen(false); }}/>
  </div>;
}
