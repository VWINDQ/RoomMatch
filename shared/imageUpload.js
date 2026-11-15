export const IMAGE_FORMATS = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' };
export const IMAGE_ACCEPT = Object.keys(IMAGE_FORMATS).join(',');
export const IMAGE_TYPE_MESSAGE = 'รองรับเฉพาะไฟล์ภาพ JPG, PNG และ WebP';
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
