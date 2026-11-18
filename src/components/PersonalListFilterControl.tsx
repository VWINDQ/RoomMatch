import { SlidersHorizontal } from 'lucide-react';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { FilterSheetLayout } from './FilterSheet';
import { PersonalListFields } from './Pagination';
import { Button } from './UI';

const defaultFilters = { status: '', sort: '' };

export function useFilterClickGuard() {
  const clickedFilterSheet = useRef(false);
  const guardFilterClick = (event: MouseEvent<HTMLDivElement>) => {
    const insideSheet = event.target instanceof window.Element && Boolean(event.target.closest('.filter-layer'));
    if (event.type === 'click' && event.detail === 1) clickedFilterSheet.current = insideSheet;
    // After the sheet unmounts, a repeated press can move focus and click the list underneath.
    if (event.detail > 1 && clickedFilterSheet.current && !insideSheet) {
      event.preventDefault();
      if (event.type === 'click') event.stopPropagation();
    }
  };
  return { onMouseDownCapture: guardFilterClick, onClickCapture: guardFilterClick };
}

export function PersonalListFilterControl({ params, onChange, favorites = false }: {
  params: URLSearchParams; onChange: (changes: Record<string, string>) => void; favorites?: boolean;
}) {
  const status = params.get('status') || '';
  const sort = params.get('sort') || '';
  const defaultSort = favorites ? 'saved' : 'newest';
  const activeCount = Number(Boolean(status)) + Number(favorites && Boolean(sort && sort !== defaultSort));
  const [draft, setDraft] = useState<typeof defaultFilters | null>(null);
  const open = draft !== null;
  const commit = (filters: typeof defaultFilters) => {
    if (filters.status !== status || filters.sort !== sort || params.has('page')) onChange(filters);
    setDraft(null);
  };
  useEffect(() => {
    if (!open) return;
    // Match the sidebar breakpoint so resizing clears the dialog's focus trap.
    const sidebar = window.matchMedia('(min-width: 1024px)');
    const closeForSidebar = () => { if (sidebar.matches) setDraft(null); };
    closeForSidebar();
    sidebar.addEventListener('change', closeForSidebar);
    return () => sidebar.removeEventListener('change', closeForSidebar);
  }, [open]);

  return <>
    <Button type="button" variant="secondary" className="personal-list-filter-trigger" aria-haspopup="dialog" aria-expanded={open}
      aria-label={activeCount ? `ตัวกรอง มีตัวกรองที่ใช้งาน ${activeCount} รายการ` : 'ตัวกรอง'}
      onClick={event => { event.currentTarget.focus(); setDraft({ status, sort }); }}>
      <SlidersHorizontal size={18}/>ตัวกรอง{activeCount > 0 && <span className="personal-list-filter-count" aria-hidden="true">{activeCount}</span>}
    </Button>
    {draft && <FilterSheetLayout open={open} title={favorites ? 'ตัวกรองห้องโปรด' : 'ตัวกรองประกาศของฉัน'}
      onClose={() => setDraft(null)} onReset={() => commit(defaultFilters)} onApply={() => commit(draft)}>
      <div className="personal-list-filter-fields field">
        <PersonalListFields status={draft.status} sort={draft.sort || defaultSort} favorites={favorites}
          onChange={changes => setDraft({ ...draft, ...changes })}/>
      </div>
    </FilterSheetLayout>}
  </>;
}
