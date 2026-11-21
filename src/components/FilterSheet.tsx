import { SlidersHorizontal, X } from 'lucide-react';
import type { RoomFilters } from '../types';
import { Button, Input } from './UI';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { useDialogFocus } from './useDialogFocus';

export function FilterSheetLayout({ open, title, onClose, onReset, onApply, children }: {
  open: boolean; title: string; onClose: () => void; onReset: () => void; onApply: () => void; children: ReactNode;
}) {
  const dialogRef = useDialogFocus(open, onClose);
  const titleId = useId();
  if (!open) return null;
  return <div className="filter-layer" role="dialog" aria-modal="true" aria-labelledby={titleId}><button type="button" className="filter-scrim" onClick={onClose} aria-label="ปิดตัวกรอง"/><section ref={dialogRef} className="filter-sheet">
    <header><div><span><SlidersHorizontal size={18}/>ตัวกรอง</span><h2 id={titleId}>{title}</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="ปิด"><X size={20}/></button></header>
    <div className="filter-scroll">{children}</div>
    <footer><Button type="button" variant="quiet" onClick={onReset}>ล้างตัวกรอง</Button><Button type="button" onClick={onApply}>ใช้ตัวกรอง</Button></footer>
  </section></div>;
}

export function FilterSheet({ open, value, onChange, onClose, onApply }: { open: boolean; value: RoomFilters; onChange: (value: RoomFilters) => void; onClose: () => void; onApply: () => void }) {
  const priceBasisHintId = useId();
  const [error, setError] = useState('');
  useEffect(() => { if (open) setError(''); }, [open]);
  const apply = () => {
    const minimum = Number(value.minPrice), maximum = Number(value.maxPrice);
    if ([value.minPrice, value.maxPrice].some(raw => raw.trim() && (!Number.isSafeInteger(Number(raw)) || Number(raw) < 0))) { setError('กรอกราคาเป็นจำนวนเต็มตั้งแต่ 0 บาท'); return; }
    if (value.minPrice.trim() && value.maxPrice.trim() && minimum > maximum) { setError('ราคาสูงสุดต้องไม่น้อยกว่าราคาต่ำสุด'); return; }
    if (value.capacity && (!Number.isInteger(Number(value.capacity)) || Number(value.capacity) < 1 || Number(value.capacity) > 100)) { setError('กรอกจำนวนผู้พักทั้งหมดเป็นจำนวนเต็มตั้งแต่ 1 ถึง 100 คน'); return; }
    if (value.minSlots && (!Number.isInteger(Number(value.minSlots)) || Number(value.minSlots) < 1 || Number(value.minSlots) > 100)) { setError('กรอกจำนวนที่ว่างตั้งแต่ 1 ถึง 100 ที่'); return; }
    setError(''); onApply();
  };
  return <FilterSheetLayout open={open} title="เลือกห้องที่พอดีกับคุณ" onClose={onClose} onApply={apply} onReset={() => { setError(''); onChange({ minPrice: '', maxPrice: '', capacity: '', minSlots: '', priceBasis: '' }); }}>
      <fieldset><legend>ช่วงราคาต่อเดือน</legend><div className="price-fields"><Input label="ราคาต่ำสุด" inputMode="numeric" placeholder="2500" value={value.minPrice} onChange={event => onChange({ ...value, minPrice: event.target.value })}/><span>ถึง</span><Input label="ราคาสูงสุด" inputMode="numeric" placeholder="8000" value={value.maxPrice} onChange={event => onChange({ ...value, maxPrice: event.target.value })}/></div></fieldset>
      <label className="field"><span className="field-label">หน่วยราคาที่ต้องการเทียบ</span><select aria-describedby={priceBasisHintId} value={value.priceBasis} onChange={event => onChange({ ...value, priceBasis: event.target.value })}><option value="">ทุกหน่วยราคา</option><option value="per_room">ทั้งห้อง / เดือน</option><option value="per_person">ต่อคน / เดือน</option></select><span id={priceBasisHintId} className="field-hint">ราคาอิงตามหน่วยในประกาศ เช่น ต่อคนหรือต่อห้อง ดูค่าใช้จ่ายเพิ่มเติมได้ในหน้ารายละเอียดห้อง</span></label>
      <Input label="จำนวนผู้พักทั้งหมด" type="number" min={1} max={100} step={1} placeholder="ทุกจำนวน" value={value.capacity} onChange={event => onChange({ ...value, capacity: event.target.value })} hint="เช่น 2 คน จะค้นหาเฉพาะห้องที่พักได้ทั้งหมด 2 คน ไม่ใช่จำนวนที่ว่างที่เหลือ"/>
      <Input label="ที่ว่างสำหรับผู้พักใหม่อย่างน้อย" type="number" min={1} max={100} value={value.minSlots} onChange={event => onChange({ ...value, minSlots: event.target.value })} hint="เช่น 2 ที่ สำหรับคุณกับเพื่อน นับจากจำนวนที่ห้องรองรับหักผู้พักจริง ผู้ลงประกาศที่ไม่ได้พักไม่นับเป็นผู้พัก"/>
      {error && <p className="form-alert" role="alert">{error}</p>}
  </FilterSheetLayout>;
}
