import { Button } from './UI';

export function Pagination({ page, totalPages, busy, onChange, label = 'แบ่งหน้ารายการห้อง' }: {
  page: number; totalPages: number; busy: boolean; onChange: (page: number) => void; label?: string;
}) {
  if (!Number.isSafeInteger(totalPages) || totalPages <= 1) return null;
  const visible = [...new Set([1, totalPages, page - 1, page, page + 1])]
    .filter(number => number >= 1 && number <= totalPages).sort((a, b) => a - b);
  return <nav className="room-pagination" aria-label={label} aria-busy={busy}>
    <Button variant="secondary" disabled={busy || page <= 1} onClick={() => onChange(page - 1)}>ก่อนหน้า</Button>
    <span className="pagination-mobile">หน้า {page} จาก {totalPages}</span>
    <div className="pagination-desktop">{visible.flatMap((number, index) => [
      ...(index > 0 && number - visible[index - 1] > 1 ? [<span key={`gap-${number}`} aria-hidden="true">…</span>] : []),
      <Button key={number} variant="secondary" aria-label={`หน้า ${number}`} aria-current={number === page ? 'page' : undefined} disabled={busy || number === page} onClick={() => onChange(number)}>{number}</Button>,
    ])}</div>
    <Button variant="secondary" disabled={busy || page >= totalPages} onClick={() => onChange(page + 1)}>ถัดไป</Button>
  </nav>;
}

export function pageRange(page: number, pageSize: number, count: number, total: number, unit = 'ห้อง') {
  return total ? `แสดง ${(page - 1) * pageSize + 1}–${(page - 1) * pageSize + count} จาก ${total} ${unit}` : `พบ 0 ${unit}`;
}

export function PersonalListToolbar({ count, status, sort, favorites, onChange }: {
  count: string; status: string; sort: string; favorites?: boolean; onChange: (changes: Record<string, string>) => void;
}) {
  return <div className="list-toolbar personal-list-toolbar">
    <p aria-live="polite">{count}</p>
    <div className="personal-list-filters">
      <label><span>สถานะ</span><select aria-label="กรองสถานะ" value={status} onChange={event => onChange({ status: event.target.value })}>
        <option value="">ทั้งหมด</option><option value="available">ว่าง</option><option value="full">เต็มแล้ว</option><option value="inactive">พักประกาศ</option>
      </select></label>
      <label><span>เรียงตาม</span><select aria-label="เรียงตาม" value={sort} onChange={event => onChange({ sort: event.target.value })}>
        {favorites && <option value="saved">บันทึกล่าสุด</option>}<option value="newest">ประกาศล่าสุด</option><option value="price_asc">ราคาต่ำ → สูง</option><option value="price_desc">ราคาสูง → ต่ำ</option>
      </select></label>
    </div>
  </div>;
}
