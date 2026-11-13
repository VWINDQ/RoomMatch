
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { startRoomMatchServer } from '../server/app.js';
import { openDatabase } from '../server/database.js';

const database = openDatabase({ filename: ':memory:' });

let application;
let baseUrl;
let alice;
let bob;
let roomId;

before(async () => {
  application = await startRoomMatchServer({
    db: database,
    host: '127.0.0.1',
    port: 0,
    logger: { error: () => {} },
  });

  baseUrl = `http://127.0.0.1:${application.server.address().port}`;

  alice = await register('FavoriteAlice');
  bob = await register('FavoriteBob');

  const room = database.prepare(
    'SELECT room_id FROM ROOM ORDER BY room_id LIMIT 1'
  ).get();

  assert.ok(room, 'Expected at least one seeded room');
  roomId = room.room_id;
});

after(async () => {
  if (application) {
    await new Promise((resolve) => application.server.close(resolve));
  }
  database.close();
});

async function api(path, { token, method = 'GET' } = {}) {
  const response = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: token
      ? { Authorization: `Bearer ${token}` }
      : {},
  });

  return {
    status: response.status,
    body: await response.json(),
  };
}

async function register(name) {
  const result = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      firstName: name,
      lastName: 'FavoriteTest',
      email: `${name.toLowerCase()}@favorite.test`,
      phone: '0800000000',
      password: 'favorite-test-password',
    }),
  });

  const body = await result.json();
  assert.equal(result.status, 201);

  return {
    token: body.token,
    userId: body.user.userId,
  };
}

test('FAV-01: empty favorites list', async () => {
  const result = await api('/favorites', { token: alice.token });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.rooms, []);
});

test('FAV-02: add a room to favorites', async () => {
  const result = await api(`/rooms/${roomId}/favorite`, {
    token: alice.token,
    method: 'PUT',
  });

  assert.equal(result.status, 200);

  const saved = database.prepare(`
    SELECT *
    FROM ROOM_FAVORITE
    WHERE user_id = ? AND room_id = ?
  `).get(alice.userId, roomId);

  assert.ok(saved);
});

test('FAV-03: adding the same room twice does not duplicate it', async () => {
  const result = await api(`/rooms/${roomId}/favorite`, {
    token: alice.token,
    method: 'PUT',
  });

  assert.equal(result.status, 200);

  const count = database.prepare(`
    SELECT COUNT(*) AS count
    FROM ROOM_FAVORITE
    WHERE user_id = ? AND room_id = ?
  `).get(alice.userId, roomId).count;

  assert.equal(count, 1);
});

test('FAV-04: favorites are isolated between users', async () => {
  const aliceResult = await api('/favorites', {
    token: alice.token,
  });

  const bobResult = await api('/favorites', {
    token: bob.token,
  });

  assert.equal(aliceResult.status, 200);
  assert.equal(bobResult.status, 200);

  assert.equal(aliceResult.body.rooms.length, 1);
  assert.equal(aliceResult.body.rooms[0].roomId, roomId);
  assert.deepEqual(bobResult.body.rooms, []);
});

test('FAV-05: unauthenticated requests are rejected', async () => {
  const getResult = await api('/favorites');
  const putResult = await api(`/rooms/${roomId}/favorite`, {
    method: 'PUT',
  });
  const deleteResult = await api(`/rooms/${roomId}/favorite`, {
    method: 'DELETE',
  });

  assert.equal(getResult.status, 401);
  assert.equal(putResult.status, 401);
  assert.equal(deleteResult.status, 401);
});

test('FAV-06: cannot favorite a nonexistent room', async () => {
  const result = await api('/rooms/999999/favorite', {
    token: alice.token,
    method: 'PUT',
  });

  assert.equal(result.status, 404);
});

test('FAV-07: remove a room from favorites', async () => {
  const result = await api(`/rooms/${roomId}/favorite`, {
    token: alice.token,
    method: 'DELETE',
  });

  assert.equal(result.status, 200);

  const count = database.prepare(`
    SELECT COUNT(*) AS count
    FROM ROOM_FAVORITE
    WHERE user_id = ? AND room_id = ?
  `).get(alice.userId, roomId).count;

  assert.equal(count, 0);

  const favorites = await api('/favorites', {
    token: alice.token,
  });

  assert.deepEqual(favorites.body.rooms, []);
});


test('FAV-08: favorites are sorted by newest date', async () => {
  const rooms = database.prepare(`
    SELECT room_id
    FROM ROOM
    ORDER BY room_id
    LIMIT 2
  `).all();

  assert.equal(rooms.length, 2, 'Expected at least two rooms');

  const firstRoomId = rooms[0].room_id;
  const secondRoomId = rooms[1].room_id;

  for (const id of [firstRoomId, secondRoomId]) {
    const result = await api(`/rooms/${id}/favorite`, {
      token: alice.token,
      method: 'PUT',
    });
    assert.equal(result.status, 200);
  }

  const updateTime = database.prepare(`
    UPDATE ROOM_FAVORITE
    SET created_at = ?
    WHERE user_id = ? AND room_id = ?
  `);

  updateTime.run(
    '2026-01-02T10:00:00.000Z',
    alice.userId,
    firstRoomId
  );

  updateTime.run(
    '2026-01-01T10:00:00.000Z',
    alice.userId,
    secondRoomId
  );

  const result = await api('/favorites', {
    token: alice.token,
  });

  assert.equal(result.status, 200);

  assert.deepEqual(
    result.body.rooms.map((room) => room.roomId),
    [firstRoomId, secondRoomId]
  );

  updateTime.run(
    '2026-01-02T10:00:00.000Z',
    alice.userId,
    secondRoomId
  );

  const sameTime = await api('/favorites', {
    token: alice.token,
  });

  assert.equal(sameTime.status, 200);

  assert.deepEqual(
    sameTime.body.rooms.map((room) => room.roomId),
    [secondRoomId, firstRoomId]
  );
});


test('FAV-09: deleting a room removes its favorites', async () => {
  const created = await fetch(`${baseUrl}/api/rooms`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${alice.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: 'Favorite Cascade Test Room',
      description: 'Room created for testing favorite cascade.',
      googleMapsUrl: 'https://maps.google.com/?q=13.7,100.5',
      price: 5000,
      capacity: 2,
      images: ['https://images.example.test/room.jpg'],
    }),
  });

  const createdBody = await created.json();
  assert.equal(created.status, 201);

  const testRoomId = createdBody.room.roomId;

  const favorite = await api(`/rooms/${testRoomId}/favorite`, {
    token: bob.token,
    method: 'PUT',
  });

  assert.equal(favorite.status, 200);

  const countFavorite = database.prepare(`
    SELECT COUNT(*) AS count
    FROM ROOM_FAVORITE
    WHERE user_id = ? AND room_id = ?
  `);

  assert.equal(
    countFavorite.get(bob.userId, testRoomId).count,
    1
  );

  const forbidden = await api(`/rooms/${testRoomId}`, {
    token: bob.token,
    method: 'DELETE',
  });

  assert.equal(forbidden.status, 403);

  assert.equal(
    countFavorite.get(bob.userId, testRoomId).count,
    1
  );

  const deleted = await api(`/rooms/${testRoomId}`, {
    token: alice.token,
    method: 'DELETE',
  });

  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.success, true);

  const room = database.prepare(`
    SELECT room_id
    FROM ROOM
    WHERE room_id = ?
  `).get(testRoomId);

  assert.equal(room, undefined);

  assert.equal(
    countFavorite.get(bob.userId, testRoomId).count,
    0
  );

  const favorites = await api('/favorites', {
    token: bob.token,
  });

  assert.equal(favorites.status, 200);
  assert.equal(
    favorites.body.rooms.some(
      (room) => room.roomId === testRoomId
    ),
    false
  );
});


/*Test	สิ่งที่ตรวจสอบ
FAV-01	รายการ Favorites เริ่มต้นว่าง
FAV-02	เพิ่ม Favorites แล้วบันทึกลง Database
FAV-03	เพิ่มห้องเดิมซ้ำแล้วไม่เกิดข้อมูลซ้ำ
FAV-04	User A และ User B มี Favorites แยกกัน
FAV-05	ไม่ Login ต้องเรียก Favorites API ไม่ได้
FAV-06	เพิ่มห้องที่ไม่มีอยู่ไม่ได้
FAV-07	ลบ Favorites แล้วข้อมูลหายจาก Database*/