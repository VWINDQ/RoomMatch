import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { thaiUniversities } from '../lib/thaiUniversities';
import { Input } from './UI';

const customOption = 'ไม่พบมหาวิทยาลัยของฉัน';
const kmutt = 'มหาวิทยาลัยเทคโนโลยีพระจอมเกล้าธนบุรี';

export function readUniversity(data: FormData) {
  return String(data.get('university') ?? data.get('universitySelection') ?? '').trim();
}

export function UniversityPicker({ university, error, onSelect }: { university: string; error?: string; onSelect: () => void }) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const options = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState(university);
  const [custom, setCustom] = useState(false);
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const search = (query || '').trim().toLowerCase();
  const catalog = university && !thaiUniversities.includes(university) ? [university, ...thaiUniversities] : thaiUniversities;
  const matches = catalog.filter(name => name.toLowerCase().includes(search) || (name === kmutt && ['มจธ', 'kmutt'].includes(search.replaceAll('.', ''))));
  const choices = [...matches, customOption];

  const close = () => { setOpen(false); setQuery(null); setActive(-1); };
  const choose = (index: number) => {
    const useCustom = index === matches.length;
    setCustom(useCustom);
    setSelection(useCustom ? '' : matches[index]);
    onSelect();
    close();
  };
  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape' && open) { event.stopPropagation(); close(); return; }
    if (event.key === 'Enter' && open) {
      event.preventDefault();
      if (active >= 0) choose(active);
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    setOpen(true);
    const next = event.key === 'ArrowDown' ? Math.min(active + 1, choices.length - 1) : active <= 0 ? choices.length - 1 : active - 1;
    setActive(next);
    requestAnimationFrame(() => options.current?.children[next]?.scrollIntoView({ block: 'nearest' }));
  };

  return <>
    <div className="field university-picker">
      <label htmlFor={id} className="field-label">มหาวิทยาลัย</label>
      <input ref={input} id={id} name="universityQuery" role="combobox" autoComplete="off" aria-autocomplete="list"
        aria-expanded={open} aria-controls={open ? `${id}-options` : undefined}
        aria-activedescendant={open && active >= 0 ? `${id}-option-${active}` : undefined}
        aria-required={!custom} data-error-field={custom ? undefined : 'university'}
        aria-invalid={!custom && error ? true : undefined} aria-describedby={!custom && error ? `${id}-error` : undefined}
        className={!custom && error ? 'has-error' : undefined} placeholder="ค้นหาหรือเลือกมหาวิทยาลัย"
        value={query ?? (custom ? customOption : selection)}
        onFocus={event => { setOpen(true); event.currentTarget.select(); }}
        onClick={() => setOpen(true)} onBlur={close} onKeyDown={keyDown}
        onChange={event => { setQuery(event.target.value); setOpen(true); setActive(-1); }}/>
      <input type="hidden" name="universitySelection" value={selection}/>
      {open && <div ref={options} id={`${id}-options`} className="university-options" role="listbox" aria-label="รายชื่อมหาวิทยาลัย">
        {choices.map((name, index) => <div key={`${index === matches.length ? 'custom' : 'catalog'}-${name}`} id={`${id}-option-${index}`}
          role="option" aria-selected={index === matches.length ? custom : selection === name} data-active={active === index}
          onMouseDown={event => event.preventDefault()} onClick={() => { input.current?.focus(); choose(index); }}>{name}</div>)}
      </div>}
      {!custom && error && <span id={`${id}-error`} className="field-error">{error}</span>}
    </div>
    {custom && <Input label="ชื่อมหาวิทยาลัย" name="university" placeholder="กรอกชื่อมหาวิทยาลัย" required error={error}/>}
  </>;
}
