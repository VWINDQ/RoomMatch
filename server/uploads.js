import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { assert, HttpError } from './errors.js';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const DEFAULT_UPLOAD_DIRECTORY = fileURLToPath(new URL('../storage/uploads/', import.meta.url));
export const UPLOAD_PATH = /^\/uploads\/([1-9]\d*)\/([a-f0-9-]{36}\.webp)$/;
const INPUT_TYPES = new Map([['image/jpeg', 'jpeg'], ['image/png', 'png'], ['image/webp', 'webp']]);

async function readImage(request) {
  assert(Number(request.headers['content-length'] ?? 0) <= MAX_IMAGE_BYTES, 413, 'รูปภาพต้องมีขนาดไม่เกิน 5 MB');
  const chunks = [];
  let size = 0;
  // Leave the request readable on rejection so the client receives the JSON error.
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > MAX_IMAGE_BYTES) {
      request.resume();
      throw new HttpError(413, 'รูปภาพต้องมีขนาดไม่เกิน 5 MB');
    }
    chunks.push(chunk);
  }
  assert(size > 0, 400, 'กรุณาเลือกไฟล์รูปภาพ');
  return Buffer.concat(chunks);
}

export function createImageStorage({ directory = process.env.ROOMMATCH_UPLOAD_DIR ?? DEFAULT_UPLOAD_DIRECTORY, db } = {}) {
  const root = resolve(directory);
  const attempts = new Map();
  let activeUploads = 0;

  function validateUrl(value, userId, legacyUrl) {
    if (typeof value === 'string' && value.startsWith('/uploads/')) {
      const match = UPLOAD_PATH.exec(value);
      assert(match && Number(match[1]) === userId, 400, 'ใช้ได้เฉพาะรูปที่คุณอัปโหลดเอง');
      assert(existsSync(resolve(root, match[1], match[2])), 400, 'ไม่พบรูปภาพ กรุณาเลือกรูปใหม่');
      return value;
    }
    return legacyUrl(value);
  }

  async function upload(request, userId) {
    const type = String(request.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    assert(INPUT_TYPES.has(type), 415, 'รองรับเฉพาะรูป JPG, PNG และ WebP');
    const now = Date.now();
    for (const [key, entry] of attempts) if (now - entry.start >= 60_000) attempts.delete(key);
    const entry = attempts.get(userId) ?? { start: now, count: 0 };
    assert(entry.count < 20, 429, 'อัปโหลดหลายรูปเกินไป กรุณารอ 1 นาทีแล้วลองใหม่');
    assert(activeUploads < 4, 503, 'ระบบกำลังจัดการรูปภาพ กรุณาลองอีกครั้ง');
    entry.count += 1;
    attempts.set(userId, entry);
    activeUploads += 1;
    try {
      const input = await readImage(request);
      let output;
      try {
        const image = sharp(input, { limitInputPixels: 25_000_000, failOn: 'warning' });
        const metadata = await image.metadata();
        assert(metadata.format === INPUT_TYPES.get(type) && (metadata.pages ?? 1) === 1, 400, 'ไฟล์ต้องเป็นรูปภาพนิ่ง JPG, PNG หรือ WebP ที่ถูกต้อง');
        // Decode and re-encode instead of trusting a filename or MIME header.
        // rotate() applies EXIF orientation; metadata (including GPS) is omitted.
        output = await image.rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(400, 'อ่านรูปภาพไม่ได้ กรุณาใช้รูป JPG, PNG หรือ WebP ไม่เกิน 25 ล้านพิกเซล');
      }
      assert(output.length <= MAX_IMAGE_BYTES, 413, 'รูปภาพมีขนาดใหญ่เกินไป กรุณาเลือกรูปที่เล็กลง');
      const userDirectory = resolve(root, String(userId));
      mkdirSync(userDirectory, { recursive: true });
      let files = readdirSync(userDirectory).filter(name => /^[a-f0-9-]{36}\.webp$/.test(name));
      // Abandoned selections and replaced photos get a 24-hour grace period.
      // Reclaim this user's unreferenced files on their next upload.
      if (db) {
        const prefix = `/uploads/${userId}/`;
        const referenced = new Set([
          ...db.prepare('SELECT profile_image AS url FROM USER WHERE profile_image LIKE ?').all(`${prefix}%`),
          ...db.prepare('SELECT image_url AS url FROM ROOM_IMAGE WHERE image_url LIKE ?').all(`${prefix}%`),
        ].map(row => row.url));
        files = files.filter(name => {
          const path = resolve(userDirectory, name);
          if (referenced.has(`${prefix}${name}`) || now - statSync(path).mtimeMs < 86_400_000) return true;
          unlinkSync(path);
          return false;
        });
      }
      const bytes = files.reduce((total, name) => total + statSync(resolve(userDirectory, name)).size, 0);
      assert(files.length < 200 && bytes + output.length <= 250 * 1024 * 1024, 409, 'พื้นที่รูปภาพของบัญชีเต็ม กรุณาติดต่อผู้ดูแล');
      const name = `${randomUUID()}.webp`;
      writeFileSync(resolve(userDirectory, name), output, { flag: 'wx', mode: 0o600 });
      return `/uploads/${userId}/${name}`;
    } finally {
      activeUploads -= 1;
    }
  }

  function serve(request, response, pathname) {
    if (!pathname.startsWith('/uploads/')) return false;
    const match = UPLOAD_PATH.exec(pathname);
    assert(match && ['GET', 'HEAD'].includes(request.method), 404, 'Image not found');
    const path = resolve(root, match[1], match[2]);
    assert(existsSync(path) && statSync(path).isFile(), 404, 'Image not found');
    response.writeHead(200, {
      'Content-Type': 'image/webp',
      'Content-Length': statSync(path).size,
      'Cache-Control': 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    });
    if (request.method === 'HEAD') response.end();
    else {
      const stream = createReadStream(path);
      stream.on('error', error => response.destroy(error));
      stream.pipe(response);
    }
    return true;
  }

  return { upload, validateUrl, serve };
}
