export const IMAGE_FORMATS = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'heif' };
export const IMAGE_ACCEPT = [...Object.keys(IMAGE_FORMATS), '.jpg', '.jpeg', '.jpe', '.jfif', '.png', '.webp', '.gif', '.avif'].join(',');
export const IMAGE_FORMAT_LABEL = 'JPG/JPEG, PNG, WebP, GIF และ AVIF';
export const IMAGE_TYPE_MESSAGE = `รองรับเฉพาะไฟล์ภาพ ${IMAGE_FORMAT_LABEL}`;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
