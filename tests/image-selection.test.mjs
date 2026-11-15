import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';
import { selectImageFiles } from '../src/lib/imageSelection.ts';
import { IMAGE_ACCEPT, IMAGE_TYPE_MESSAGE, MAX_IMAGE_BYTES } from '../shared/imageUpload.js';

async function image(format, type, name) {
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#fff' } }).toFormat(format).toBuffer();
  return new File([bytes], name, { type });
}

test('picker accepts exactly the API image types and keeps valid files in mixed selections or drops', async () => {
  assert.equal(IMAGE_ACCEPT, 'image/jpeg,image/png,image/webp');
  const jpg = await image('jpeg', 'image/jpeg', 'room.jpg');
  const png = await image('png', 'image/png', 'room.png');
  const webp = await image('webp', 'image/webp', 'room.webp');
  const result = await selectImageFiles([new File(['%PDF-1.7'], 'lease.pdf', { type: 'application/pdf' }), jpg,
    new File(['document'], 'notes.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), png, webp], 12);
  assert.deepEqual(result.accepted, [jpg, png, webp]);
  assert.equal(result.rejected.length, 2);
  assert.ok(result.rejected.includes(`lease.pdf: ${IMAGE_TYPE_MESSAGE}`));
  assert.ok(result.rejected.includes(`notes.docx: ${IMAGE_TYPE_MESSAGE}`));
});

test('renaming a PDF to jpg or lying about MIME does not pass initial content checks', async () => {
  const fake = new File(['%PDF-1.7\nnot a photo'], 'fake.jpg', { type: 'image/jpeg' });
  const jpg = await image('jpeg', 'image/png', 'wrong.png');
  const result = await selectImageFiles([fake, jpg], 12);
  assert.deepEqual(result.accepted, []);
  assert.ok(result.rejected.includes(`fake.jpg: ${IMAGE_TYPE_MESSAGE}`));
  assert.ok(result.rejected.includes(`wrong.png: ${IMAGE_TYPE_MESSAGE}`));
});

test('size and count limits reject individual files without discarding the valid remainder', async () => {
  const jpg = await image('jpeg', 'image/jpeg', 'first.jpg');
  const png = await image('png', 'image/png', 'extra.png');
  const result = await selectImageFiles([new File([], 'empty.png', { type: 'image/png' }),
    new File([new Uint8Array(MAX_IMAGE_BYTES + 1)], 'large.jpg', { type: 'image/jpeg' }), jpg, png], 1);
  assert.deepEqual(result.accepted, [jpg]);
  assert.equal(result.rejected.length, 3);
  assert.match(result.rejected[0], /empty.png.*5 MB/);
  assert.match(result.rejected[1], /large.jpg.*5 MB/);
  assert.match(result.rejected[2], /extra.png/);
  assert.deepEqual((await selectImageFiles([jpg], 0)).accepted, []);
});

test('a real image with missing MIME is normalized to a supported upload type', async () => {
  const jpg = await image('jpeg', '', 'no-mime.jpg');
  const result = await selectImageFiles([jpg], 1);
  assert.deepEqual(result.rejected, []);
  assert.equal(result.accepted[0].type, 'image/jpeg');
  assert.equal(result.accepted[0].name, jpg.name);
});
