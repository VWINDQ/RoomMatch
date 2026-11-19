import type { RefObject } from 'react';
import type { SelectedImage } from '../components/ImagePicker';
import { useFormLeaveGuard } from './useFormLeaveGuard';

export function useListingLeaveGuard(
  formRef: RefObject<HTMLFormElement | null>,
  images: SelectedImage[],
  status: string,
  ready: boolean,
  initial: unknown,
) {
  return useFormLeaveGuard(formRef, images, status, ready, initial);
}