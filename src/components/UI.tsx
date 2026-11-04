import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';
import { useEffect, useId, useRef } from 'react';
import { LoaderCircle, X } from 'lucide-react';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger';
  loading?: boolean;
};

export function Button({ variant = 'primary', loading, className = '', children, disabled, ...props }: ButtonProps) {
  return <button className={`button button-${variant} ${className}`} disabled={disabled || loading} {...props}>
    {loading && <LoaderCircle size={17} className="animate-spin" aria-hidden="true" />}{children}
  </button>;
}

type FieldProps = InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: string };
export function Input({ label, error, hint, className = '', ...props }: FieldProps) {
  const descriptionId = useId();
  return <label className={`field ${className}`}><span className="field-label">{label}</span><input className={error ? 'has-error' : ''} aria-invalid={error ? true : undefined} aria-describedby={error || hint ? descriptionId : undefined} {...props} />{error ? <span id={descriptionId} className="field-error">{error}</span> : hint ? <span id={descriptionId} className="field-hint">{hint}</span> : null}</label>;
}

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; error?: string };
export function Textarea({ label, error, className = '', ...props }: TextareaProps) {
  const errorId = useId();
  return <label className={`field ${className}`}><span className="field-label">{label}</span><textarea className={error ? 'has-error' : ''} aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined} {...props} />{error && <span id={errorId} className="field-error">{error}</span>}</label>;
}

export function Chip({ children, selected = false, onClick }: { children: ReactNode; selected?: boolean; onClick?: () => void }) {
  return <button type="button" className={`select-chip ${selected ? 'selected' : ''}`} onClick={onClick} aria-pressed={selected}>{children}</button>;
}

export function StatusBadge({ status }: { status: string }) {
  const labels: Record<string,string> = { available: 'ว่าง', full: 'เต็มแล้ว', inactive: 'ปิดประกาศ', pending: 'รอพิจารณา', approved: 'อนุมัติแล้ว', rejected: 'ไม่อนุมัติ' };
  return <span className={`status ${status === 'available' || status === 'approved' ? 'available' : status === 'pending' ? 'pending' : 'unavailable'}`}><i />{labels[status] || status}</span>;
}

export function Modal({ title, children, onClose, actions }: { title: string; children: ReactNode; onClose: () => void; actions?: ReactNode }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLButtonElement>('.modal-card button')?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); }
      if (event.key !== 'Tab') return;
      const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('.modal-card button:not(:disabled), .modal-card a[href], .modal-card input:not(:disabled)') || []);
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', handleKey);
    return () => { document.removeEventListener('keydown', handleKey); previousFocus?.focus(); };
  }, []);
  return <div ref={dialogRef} className="modal-layer" role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <button className="modal-scrim" onClick={onClose} aria-label="ปิดหน้าต่าง" />
    <section className="modal-card">
      <header><h2 id="modal-title">{title}</h2><button className="icon-button" onClick={onClose} aria-label="ปิด"><X size={20}/></button></header>
      <div className="modal-body">{children}</div>{actions && <footer>{actions}</footer>}
    </section>
  </div>;
}

export function SkeletonGrid() {
  return <div className="room-grid" aria-label="กำลังโหลดห้อง">{[1,2,3,4,5,6].map(item => <div className="skeleton-card" key={item}><div/><span/><span/><i/></div>)}</div>;
}

export function EmptyState({ icon, title, text, action }: { icon: ReactNode; title: string; text: string; action?: ReactNode }) {
  return <section className="empty-state"><div className="empty-icon">{icon}</div><h2>{title}</h2><p>{text}</p>{action}</section>;
}
