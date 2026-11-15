export function validateListing(body: Record<string, unknown>, options?: { partial?: boolean; minimumCapacity?: number }): Record<string, string>;
export function isWebUrl(value: string): boolean;
export function completedListingImageUrls(images: { url: string; file?: unknown }[]): string[];
