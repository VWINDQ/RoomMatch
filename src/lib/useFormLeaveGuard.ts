import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { useBlocker } from 'react-router-dom';
import type { SelectedImage } from '../components/ImagePicker';

export function useFormLeaveGuard(formRef: RefObject<HTMLFormElement | null>, images: SelectedImage[], state: unknown, ready: boolean, initial: unknown) {
  const baseline = useRef<string | null>(null);
  const saved = useRef(false);
  const snapshot = useCallback(() => {
    // FormData omits disabled fields during saving; read their values directly.
    const fields = Array.from(formRef.current?.elements ?? []).filter(
      (field): field is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement =>
        (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement) && Boolean(field.name) && field.type !== 'file',
    ).map(field => [field.name, field.value]);
    return JSON.stringify({ fields, state, images: images.map(image => image.file ? `file:${image.id}` : image.url) });
  }, [formRef, images, state]);

  const currentSnapshot = useRef(snapshot);
  currentSnapshot.current = snapshot;
  useLayoutEffect(() => {
    baseline.current = ready ? currentSnapshot.current() : null;
    saved.current = false;
    // Capture only when the loaded record becomes ready, not on user edits.
  }, [ready, initial]);

  // A rapid Back can arrive before the old route's blocker effect is cleaned up.
  // An unmounted form must not compare its empty DOM against the saved baseline.
  const hasChanges = useCallback(() => Boolean(formRef.current?.isConnected) && ready && !saved.current && baseline.current !== null && currentSnapshot.current() !== baseline.current, [formRef, ready]);
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

  const resetBlocker = useCallback(() => {
    if (currentBlocker.current.state === 'blocked') currentBlocker.current.reset();
  }, []);
  const markSaved = useCallback(() => {
    // Bypass synchronously before navigate(), without waiting for a React render.
    saved.current = true;
    resetBlocker();
  }, [resetBlocker]);
  const proceed = useCallback(() => {
    saved.current = true;
    if (currentBlocker.current.state === 'blocked') currentBlocker.current.proceed();
  }, []);
  return { blocker, markSaved, hasChanges, resetBlocker, proceed };
}
