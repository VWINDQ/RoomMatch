import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';
import { selectImageFiles } from '../src/lib/imageSelection.ts';
import { IMAGE_ACCEPT, IMAGE_TYPE_MESSAGE, MAX_IMAGE_BYTES } from '../shared/imageUpload.js';

async function image(format, type, name) {
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#fff' } }).toFormat(format).toBuffer();
  return new File([bytes], name, { type });
}

test('picker supports browser-friendly image formats and keeps valid files in mixed selections or drops', async () => {
  for (const type of ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', '.jfif']) assert.ok(IMAGE_ACCEPT.split(',').includes(type));
  const jpg = await image('jpeg', 'image/jpeg', 'room.jpg');
  const png = await image('png', 'image/png', 'room.png');
  const webp = await image('webp', 'image/webp', 'room.webp');
  const gif = await image('gif', 'image/gif', 'room.gif');
  const avif = await image('avif', 'image/avif', 'room.avif');
  const result = await selectImageFiles([new File(['%PDF-1.7'], 'lease.pdf', { type: 'application/pdf' }), jpg,
    new File(['document'], 'notes.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), png, webp, gif, avif], 12);
  assert.deepEqual(result.accepted, [jpg, png, webp, gif, avif]);
  assert.equal(result.rejected.length, 2);
  assert.ok(result.rejected.includes(`lease.pdf: ${IMAGE_TYPE_MESSAGE}`));
  assert.ok(result.rejected.includes(`notes.docx: ${IMAGE_TYPE_MESSAGE}`));
});

test('a renamed document is rejected while a genuine image with the wrong MIME is normalized', async () => {
  const fake = new File(['%PDF-1.7\nnot a photo'], 'fake.jpg', { type: 'image/jpeg' });
  const jpg = await image('jpeg', 'image/png', 'wrong.png');
  const result = await selectImageFiles([fake, jpg], 12);
  assert.equal(result.accepted.length, 1);
  assert.equal(result.accepted[0].type, 'image/jpeg');
  assert.deepEqual(await result.accepted[0].arrayBuffer(), await jpg.arrayBuffer());
  assert.ok(result.rejected.includes(`fake.jpg: ${IMAGE_TYPE_MESSAGE}`));
});

test('a downloaded WebP named jpg is corrected without changing its bytes or losing file details', async () => {
  const source = await image('webp', 'image/jpeg', 'downloaded.jpg');
  const result = await selectImageFiles([source], 1);
  assert.deepEqual(result.rejected, []);
  assert.equal(result.accepted[0].type, 'image/webp');
  assert.equal(result.accepted[0].name, source.name);
  assert.equal(result.accepted[0].lastModified, source.lastModified);
  assert.deepEqual(await result.accepted[0].arrayBuffer(), await source.arrayBuffer());
});

test('file content handles generic MIME and JPEG aliases but rejects SVG, HEIC and truncated headers', async () => {
  for (const type of ['', 'application/octet-stream', 'image/jpg', 'image/pjpeg']) {
    const result = await selectImageFiles([await image('jpeg', type, 'photo.jfif')], 1);
    assert.deepEqual(result.rejected, []);
    assert.equal(result.accepted[0].type, 'image/jpeg');
  }
  const files = [
    new File(['<svg xmlns="http://www.w3.org/2000/svg"></svg>'], 'vector.png', { type: 'image/png' }),
    new File([Buffer.from('000000186674797068656963000000006d69663168656963', 'hex')], 'photo.avif', { type: 'image/avif' }),
    new File([Buffer.from('0000001066747970', 'hex')], 'broken.avif', { type: 'image/avif' }),
  ];
  const result = await selectImageFiles(files, 3);
  assert.deepEqual(result.accepted, []);
  assert.equal(result.rejected.length, files.length);
});

test('AVIF compatible brands are detected without treating a minor version as a brand', async () => {
  const source = await image('avif', 'image/avif', 'compatible.avif');
  const bytes = Buffer.from(await source.arrayBuffer());
  bytes.write('mif1', 8); // The compatible-brand list still contains avif.
  const result = await selectImageFiles([new File([bytes], source.name)], 1);
  assert.deepEqual(result.rejected, []);
  assert.equal(result.accepted[0].type, 'image/avif');
  const misleading = Buffer.from('000000146674797068656963617669666d696631', 'hex');
  const rejected = await selectImageFiles([new File([misleading], 'not-avif.avif', { type: 'image/avif' })], 1);
  assert.deepEqual(rejected.accepted, []);
  assert.equal(rejected.rejected.length, 1);
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
