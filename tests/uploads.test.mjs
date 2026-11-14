import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import sharp from 'sharp';
import { startRoomMatchServer } from '../server/app.js';
import { createToken } from '../server/auth.js';
import { openDatabase } from '../server/database.js';
import { MAX_IMAGE_BYTES } from '../server/uploads.js';

async function fixture(t, { brokenStorage = false } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'roommatch-uploads-'));
  const filename = join(directory, 'test.sqlite');
  const uploadDirectory = join(directory, 'images');
  if (brokenStorage) writeFileSync(uploadDirectory, 'not a directory');
  let db = openDatabase({ filename, seed: false });
  for (const name of ['Owner', 'Other']) db.prepare('INSERT INTO USER (first_name, last_name, phone, email, password_hash) VALUES (?, ?, ?, ?, ?)').run(name, 'Test', '0800000000', `${name}@upload.test`, 'unused-test-hash');
  let app = await startRoomMatchServer({ db, port: 0, uploadDirectory, logger: { error() {} } });
  let base = `http://127.0.0.1:${app.server.address().port}`;
  const headers = { Authorization: `Bearer ${createToken(1)}` };
  const image = await sharp({ create: { width: 1800, height: 900, channels: 3, background: '#aecbed' } }).jpeg().withMetadata().toBuffer();
  const api = async (path, method = 'GET', body, userId = 1) => {
    const response = await fetch(`${base}/api${path}`, { method, headers: { Authorization: `Bearer ${createToken(userId)}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  const upload = async (body = image, type = 'image/jpeg', authenticated = true) => {
    const response = await fetch(`${base}/api/uploads/images`, { method: 'POST', headers: { ...(authenticated ? headers : {}), 'Content-Type': type }, body });
    return { status: response.status, body: await response.json() };
  };
  t.after(async () => { await new Promise(resolve => app.server.close(resolve)); db.close(); rmSync(directory, { recursive: true, force: true }); });
  return {
    api, upload, directory, uploadDirectory, image, db,
    fetch: path => fetch(`${base}${path}`),
    async restart() {
      await new Promise(resolve => app.server.close(resolve)); db.close();
      db = openDatabase({ filename, seed: false });
      app = await startRoomMatchServer({ db, port: 0, uploadDirectory, logger: { error() {} } });
      base = `http://127.0.0.1:${app.server.address().port}`;
    },
  };
}

test('upload re-encodes, resizes, strips metadata, serves publicly, and survives a restart', async t => {
  const f = await fixture(t);
  const result = await f.upload();
  assert.equal(result.status, 201);
  const url = result.body.imageUrl;
  assert.match(url, /^\/uploads\/1\/[a-f0-9-]{36}\.webp$/);
  const saved = await f.api('/profile', 'PATCH', { profileImage: url });
  assert.equal(saved.status, 200);
  assert.equal(f.db.prepare('SELECT profile_image FROM USER WHERE user_id = 1').get().profile_image, url);
  const response = await f.fetch(url);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/webp');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  const metadata = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
  assert.equal(metadata.width, 1600);
  assert.equal(metadata.height, 800);
  assert.equal(metadata.exif, undefined);
  await f.restart();
  assert.equal((await f.api('/profile')).body.user.profileImage, url);
  assert.equal((await f.fetch(url)).status, 200);
});

test('reject unauthenticated, empty, oversized, corrupt, spoofed, SVG, and oversized-dimension images', async t => {
  const f = await fixture(t);
  assert.equal((await f.upload(f.image, 'image/jpeg', false)).status, 401);
  assert.equal((await f.upload(Buffer.alloc(0))).status, 400);
  assert.equal((await f.upload(Buffer.alloc(MAX_IMAGE_BYTES + 1))).status, 413);
  assert.equal((await f.upload(Buffer.from('<script>alert(1)</script>'))).status, 400);
  assert.equal((await f.upload(f.image, 'image/png')).status, 400);
  assert.equal((await f.upload(Buffer.from('<svg/>'), 'image/svg+xml')).status, 415);
  const big = await sharp({ create: { width: 6000, height: 6000, channels: 3, background: '#fff' } }).png().toBuffer();
  assert.equal((await f.upload(big, 'image/png')).status, 400);
  assert.equal((await f.api('/profile')).body.user.profileImage, null);
});

test('PNG and WebP inputs work, while paths cannot escape storage or reuse another user upload', async t => {
  const f = await fixture(t);
  const png = await sharp(f.image).png().toBuffer();
  const webp = await sharp(f.image).webp().toBuffer();
  assert.equal((await f.upload(png, 'image/png')).status, 201);
  const uploaded = await f.upload(webp, 'image/webp');
  assert.equal(uploaded.status, 201);
  assert.equal((await f.api('/profile', 'PATCH', { profileImage: uploaded.body.imageUrl }, 2)).status, 400);
  for (const url of ['/uploads/1/../../package.json', '/uploads/1/missing.webp', '//example.test/photo.webp', '/uploads/1/00000000-0000-0000-0000-000000000000.webp']) {
    assert.equal((await f.api('/profile', 'PATCH', { profileImage: url })).status, 400, url);
  }
  assert.equal((await f.fetch('/uploads/1/missing.webp')).status, 404);
  assert.equal((await f.fetch('/uploads/1/%2e%2e%2fpackage.json')).status, 404);
});

test('room create/edit stores uploaded images in order and keeps legacy URLs compatible', async t => {
  const f = await fixture(t);
  const first = (await f.upload()).body.imageUrl;
  const second = (await f.upload()).body.imageUrl;
  const payload = { title: 'ห้องทดสอบ', googleMapsUrl: 'https://maps.google.com/', price: 3000, capacity: 2, images: [first, 'https://example.test/old.jpg', second] };
  const created = await f.api('/rooms', 'POST', payload);
  assert.equal(created.status, 201);
  const roomId = created.body.room.roomId;
  assert.deepEqual(created.body.room.images.map(image => image.imageUrl), payload.images);
  assert.equal((await f.api('/rooms', 'POST', payload, 2)).status, 400);
  assert.equal((await f.api(`/rooms/${roomId}`, 'PATCH', { images: [second, first] }, 2)).status, 403);
  const edited = await f.api(`/rooms/${roomId}`, 'PATCH', { images: [second, first] });
  assert.equal(edited.status, 200);
  assert.deepEqual(edited.body.room.images.map(image => image.imageUrl), [second, first]);
  assert.deepEqual(f.db.prepare('SELECT image_url FROM ROOM_IMAGE WHERE room_id = ? ORDER BY image_order').all(roomId).map(row => row.image_url), [second, first]);
  const single = await f.api(`/rooms/${roomId}/images`, 'POST', { imageUrl: first });
  assert.equal(single.status, 201);
  assert.equal((await f.api('/profile', 'PATCH', { profileImage: 'https://example.test/old.jpg' })).status, 200);
  await f.restart();
  assert.deepEqual((await f.api(`/rooms/${roomId}`)).body.room.images.map(image => image.imageUrl), [second, first, first]);
  assert.equal((await f.api(`/rooms/${roomId}`, 'PATCH', { images: [] })).status, 200);
  assert.equal((await f.api('/profile', 'PATCH', { profileImage: '' })).body.user.profileImage, null);
});

test('storage failure returns a safe error and leaves profile/room records unchanged', async t => {
  const f = await fixture(t, { brokenStorage: true });
  assert.deepEqual(await f.upload(), { status: 500, body: { error: 'Internal server error' } });
  assert.equal((await f.api('/profile')).body.user.profileImage, null);
  assert.equal(f.db.prepare('SELECT count(*) AS count FROM ROOM_IMAGE').get().count, 0);
});

test('database save failure keeps the uploaded file available for a retry', async t => {
  const f = await fixture(t);
  const url = (await f.upload()).body.imageUrl;
  f.db.exec('PRAGMA query_only = ON');
  assert.equal((await f.api('/profile', 'PATCH', { profileImage: url })).status, 500);
  assert.equal((await f.api('/profile')).body.user.profileImage, null);
  assert.equal((await f.fetch(url)).status, 200);
  f.db.exec('PRAGMA query_only = OFF');
  assert.equal((await f.api('/profile', 'PATCH', { profileImage: url })).status, 200);
});

test('per-user upload limit and cleanup preserve referenced files and reclaim old abandoned images', async t => {
  const f = await fixture(t);
  const kept = (await f.upload()).body.imageUrl;
  await f.api('/profile', 'PATCH', { profileImage: kept });
  const abandoned = (await f.upload()).body.imageUrl;
  const old = new Date(Date.now() - 2 * 86_400_000);
  for (const url of [kept, abandoned]) utimesSync(join(f.uploadDirectory, url.replace('/uploads/', '')), old, old);
  assert.equal((await f.upload()).status, 201);
  assert.equal((await f.fetch(kept)).status, 200);
  assert.equal((await f.fetch(abandoned)).status, 404);
  for (let i = 3; i < 20; i++) assert.equal((await f.upload()).status, 201);
  assert.equal((await f.upload()).status, 429);
  assert.equal(readdirSync(join(f.uploadDirectory, '1')).length, 19);
  assert.ok(readFileSync(join(f.uploadDirectory, kept.replace('/uploads/', ''))).length > 0);
});

test('per-user file quota rejects more files without changing existing references', async t => {
  const f = await fixture(t);
  const kept = (await f.upload()).body.imageUrl;
  await f.api('/profile', 'PATCH', { profileImage: kept });
  const bytes = readFileSync(join(f.uploadDirectory, kept.replace('/uploads/', '')));
  for (let index = 1; index < 200; index++) writeFileSync(join(f.uploadDirectory, '1', `${randomUUID()}.webp`), bytes);
  assert.equal((await f.upload()).status, 409);
  assert.equal(readdirSync(join(f.uploadDirectory, '1')).length, 200);
  assert.equal((await f.api('/profile')).body.user.profileImage, kept);
  assert.equal((await f.fetch(kept)).status, 200);
});
