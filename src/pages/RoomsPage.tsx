import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { RefreshCw, Search, SlidersHorizontal, X } from 'lucide-react';
import { useApp } from '../AppContext';
import { FilterSheet } from '../components/FilterSheet';
import { PageHeader } from '../components/Layout';
import { RoomGrid } from '../components/RoomCard';
import { Button, EmptyState, SkeletonGrid } from '../components/UI';
import { api } from '../lib/api';
import type { Room, RoomFilters } from '../types';
import { FriendSearchContext } from '../components/FriendSearchContext';

const emptyFilters: RoomFilters = { minPrice: '', maxPrice: '', minSlots: '', priceBasis: '' };

export function RoomsPage() {
  const { user } = useApp();
  const [params, setParams] = useSearchParams();
  const query = params.get('q') || '';
  const sort = ['newest', 'price_asc', 'price_desc'].includes(params.get('sort') || '') ? params.get('sort')! : 'newest';
  const filters: RoomFilters = { minPrice: params.get('minPrice') || '', maxPrice: params.get('maxPrice') || '', minSlots: params.get('minSlots') || '', priceBasis: params.get('priceBasis') || '' };
  const friendId = params.get('withFriend');
  const [filterOpen, setFilterOpen] = useState(false);
  const [draftFilters, setDraftFilters] = useState<RoomFilters>(emptyFilters);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const searchKey = params.toString();
  const changeParams = (changes: Record<string,string>) => setParams(current => {
    const next = new URLSearchParams(current);
    for (const [key, value] of Object.entries(changes)) { if (value) next.set(key, value); else next.delete(key); }
    return next;
  }, { replace: true });

  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    const timer = window.setTimeout(async () => {
      const requestParams = new URLSearchParams(searchKey);
      requestParams.set('status', 'available');
      requestParams.set('sort', sort);
      if (query.trim()) requestParams.set('q', query.trim()); else requestParams.delete('q');
      try { const result = await api.rooms(requestParams); if (active) setRooms(result); }
      catch (caught) { if (active) setError(caught instanceof Error ? caught.message : 'โหลดประกาศไม่สำเร็จ'); }
      finally { if (active) setLoading(false); }
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [searchKey, query, reload, sort]);

  const activeCount = Number(Boolean(filters.minPrice || filters.maxPrice)) + Number(Boolean(filters.minSlots)) + Number(Boolean(filters.priceBasis));
  const hasSearch = Boolean(query.trim() || activeCount);
  const clearFilters = () => changeParams({ ...emptyFilters, q: '' });
  return <div className="page rooms-page"><PageHeader title="รวมประกาศห้อง" subtitle={`สวัสดี ${user?.firstName || ''} — กำลังมองหาห้องแบบไหน?`}/>
    <FriendSearchContext/>
    <section className="search-panel" aria-label="ค้นหาห้อง"><label className="search-input"><Search size={21}/><input aria-label="ค้นหาห้อง" value={query} maxLength={200} onChange={event => changeParams({ q: event.target.value })} placeholder="ค้นหาชื่อห้อง ย่าน หรือรายละเอียด"/>{query && <button onClick={() => changeParams({ q: '' })} aria-label="ล้างคำค้น"><X size={18}/></button>}</label><Button variant="secondary" className="filter-button" onClick={() => { setDraftFilters(filters); setFilterOpen(true); }}><SlidersHorizontal size={18}/>ตัวกรอง{activeCount > 0 && <span>{activeCount}</span>}</Button></section>
    {activeCount > 0 && <div className="active-filter-row"><span>กำลังใช้ตัวกรอง</span>{(filters.minPrice || filters.maxPrice) && <i>฿{filters.minPrice || '0'}–฿{filters.maxPrice || '∞'}</i>}{filters.priceBasis && <i>{filters.priceBasis === 'per_room' ? 'ราคาทั้งห้อง' : 'ราคาต่อคน'}</i>}{filters.minSlots && <i>ว่างอย่างน้อย {filters.minSlots} ที่</i>}<button onClick={clearFilters}>ล้างทั้งหมด</button></div>}
    <section className="list-section"><div className="list-toolbar"><div><h2>{friendId ? 'ห้องที่มีที่ว่างพอสำหรับคุณและเพื่อน' : 'ห้องที่ยังมีที่ว่าง'}</h2><p aria-live="polite">{loading ? 'กำลังค้นหา…' : error ? 'ยังโหลดจำนวนห้องไม่ได้' : `พบ ${rooms.length} ห้อง`}</p></div><label><span>เรียงตาม</span><select value={sort} onChange={event => changeParams({ sort: event.target.value })}><option value="newest">ล่าสุด</option><option value="price_asc">ราคาต่ำ → สูง</option><option value="price_desc">ราคาสูง → ต่ำ</option></select></label></div>
      {loading ? <SkeletonGrid/> : error ? <EmptyState icon={<RefreshCw/>} title="โหลดประกาศไม่สำเร็จ" text={error} action={<Button variant="secondary" onClick={() => setReload(value => value + 1)}>ลองอีกครั้ง</Button>}/> : rooms.length ? <RoomGrid rooms={rooms}/> : <EmptyState icon={<Search/>} title={friendId ? 'ยังไม่พบห้องที่รับคุณทั้งคู่ได้ตามเงื่อนไข' : hasSearch ? 'ไม่พบห้องที่ตรงกับเงื่อนไข' : 'ยังไม่มีห้องที่เปิดรับคำขอ'} text={friendId ? 'ระบบนับเฉพาะคนที่ยังไม่ได้เป็นเจ้าของหรือสมาชิกห้องนั้น ลองปรับตัวกรองหรือกลับมาตรวจสอบภายหลัง' : hasSearch ? 'ลองเปลี่ยนคำค้นหา ย่าน หรือช่วงราคา' : 'ตอนนี้ยังไม่มีประกาศว่าง คุณเริ่มทำความรู้จักเพื่อนระหว่างรอได้'} action={<div className="empty-actions">{hasSearch && <Button variant="secondary" onClick={clearFilters}>ล้างการค้นหา</Button>}{friendId ? <Link className="button button-secondary" to="/rooms">หาห้องตามปกติ</Link> : <Link className="button button-secondary" to="/friends">หาเพื่อนก่อนหาห้อง</Link>}<Button variant="quiet" onClick={() => setReload(value => value + 1)}>โหลดอีกครั้ง</Button></div>}/>}
    </section><FilterSheet open={filterOpen} value={draftFilters} onChange={setDraftFilters} onClose={() => setFilterOpen(false)} onApply={() => { changeParams({ ...draftFilters }); setFilterOpen(false); }}/>
  </div>;
}
