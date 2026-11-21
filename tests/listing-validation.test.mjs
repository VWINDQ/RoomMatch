import assert from 'node:assert/strict';
import { test } from 'node:test';
import { request as httpRequest } from 'node:http';
import { openDatabase } from './support/postgres.mjs';
import { startRoomMatchServer } from '../server/app.js';
import { createToken } from '../server/auth.js';
import { validateListing } from '../shared/listingValidation.js';

const requiredMetadata = { priceBasis: 'per_room', locality: 'บางมด', images: ['https://example.test/room.jpg'] };
const valid = { ...requiredMetadata, title: 'ห้องทดสอบ', price: 3500, capacity: 2, googleMapsUrl: 'https://maps.google.com/' };

test('shared listing rules accept boundaries and keep description and cost notes optional', () => {
  assert.deepEqual(validateListing({ ...valid, title: ' '.repeat(3) + 'ก'.repeat(200), description: 'ก'.repeat(5000), locality: 'ก'.repeat(200), costNotes: 'ก'.repeat(1000), price: Number.MAX_SAFE_INTEGER, capacity: 100 }), {});
  assert.deepEqual(validateListing({ ...valid, description: '   ', costNotes: '' }), {});
  assert.deepEqual(validateListing({ status: 'inactive' }, { partial: true }), {});
  for (const [field, max] of [['title', 200], ['description', 5000], ['locality', 200], ['costNotes', 1000], ['googleMapsUrl', 2048]]) {
    assert.ok(validateListing({ ...valid, [field]: 'ก'.repeat(max + 1) })[field], field);
  }
  for (const raw of ['', '   ', null]) assert.equal(validateListing({ ...valid, price: raw }).price, 'กรุณากรอกราคา');
  for (const raw of [true, [], {}, 0, '0', -1, 1.5, '3500.50', '1abc', Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.equal(validateListing({ ...valid, price: raw }).price, 'กรุณากรอกราคาเป็นจำนวนเต็มมากกว่า 0 บาท', String(raw));
  for (const price of [1, '1', 3500, '3500', Number.MAX_SAFE_INTEGER]) assert.deepEqual(validateListing({ ...valid, price }), {});
  for (const raw of ['', '   ', null, false, [], {}, 0, 101, 1.5, '2people']) assert.ok(validateListing({ ...valid, capacity: raw }).capacity, String(raw));
  assert.ok(validateListing({ ...valid, title: '   ' }).title);
  assert.ok(validateListing({ ...valid, capacity: 2 }, { minimumCapacity: 3 }).capacity);
});

test('complete HTTP(S) map URLs are required without restricting the host', () => {
  for (const googleMapsUrl of ['https://', 'http://', 'maps.google.com', '/maps', 'javascript:alert(1)', 'ftp://maps.google.com', 'https:maps.google.com', 'https://bad host/']) assert.ok(validateListing({ ...valid, googleMapsUrl }).googleMapsUrl, googleMapsUrl);
  for (const googleMapsUrl of ['https://maps.app.goo.gl/abc?x=1', 'http://localhost:3000/map', ' https://example.test/map ']) assert.deepEqual(validateListing({ ...valid, googleMapsUrl }), {});
});

test('blur validation checks only the supplied field and clears corrected or optional blank values', () => {
  const options = { partial: true, minimumCapacity: 3 };
  assert.deepEqual(validateListing({ price: '0' }, options), { price: 'กรุณากรอกราคาเป็นจำนวนเต็มมากกว่า 0 บาท' });
  assert.deepEqual(validateListing({ price: '3500' }, options), {});
  assert.deepEqual(validateListing({ locality: '' }, options), { locality: 'กรุณากรอกย่านหรือถนน' });
  assert.deepEqual(validateListing({ priceBasis: '' }, options), { priceBasis: 'กรุณาเลือกหน่วยราคา' });
  assert.deepEqual(Object.keys(validateListing({ capacity: '2' }, options)), ['capacity']);
  assert.deepEqual(Object.keys(validateListing({ title: '   ' }, options)), ['title']);
  assert.deepEqual(Object.keys(validateListing({ googleMapsUrl: 'https://' }, options)), ['googleMapsUrl']);
  for (const [field, message] of [['title', 'กรุณากรอกหัวข้อประกาศ'], ['price', 'กรุณากรอกราคา'], ['capacity', 'กรุณากรอกจำนวนผู้พัก'], ['googleMapsUrl', 'กรุณากรอกลิงก์แผนที่']]) {
    for (const value of ['', '   ']) assert.deepEqual(validateListing({ [field]: value }, options), { [field]: message });
  }
  for (const field of ['description', 'costNotes']) assert.deepEqual(validateListing({ [field]: '' }, options), {});
  for (const [field, invalid, corrected] of [['title', ' ', 'ห้องใหม่'], ['description', 'x'.repeat(5001), 'รายละเอียด'], ['locality', 'x'.repeat(201), 'บางมด'], ['costNotes', 'x'.repeat(1001), 'รวมค่าน้ำ'], ['priceBasis', 'weekly', 'per_room'], ['capacity', '101', '3'], ['googleMapsUrl', 'https://', 'https://maps.google.com/']]) {
    assert.ok(validateListing({ [field]: invalid }, options)[field]);
    assert.deepEqual(validateListing({ [field]: corrected }, options), {});
  }
});

test('required metadata and image count rules apply to both the form and API', () => {
  for (const value of [undefined, null, '', '   ', 'weekly']) {
    assert.equal(validateListing({ ...valid, priceBasis: value }).priceBasis, 'กรุณาเลือกหน่วยราคา');
  }
  for (const value of [undefined, null, '', '   ']) {
    assert.equal(validateListing({ ...valid, locality: value }).locality, 'กรุณากรอกย่านหรือถนน');
  }
  const pending = { url: '', file: {} };
  const saved = { url: 'https://example.test/old.jpg' };
  assert.deepEqual(validateListing({ ...valid, images: [pending] }), {});
  assert.deepEqual(validateListing({ ...valid, images: [saved, pending] }), {});
  assert.equal(validateListing({ ...valid, images: [] }).images, 'กรุณาเพิ่มรูปห้องอย่างน้อย 1 รูป');
  assert.equal(validateListing({ ...valid, images: undefined }).images, 'กรุณาเพิ่มรูปห้องอย่างน้อย 1 รูป');
  assert.deepEqual(validateListing({ ...valid, images: [saved.url] }), {});
});

test('legacy listings remain readable and status-only PATCH works, but editing requires complete metadata', async t => {
  const db = await openDatabase({ filename: ':memory:' });
  const app = await startRoomMatchServer({ db, port: 0, logger: { error() {} } });
  t.after(async () => { await new Promise(resolve => app.server.close(resolve)); await db.close(); });
  const call = async (path, method = 'GET', body) => {
    const response = await fetch(`http://127.0.0.1:${app.server.address().port}/api${path}`, {
      method, headers: { Authorization: `Bearer ${createToken(1)}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  };
  await db.prepare('DELETE FROM ROOM_IMAGE WHERE room_id=1').run();
  const legacy = await call('/rooms/1');
  assert.equal(legacy.status, 200);
  assert.equal(legacy.body.room.priceBasis, null);
  assert.equal(legacy.body.room.locality, null);
  assert.deepEqual(legacy.body.room.images, []);
  for (const status of ['inactive', 'available']) assert.equal((await call('/rooms/1', 'PATCH', { status })).status, 200);
  const before = await db.prepare('SELECT * FROM ROOM WHERE room_id=1').get();
  for (const body of [{ title: 'แก้ชื่อ' }, { status: 'inactive', title: 'แก้ชื่อ' }]) {
    const result = await call('/rooms/1', 'PATCH', body);
    assert.equal(result.status, 400);
    assert.deepEqual(result.body.fieldErrors, { locality: 'กรุณากรอกย่านหรือถนน', priceBasis: 'กรุณาเลือกหน่วยราคา', images: 'กรุณาเพิ่มรูปห้องอย่างน้อย 1 รูป' });
    assert.deepEqual(await db.prepare('SELECT * FROM ROOM WHERE room_id=1').get(), before);
  }
  for (const field of ['priceBasis', 'locality', 'images']) {
    const payload = { ...valid };
    delete payload[field];
    const result = await call('/rooms', 'POST', payload);
    assert.equal(result.status, 400);
    assert.ok(result.body.fieldErrors[field]);
  }
  assert.equal((await call('/rooms/1', 'PATCH', { ...requiredMetadata, description: '', costNotes: '' })).status, 200);
  const repaired = (await call('/rooms/1')).body.room;
  assert.equal(repaired.title, legacy.body.room.title);
  assert.equal((await call('/rooms/1', 'PATCH', { images: [] })).status, 400);
  const imageId = repaired.images[0].imageId;
  const removed = await call(`/rooms/1/images/${imageId}`, 'DELETE');
  assert.equal(removed.status, 400);
  assert.equal(removed.body.fieldErrors.images, 'กรุณาเพิ่มรูปห้องอย่างน้อย 1 รูป');
  assert.equal((await call('/rooms/1')).body.room.images.length, 1);
});

test('room create/edit return structured field errors, preserve records and enforce occupancy/ownership', async t => {
  const db = await openDatabase({ filename: ':memory:' });
  const app = await startRoomMatchServer({ db, port: 0, logger: { error() {} } });
  t.after(async () => { await new Promise(resolve => app.server.close(resolve)); await db.close(); });
  const call = async (path, method, body, userId = 1) => {
    const response = await fetch(`http://127.0.0.1:${app.server.address().port}/api${path}`, {
      method, headers: { Authorization: `Bearer ${createToken(userId)}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  };
  assert.equal((await call('/rooms/1', 'PATCH', requiredMetadata)).status, 200);
  for (const invalid of [
    { title: '   ' }, { title: 'ก'.repeat(201) }, { price: '   ' }, { price: true }, { price: [] },
    { price: 0 }, { price: '0' }, { price: -1 }, { price: 1.5 }, { price: '3500.50' }, { price: Number.MAX_SAFE_INTEGER + 1 }, { capacity: null }, { capacity: 101 },
    { googleMapsUrl: 'https://' }, { googleMapsUrl: 'https:example.test' }, { googleMapsUrl: 'https://example.test/' + 'a'.repeat(2048) },
    { description: 'x'.repeat(5001) }, { locality: 'x'.repeat(201) }, { costNotes: 'x'.repeat(1001) }, { priceBasis: 'weekly' },
  ]) {
    const field = Object.keys(invalid)[0];
    const before = await db.prepare('SELECT * FROM ROOM ORDER BY room_id').all();
    const created = await call('/rooms', 'POST', { ...valid, ...invalid });
    assert.equal(created.status, 400, field);
    assert.equal(typeof created.body.error, 'string');
    assert.match(created.body.fieldErrors[field], /[ก-๙]/);
    if (field === 'price') assert.equal(created.body.fieldErrors.price, invalid.price === '   ' ? 'กรุณากรอกราคา' : 'กรุณากรอกราคาเป็นจำนวนเต็มมากกว่า 0 บาท');
    const edited = await call('/rooms/1', 'PATCH', invalid);
    assert.equal(edited.status, 400, field);
    assert.match(edited.body.fieldErrors[field], /[ก-๙]/);
    if (field === 'price') assert.equal(edited.body.fieldErrors.price, invalid.price === '   ' ? 'กรุณากรอกราคา' : 'กรุณากรอกราคาเป็นจำนวนเต็มมากกว่า 0 บาท');
    assert.deepEqual(await db.prepare('SELECT * FROM ROOM ORDER BY room_id').all(), before);
  }
  const created = await call('/rooms', 'POST', { ...valid, title: '  ห้องใหม่  ', description: ' ', costNotes: null });
  assert.equal(created.status, 201);
  const path = `/rooms/${created.body.room.roomId}`;
  assert.equal(created.body.room.title, 'ห้องใหม่');
  assert.equal(created.body.room.locality, requiredMetadata.locality);
  assert.equal((await call(path, 'PATCH', { title: 'แก้ไขประกาศเก่า' })).status, 200);
  assert.equal((await call(path, 'PATCH', { price: 5 }, 2)).status, 403);
  for (const images of [['https://'], ['https:example.test/image.jpg'], ['/uploads/2/00000000-0000-0000-0000-000000000000.webp'], Array(13).fill('https://example.test/image.jpg')]) {
    for (const [target, method, payload] of [['/rooms', 'POST', { ...valid, images }], [path, 'PATCH', { images }]]) {
      const result = await call(target, method, payload);
      assert.equal(result.status, 400);
      assert.match(result.body.fieldErrors.images, /[ก-๙]/);
    }
  }
  const beforeCapacity = await db.prepare('SELECT * FROM ROOM WHERE room_id=1').get();
  const capacity = await call('/rooms/1', 'PATCH', { capacity: 1 });
  assert.equal(capacity.status, 409);
  assert.match(capacity.body.fieldErrors.capacity, /[ก-๙]/);
  assert.deepEqual(await db.prepare('SELECT * FROM ROOM WHERE room_id=1').get(), beforeCapacity);

  // A member can be approved after edit starts but before its body finishes arriving.
  const arriving = new Promise(resolve => app.server.once('request', resolve));
  const concurrentResult = new Promise((resolve, reject) => {
    const request = httpRequest(`http://127.0.0.1:${app.server.address().port}/api/rooms/1`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${createToken(1)}`, 'Content-Type': 'application/json' },
    }, response => {
      let json = '';
      response.on('data', chunk => { json += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(json) }));
    });
    request.on('error', reject);
    request.write('{"capacity":');
    arriving.then(async () => {
      try {
        assert.equal((await call('/requests/2', 'PATCH', { status: 'approved' })).status, 200);
        request.end('2}');
      } catch (error) { request.destroy(); reject(error); }
    });
  });
  const conflict = await concurrentResult;
  assert.equal(conflict.status, 409);
  assert.match(conflict.body.fieldErrors.capacity, /3/);
  assert.equal((await db.prepare('SELECT capacity FROM ROOM WHERE room_id=1').get()).capacity, 3);
  db.setReadOnly(true);
  const failed = await call(path, 'PATCH', { title: 'ต้องไม่บันทึก' });
  assert.equal(failed.status, 500);
  assert.deepEqual(failed.body, { error: 'Internal server error' });
  db.setReadOnly(false);
  assert.equal((await call(path, 'GET')).body.room.title, 'แก้ไขประกาศเก่า');
});
