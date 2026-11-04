import { SlidersHorizontal, X } from 'lucide-react';
import type { RoomFilters } from '../types';
import { Button, Input } from './UI';
import { useState } from 'react';
import { useDialogFocus } from './useDialogFocus';

export function FilterSheet({ open, value, onChange, onClose, onApply }: { open: boolean; value: RoomFilters; onChange: (value: RoomFilters) => void; onClose: () => void; onApply: () => void }) {
  const dialogRef = useDialogFocus(open, onClose);
  const [error, setError] = useState('');
  const apply = () => {
    const minimum = Number(value.minPrice), maximum = Number(value.maxPrice);
    if ([value.minPrice, value.maxPrice].some(raw => raw.trim() && (!Number.isSafeInteger(Number(raw)) || Number(raw) < 0))) { setError('กรอกราคาเป็นจำนวนเต็มตั้งแต่ 0 บาท'); return; }
    if (value.minPrice.trim() && value.maxPrice.trim() && minimum > maximum) { setError('ราคาสูงสุดต้องไม่น้อยกว่าราคาต่ำสุด'); return; }
    setError(''); onApply();
  };
  if (!open) return null;
  return <div className="filter-layer" role="dialog" aria-modal="true" aria-labelledby="filter-title"><button className="filter-scrim" onClick={onClose} aria-label="ปิดตัวกรอง"/><section ref={dialogRef} className="filter-sheet">
    <header><div><span><SlidersHorizontal size={18}/>ตัวกรอง</span><h2 id="filter-title">เลือกห้องที่พอดีกับคุณ</h2></div><button className="icon-button" onClick={onClose} aria-label="ปิด"><X size={20}/></button></header>
    <div className="filter-scroll"><fieldset><legend>ช่วงราคาต่อเดือน</legend><div className="price-fields"><Input label="ราคาต่ำสุด" inputMode="numeric" placeholder="2500" value={value.minPrice} onChange={event => onChange({ ...value, minPrice: event.target.value })}/><span>ถึง</span><Input label="ราคาสูงสุด" inputMode="numeric" placeholder="8000" value={value.maxPrice} onChange={event => onChange({ ...value, maxPrice: event.target.value })}/></div></fieldset>
      <fieldset><legend>สถานะห้อง</legend><label className="field"><span className="field-label">แสดงห้อง</span><select value={value.status} onChange={event => onChange({ ...value, status: event.target.value })}><option value="">ทุกสถานะ</option><option value="available">ยังมีที่ว่าง</option><option value="full">เต็มแล้ว</option></select></label></fieldset>
      {error && <p className="form-alert" role="alert">{error}</p>}
    </div><footer><Button variant="quiet" onClick={() => { setError(''); onChange({ minPrice: '', maxPrice: '', status: '' }); }}>ล้างตัวกรอง</Button><Button onClick={apply}>ใช้ตัวกรอง</Button></footer>
  </section></div>;
}
