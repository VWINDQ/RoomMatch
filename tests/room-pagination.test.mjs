import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDatabase } from './support/postgres.mjs';
import { seedPaginationRooms } from './support/room-pagination-fixture.mjs';
import { startRoomMatchServer } from '../server/app.js';

test('RM-12 PostgreSQL pagination counts, filters, orders and clamps beyond 100 rooms', async t => {
  const db = await openDatabase({ filename: ':memory:' });
  const fixture = await seedPaginationRooms(db);
  const app = await startRoomMatchServer({ db, port: 0 });
  t.after(async () => { await new Promise(resolve => app.server.close(resolve)); await db.close(); });
  const get = async (query = '') => {
    const response = await fetch(`http://127.0.0.1:${app.server.address().port}/api/rooms?q=RM12&${query}`);
    return { status: response.status, ...await response.json() };
  };
  for (const sort of ['newest', 'price_asc', 'price_desc', 'capacity_desc']) {
    const expected = [...fixture].sort((a, b) => (sort === 'price_asc' ? a.price - b.price : sort === 'price_desc' ? b.price - a.price : 0) || b.room_id - a.room_id);
    const actual = [];
    for (let page = 1; page <= 11; page++) {
      const result = await get(`page=${page}&pageSize=12&sort=${sort}`);
      assert.equal(result.status, 200);
      assert.equal(result.total, 125);
      assert.equal(result.page, page);
      assert.equal(result.totalPages, 11);
      assert.equal(result.rooms.length, page === 11 ? 5 : 12);
      actual.push(...result.rooms.map(room => Number(room.roomId)));
    }
    assert.deepEqual(actual, expected.map(room => room.room_id));
    assert.equal(new Set(actual).size, 125);
  }
  const filtered = await get('page=2&pageSize=12&minPrice=1100&maxPrice=1300&minSlots=3&priceBasis=per_room&status=available&sort=price_asc');
  const expected = fixture.filter(room => room.price >= 1100 && room.price <= 1300 && room.price_basis === 'per_room').sort((a,b) => a.price-b.price || b.room_id-a.room_id);
  assert.equal(filtered.total, expected.length);
  assert.deepEqual(filtered.rooms.map(room => Number(room.roomId)), expected.slice(12,24).map(room => room.room_id));
  const last = await get('page=9007199254740991&pageSize=12');
  assert.equal(last.page, 11); assert.equal(last.rooms.length, 5);
  for (const query of ['page=0','page=-1','page=1.5','page=abc','page=','page=1e2','page=9007199254740992','pageSize=0','pageSize=101','pageSize=','pageSize=abc','page=1&limit=12','page=1&offset=12']) {
    assert.equal((await get(query)).status, 400, query);
  }
  assert.equal((await get('pageSize=100')).rooms.length, 100);
  assert.equal((await get('page=2')).rooms.length, 12);
  assert.equal((await get('pageSize=25')).page, 1);
  assert.equal((await get('pageSize=25')).rooms.length, 25);
  assert.equal((await get('page=1&minSlots=4')).total, 0);
  assert.equal((await get('page=1&sort=toString')).status, 400);
  assert.equal((await get('limit=10&offset=100')).rooms.length, 10);
  assert.equal((await get()).rooms.length, 100); // Existing callers keep the rooms array contract.
  const empty = await get('page=9&pageSize=12&minPrice=99999');
  assert.equal(empty.total, 0); assert.equal(empty.totalPages, 0); assert.equal(empty.page, 1); assert.deepEqual(empty.rooms, []);
  await db.prepare("DELETE FROM ROOM WHERE description LIKE 'RM12%' AND room_id IN (SELECT room_id FROM ROOM WHERE description LIKE 'RM12%' ORDER BY room_id LIMIT 10)").run();
  const shrunk = await get('page=11&pageSize=12');
  assert.equal(shrunk.total, 115); assert.equal(shrunk.page, 10); assert.equal(shrunk.rooms.length, 7);
});
