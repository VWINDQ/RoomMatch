import { useEffect, useRef, type RefObject } from 'react';

export function useFormFeedback(errors: Record<string, string>, form: RefObject<HTMLFormElement | null>) {
  const summary = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const key = Object.keys(errors)[0];
    if (!key) return;
    const frame = requestAnimationFrame(() => {
      const field = key !== 'form' ? form.current?.elements.namedItem(key) : null;
      const target = field instanceof HTMLElement ? field : summary.current;
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: 'center', behavior: 'instant' });
    });
    return () => cancelAnimationFrame(frame);
  }, [errors, form]);
  return summary;
}

export function FormFeedback({ errors, summaryRef }: { errors: Record<string, string>; summaryRef: RefObject<HTMLDivElement | null> }) {
  const values = [...new Set(Object.values(errors))];
  if (!values.length) return null;
  return <div ref={summaryRef} className="form-feedback" role="alert" tabIndex={-1}><strong>ยังไม่ได้บันทึก</strong><span>{values[0]}{values.length > 1 ? ` · มี ${values.length} จุดที่ต้องตรวจสอบ` : ''}</span>{errors.form && <span>ข้อมูลที่กรอกยังอยู่ ลองบันทึกอีกครั้งได้</span>}</div>;
}
