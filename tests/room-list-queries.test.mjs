import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDatabase } from './support/postgres.mjs';
import { seedPaginationRooms } from './support/room-pagination-fixture.mjs';
import { startRoomMatchServer } from '../server/app.js';

test('one page loads all room photos in one database read with stable gallery ordering', async t => {
  const db = await openDatabase({ filename: ':memory:' });
  const fixture = await seedPaginationRooms(db);
  await db.prepare(`INSERT INTO ROOM_IMAGE(room_id,image_url,image_order)
    SELECT room_id,'https://example.test/second.jpg',1 FROM ROOM WHERE room_id=ANY(?::bigint[])`).run(fixture.map(room => room.room_id));
  await db.prepare(`INSERT INTO ROOM_IMAGE(room_id,image_url,image_order)
    SELECT room_id,'https://example.test/cover.jpg',0 FROM ROOM WHERE room_id=ANY(?::bigint[])`).run(fixture.map(room => room.room_id));
  const app = await startRoomMatchServer({ db, port: 0 });
  t.after(async () => { await new Promise(resolve => app.server.close(resolve)); await db.close(); });
  const original = db.query.bind(db);
  let photoReads = 0;
  db.query = async (sql, values) => { if (/SELECT \* FROM ROOM_IMAGE/i.test(sql)) photoReads++; return original(sql, values); };
  const response = await fetch(`http://127.0.0.1:${app.server.address().port}/api/rooms?q=RM12&page=1&pageSize=12`);
  assert.equal(response.status, 200);
  const { rooms } = await response.json();
  assert.equal(rooms.length, 12);
  assert.equal(photoReads, 1, 'photo reads must not grow with the number of cards');
  for (const room of rooms) assert.deepEqual(room.images.map(image => image.imageUrl), ['https://example.test/cover.jpg', 'https://example.test/second.jpg']);
});
