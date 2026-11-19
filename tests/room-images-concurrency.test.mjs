import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDatabase } from './support/postgres.mjs';
import { startRoomMatchServer } from '../server/app.js';
import { createToken } from '../server/auth.js';

async function fixture(t, imageCount = 2) {
  const db = await openDatabase({ filename: ':memory:' });
  const apps = await Promise.all([0, 1].map(() => startRoomMatchServer({ db, port: 0, logger: { error() {} } })));
  t.after(async () => { await Promise.all(apps.map(app => new Promise(resolve => app.server.close(resolve)))); await db.close(); });
  const api = async (path, method = 'GET', body, instance = 0) => {
    const response = await fetch(`http://127.0.0.1:${apps[instance].server.address().port}/api${path}`, {
      method, headers: { Authorization: `Bearer ${createToken(1)}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json() };
  };
  const created = await api('/rooms', 'POST', { title: 'Image concurrency fixture', description: 'Test',
    googleMapsUrl: 'https://maps.google.com/', price: 3000, priceBasis: 'per_room', capacity: 3, locality: 'Test',
    images: Array.from({ length: imageCount }, (_, index) => `https://example.test/room-${index}.jpg`) });
  assert.equal(created.status, 201);
  return { db, api, room: created.body.room };
}

test('concurrent deletes across API instances retain the final room photo', async t => {
  const { db, api, room } = await fixture(t);
  // Keep the first delete in flight long enough for the competing request to arrive.
  await db.exec(`CREATE FUNCTION delay_image_delete() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN PERFORM pg_sleep(0.1); RETURN OLD; END $$;
    CREATE TRIGGER audit_image_delete BEFORE DELETE ON ROOM_IMAGE FOR EACH ROW EXECUTE FUNCTION delay_image_delete();`);
  const results = await Promise.all(room.images.map((image, index) => api(`/rooms/${room.roomId}/images/${image.imageId}`, 'DELETE', undefined, index)));
  assert.deepEqual(results.map(result => result.status).sort(), [200, 400]);
  const saved = (await api(`/rooms/${room.roomId}`)).body.room;
  assert.equal(saved.images.length, 1);
});

test('concurrent image additions respect the 12-photo maximum and occupied positions return a conflict', async t => {
  const { db, api, room } = await fixture(t, 11);
  await db.exec(`CREATE FUNCTION delay_image_insert() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN PERFORM pg_sleep(0.1); RETURN NEW; END $$;
    CREATE TRIGGER audit_image_insert BEFORE INSERT ON ROOM_IMAGE FOR EACH ROW EXECUTE FUNCTION delay_image_insert();`);
  const results = await Promise.all([0, 1].map(index => api(`/rooms/${room.roomId}/images`, 'POST', { imageUrl: `https://example.test/added-${index}.jpg` }, index)));
  assert.deepEqual(results.map(result => result.status).sort(), [201, 409]);
  assert.equal((await api(`/rooms/${room.roomId}`)).body.room.images.length, 12);
  const small = await api('/rooms', 'POST', { title: 'Occupied order', googleMapsUrl: 'https://maps.google.com/',
    price: 3000, priceBasis: 'per_room', capacity: 2, locality: 'Test', images: ['https://example.test/cover.jpg'] });
  assert.equal((await api(`/rooms/${small.body.room.roomId}/images`, 'POST', { imageUrl: 'https://example.test/duplicate.jpg', imageOrder: 0 })).status, 409);
});

test('image write errors roll back and a later attempt can succeed', async t => {
  const { db, api, room } = await fixture(t);
  await db.exec(`CREATE FUNCTION fail_image_delete() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'fixture write failure'; END $$;
    CREATE TRIGGER audit_image_failure BEFORE DELETE ON ROOM_IMAGE FOR EACH ROW EXECUTE FUNCTION fail_image_delete();`);
  const path = `/rooms/${room.roomId}/images/${room.images[0].imageId}`;
  const failed = await api(path, 'DELETE');
  assert.equal(failed.status, 500);
  assert.doesNotMatch(JSON.stringify(failed.body), /fixture write failure|SQL|ROOM_IMAGE/);
  assert.equal((await api(`/rooms/${room.roomId}`)).body.room.images.length, 2);
  await db.exec('DROP TRIGGER audit_image_failure ON ROOM_IMAGE');
  assert.equal((await api(path, 'DELETE')).status, 200);
});
