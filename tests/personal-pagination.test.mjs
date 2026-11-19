import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDatabase } from './support/postgres.mjs';
import { seedPersonalPagination } from './support/personal-pagination-fixture.mjs';
import { startRoomMatchServer } from '../server/app.js';
import { createToken } from '../server/auth.js';

async function fixture(t, count = 125) {
  const db = await openDatabase({ filename: ':memory:' });
  const rows = await seedPersonalPagination(db, count);
  const app = await startRoomMatchServer({ db, port: 0 });
  t.after(async () => { await new Promise(resolve => app.server.close(resolve)); await db.close(); });
  const api = async (path, userId, method = 'GET') => {
    const response = await fetch(`http://127.0.0.1:${app.server.address().port}/api${path}`, { method, headers: userId ? { Authorization: `Bearer ${createToken(userId)}` } : {} });
    return { status: response.status, ...await response.json() };
  };
  return { db, rows, api };
}

for (const [endpoint, size, viewer] of [['/favorites', 12, 3], ['/my/rooms', 10, 1]]) {
  test(`${endpoint} pages cover 125 scoped records, retain default order and validate input`, async t => {
    const { db, rows, api } = await fixture(t);
    const path = query => `${endpoint}?q=Private%20pagination&${query}`;
    const compare = (sort, a, b) => {
      const primary = sort === 'price_asc' ? a.price-b.price : sort === 'price_desc' ? b.price-a.price
        : endpoint === '/favorites' && !sort ? b.room_id%4-a.room_id%4 : Date.parse(b.created_at)-Date.parse(a.created_at);
      return primary || b.room_id-a.room_id;
    };
    for (const sort of ['', 'newest', 'price_asc', 'price_desc']) {
      const ids = [];
      for (let page = 1; page <= Math.ceil(rows.length/size); page++) {
        const result = await api(path(`page=${page}${sort ? `&sort=${sort}` : ''}`), viewer);
        assert.equal(result.status, 200);
        assert.equal(result.total, rows.length); assert.equal(result.pageSize, size);
        assert.equal(result.page, page); assert.equal(result.totalPages, Math.ceil(rows.length/size));
        ids.push(...result.rooms.map(room => room.roomId));
      }
      assert.equal(new Set(ids).size, 125);
      assert.deepEqual(ids, [...rows].sort((a,b) => compare(sort,a,b)).map(room => room.room_id));
    }
    const expected = rows.filter(room => room.status === 'available' && room.price >= 1100 && room.price <= 1300 && room.price_basis === 'per_room');
    const filtered = await api(path('page=1&status=available&minPrice=1100&maxPrice=1300&minSlots=2&priceBasis=per_room&sort=price_asc'), viewer);
    assert.equal(filtered.total, expected.length);
    assert.deepEqual(filtered.rooms.map(room => room.roomId), expected.sort((a,b) => a.price-b.price || b.room_id-a.room_id).slice(0,size).map(room => room.room_id));
    assert.equal((await api(path(''), viewer)).rooms.length, 125); // Legacy callers still get the full array.
    assert.equal((await api(path(`pageSize=${size}`), viewer)).rooms.length, size);
    assert.equal((await api(path(`pageSize=${size+1}`), viewer)).status, 400);
    assert.equal((await api(path('pageSize=100'), viewer)).status, 400);
    const last = await api(path('page=9007199254740991'), viewer);
    assert.equal(last.page, Math.ceil(125/size)); assert.ok(last.rooms.length > 0);
    for (const query of ['page=0','page=','page=-1','page=1.2','page=abc','page=1e2','page=9007199254740992','pageSize=0','pageSize=101','pageSize=','page=1&limit=10','page=1&offset=0','page=1&sort=toString','page=1&status=bogus']) {
      assert.equal((await api(path(query),viewer)).status,400,query);
    }
    const empty = await api(path('page=99&minPrice=999999'), viewer);
    assert.equal(empty.total,0); assert.equal(empty.page,1); assert.equal(empty.totalPages,0); assert.deepEqual(empty.rooms,[]);
    assert.equal((await api(path('page=2'),null)).status,401);
    assert.equal((await api(path('page=2'),4)).total,0);
    // Another account's favorites and ownership never affect this viewer's count.
    await db.prepare('INSERT INTO ROOM_FAVORITE(user_id,room_id) VALUES(4,?)').run(rows[0].room_id);
    const other = await api(path('page=1'),4);
    assert.equal(other.total,endpoint === '/favorites' ? 1 : 0);
    assert.equal((await api(path('page=1'),viewer)).total,125);
    assert.equal((await api(`/rooms/${rows[0].room_id}`,4,'DELETE')).status,403);
  });

  test(`${endpoint} removing the last item clamps one page, then handles zero records`, async t => {
    const { db, api, rows } = await fixture(t, size+1);
    const path = `${endpoint}?q=Private%20pagination&page=2`;
    const last = await api(path,viewer);
    assert.equal(last.rooms.length,1);
    const remove = id => api(`/rooms/${id}${endpoint === '/favorites' ? '/favorite' : ''}`,viewer,'DELETE');
    assert.equal((await remove(last.rooms[0].roomId)).status,200);
    const clamped = await api(path,viewer);
    assert.equal(clamped.page,1); assert.equal(clamped.total,size); assert.equal(clamped.rooms.length,size);
    if (endpoint === '/favorites') assert.equal((await api(`/rooms/${last.rooms[0].roomId}`,viewer)).status,200);
    const keep = clamped.rooms[0].roomId;
    if (endpoint === '/favorites') await db.prepare('DELETE FROM ROOM_FAVORITE WHERE user_id=3 AND room_id=ANY(?::bigint[]) AND room_id!=?').run(rows.map(room => room.room_id),keep);
    else await db.prepare('DELETE FROM ROOM WHERE room_id=ANY(?::bigint[]) AND room_id!=?').run(rows.map(room => room.room_id),keep);
    assert.equal((await remove(keep)).status,200);
    const empty = await api(path,viewer);
    assert.equal(empty.page,1); assert.equal(empty.total,0); assert.deepEqual(empty.rooms,[]);
  });
}
