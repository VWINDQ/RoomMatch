import { useEffect, useRef, type RefObject } from 'react';

export function useFormFeedback(errors: Record<string, string>, form: RefObject<HTMLFormElement | null>, focusOnError = true) {
  const summary = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const key = Object.keys(errors)[0];
    if (!key || !focusOnError) return;
    const frame = requestAnimationFrame(() => {
      const controls = Array.from(form.current?.elements || []);
      const field = controls.find(control => control instanceof HTMLElement && Boolean(errors[control.dataset.errorField || control.getAttribute('name') || '']));
      const group = Array.from(form.current?.querySelectorAll<HTMLElement>('[data-error-field]') || []).find(element => Boolean(errors[element.dataset.errorField || '']));
      const target = field instanceof HTMLElement ? field : group || summary.current;
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: 'center', behavior: 'instant' });
    });
    return () => cancelAnimationFrame(frame);
  }, [errors, form, focusOnError]);
  return summary;
}

export function FormFeedback({ errors, summaryRef }: { errors: Record<string, string>; summaryRef: RefObject<HTMLDivElement | null> }) {
  const values = [...new Set(Object.values(errors))];
  if (!values.length) return null;
  return <div ref={summaryRef} className="form-feedback" role="alert" tabIndex={-1}><strong>ยังไม่ได้บันทึก</strong><span>{values[0]}{values.length > 1 ? ` · มี ${values.length} จุดที่ต้องตรวจสอบ` : ''}</span>{errors.form && <span>ข้อมูลที่กรอกยังอยู่ ลองบันทึกอีกครั้งได้</span>}</div>;
}
