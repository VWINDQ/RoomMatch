import { completedListingImageUrls, validateListing } from '../../shared/listingValidation.js';

export function cancelledImageSelectionErrors(
  current: Record<string, string>,
  images: { url: string; file?: unknown }[],
  busy = false,
) {
  if (busy || current.images) return current;
  return { ...current, ...validateListing({ images: completedListingImageUrls(images) }, { partial: true }) };
}
