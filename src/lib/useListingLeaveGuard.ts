import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { useBlocker } from 'react-router-dom';
import type { SelectedImage } from '../components/ImagePicker';

export function useListingLeaveGuard(formRef: RefObject<HTMLFormElement | null>, images: SelectedImage[], status: string, ready: boolean, initial: unknown) {
  const baseline = useRef<string | null>(null);
  const saved = useRef(false);
  const snapshot = useCallback(() => {
    // FormData omits disabled fields during saving; read their values directly.
    const fields = Array.from(formRef.current?.elements ?? []).filter(
      (field): field is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement =>
        (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement) && Boolean(field.name) && field.type !== 'file',
    ).map(field => [field.name, field.value]);
    return JSON.stringify({ fields, status, images: images.map(image => image.file ? `file:${image.id}` : image.url) });
  }, [formRef, images, status]);

  const currentSnapshot = useRef(snapshot);
  currentSnapshot.current = snapshot;
  useLayoutEffect(() => {
    baseline.current = ready ? currentSnapshot.current() : null;
    saved.current = false;
    // Capture only when the loaded record becomes ready, not on user edits.
  }, [ready, initial]);

  const hasChanges = useCallback(() => ready && !saved.current && baseline.current !== null && snapshot() !== baseline.current, [ready, snapshot]);
  const blocker = useBlocker(hasChanges);
  const currentBlocker = useRef(blocker);
  currentBlocker.current = blocker;

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasChanges()) return;
      event.preventDefault();
      event.returnValue = ''; // The browser supplies its own warning text.
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [hasChanges]);

  const markSaved = () => {
    // Bypass synchronously before navigate(), without waiting for a React render.
    saved.current = true;
    if (currentBlocker.current.state === 'blocked') currentBlocker.current.reset();
  };
  return { blocker, markSaved };
}
