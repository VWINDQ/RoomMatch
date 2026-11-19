import { IMAGE_TYPE_MESSAGE, MAX_IMAGE_BYTES } from '../../shared/imageUpload.js';

function contentType(bytes: Uint8Array) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return 'image/png';
  if (String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  const gif = String.fromCharCode(...bytes.slice(0, 6));
  if (gif === 'GIF87a' || gif === 'GIF89a') return 'image/gif';
  if (bytes.length >= 16 && String.fromCharCode(...bytes.slice(4, 8)) === 'ftyp') {
    // AVIF can use mif1 as its major brand; inspect compatible brands too.
    const boxSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
    if (boxSize >= 16 && boxSize % 4 === 0) {
      for (let offset = 8; offset + 4 <= Math.min(boxSize, bytes.length); offset += 4) {
        if (offset === 12) continue; // Minor version is not a brand.
        const brand = String.fromCharCode(...bytes.slice(offset, offset + 4));
        if (brand === 'avif' || brand === 'avis') return 'image/avif';
      }
    }
  }
  return '';
}

// Preliminary content checks improve selection feedback; the API still fully decodes every image.
export async function selectImageFiles(files: File[], availableSlots: number) {
  const accepted: File[] = [];
  const rejected: string[] = [];
  for (const file of files) {
    let reason = '';
    if (!file.size || file.size > MAX_IMAGE_BYTES) reason = 'ไฟล์ต้องมีขนาดมากกว่า 0 และไม่เกิน 5 MB';
    else {
      try {
        const detected = contentType(new Uint8Array(await file.slice(0, 512).arrayBuffer()));
        if (!detected) reason = IMAGE_TYPE_MESSAGE;
        else if (accepted.length >= availableSlots) reason = 'จำนวนรูปเกินช่องว่างที่เลือกได้';
        else {
          // Downloads may contain WebP bytes with a .jpg name and JPEG MIME.
          accepted.push(file.type === detected ? file : new File([file], file.name, { type: detected, lastModified: file.lastModified }));
        }
      } catch { reason = 'อ่านไฟล์ไม่ได้ กรุณาเลือกไฟล์ใหม่'; }
    }
    if (reason) rejected.push(`${file.name}: ${reason}`);
  }
  return { accepted, rejected };
}
