import assert from 'node:assert/strict';

import { test } from 'node:test';
import { createToken } from '../server/auth.js';
import { openDatabase } from './support/postgres.mjs';
import { startRoomMatchServer } from '../server/app.js';

async function fixture(t) {
  const db = await openDatabase({ filename: ':memory:' });
  const app = await startRoomMatchServer({ db, port: 0, logger: { error() {} } });
  t.after(async () => { await new Promise(resolve => app.server.close(resolve)); await db.close(); });
  const api = async (path, user = 3, method = 'GET', body) => {
    const response = await fetch(`http://127.0.0.1:${app.server.address().port}/api${path}`, { method,
      headers: { ...(user ? { Authorization: `Bearer ${createToken(user)}` } : {}), 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json() };
  };
  return { db, api };
}

test('removing a stale favorite succeeds after its owner deleted the room', async t => {
  const { db, api } = await fixture(t);
  const created = await api('/rooms', 1, 'POST', { title: 'Stale favorite', description: 'Test', googleMapsUrl: 'https://maps.google.com/', price: 4000, capacity: 2, priceBasis: 'per_room', locality: 'ประชาอุทิศ', images: ['https://example.test/room.jpg'] });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const roomId = created.body.room.roomId;
  assert.equal((await api(`/rooms/${roomId}/favorite`, 3, 'PUT')).status, 200);
  assert.equal((await api('/favorites')).body.rooms.length, 1);
  assert.equal((await api(`/rooms/${roomId}`, 1, 'DELETE')).status, 200);
  for (let attempt = 0; attempt < 2; attempt++) {
    const removed = await api(`/rooms/${roomId}/favorite`, 3, 'DELETE');
    assert.equal(removed.status, 200);
    assert.deepEqual(removed.body, { success: true });
  }
  assert.deepEqual((await api('/favorites')).body.rooms, []);
  assert.deepEqual(await db.prepare('SELECT * FROM ROOM_FAVORITE WHERE room_id = ?').all(roomId), []);
  assert.equal((await api(`/rooms/${roomId}/favorite`, 3, 'PUT')).status, 404);
});

test('idempotent unfavorite still validates input, protects other users and reports write failures', async t => {
  const { db, api } = await fixture(t);
  for (const user of [3, 4]) assert.equal((await api('/rooms/1/favorite', user, 'PUT')).status, 200);
  assert.equal((await api('/rooms/1/favorite', null, 'DELETE')).status, 401);
  assert.equal((await api('/rooms/0/favorite', 3, 'DELETE')).status, 400);
  db.setReadOnly(true);
  assert.equal((await api('/rooms/1/favorite', 3, 'DELETE')).status, 500);
  db.setReadOnly(false);
  assert.equal((await api('/favorites', 3)).body.rooms.length, 1);
  for (let attempt = 0; attempt < 2; attempt++) assert.equal((await api('/rooms/1/favorite', 3, 'DELETE')).status, 200);
  assert.deepEqual((await api('/favorites', 3)).body.rooms, []);
  assert.equal((await api('/favorites', 4)).body.rooms.length, 1);
});

test('favorites survive withdrawal, approval and leaving without changing request history or privacy', async t => {
  const { api } = await fixture(t);
  assert.equal((await api('/rooms/1/favorite', 3, 'PUT')).status, 200);
  const pending = (await api('/rooms/1')).body.room;
  assert.equal(pending.isFavorite, true);
  assert.equal(pending.pendingRequestId, 2);
  assert.equal(pending.isMember, false);
  assert.equal((await api('/requests/2/cancel', 3, 'POST')).status, 200);
  assert.equal((await api('/rooms/1')).body.room.isFavorite, true);
  const again = await api('/rooms/1/requests', 3, 'POST');
  assert.equal((await api(`/requests/${again.body.request.requestId}`, 1, 'PATCH', { status: 'approved' })).status, 200);
  assert.equal((await api('/rooms/1')).body.room.isMember, true);
  assert.equal((await api('/favorites')).body.rooms[0].isFavorite, true);
  assert.equal((await api('/rooms/1/members/me', 3, 'DELETE')).status, 200);
  const afterLeaving = (await api('/rooms/1')).body.room;
  assert.equal(afterLeaving.isFavorite, true);
  assert.equal(afterLeaving.isMember, false);
  assert.equal(afterLeaving.status, 'available');
  assert.deepEqual(afterLeaving.members, []);
  assert.equal((await api('/rooms/1/members')).status, 403);
  assert.equal((await api('/rooms/1/favorite', 3, 'DELETE')).status, 200);
  assert.deepEqual((await api('/favorites')).body.rooms, []);
  assert.equal((await api('/requests/mine')).body.requests.filter(row => row.room.roomId === 1).length, 2);
});

test('favorite status coexists with price units, locality and shared-room vacancy filtering', async t => {
  const { db, api } = await fixture(t);
  const created = await api('/rooms', 1, 'POST', { title: 'ห้องสำหรับเพื่อนสองคน', description: 'ห้องทดสอบ', googleMapsUrl: 'https://maps.google.com/', price: 6000, capacity: 3, images: ['https://example.test/room.jpg'], priceBasis: 'per_room', locality: 'ประชาอุทิศ', costNotes: 'เงินประกันหนึ่งเดือน' });
  assert.equal(created.status, 201);
  const roomId = created.body.room.roomId;
  await db.exec("INSERT INTO FRIEND_CONNECTION(sender_id,recipient_id,status,responded_at) VALUES(3,4,'accepted',CURRENT_TIMESTAMP)");
  assert.equal((await api(`/rooms/${roomId}/favorite`, 3, 'PUT')).status, 200);
  const result = await api('/rooms?minSlots=2&priceBasis=per_room&withFriend=4&q=ประชาอุทิศ');
  assert.equal(result.status, 200);
  assert.equal(result.body.rooms.length, 1);
  assert.equal(result.body.rooms[0].isFavorite, true);
  assert.equal(result.body.rooms[0].costNotes, 'เงินประกันหนึ่งเดือน');
  assert.equal((await api(`/rooms/${roomId}`, 4)).body.room.isFavorite, false);
  assert.equal((await api(`/rooms/${roomId}`, null)).body.room.isFavorite, false);
  assert.equal((await api(`/rooms/${roomId}`, 1)).body.room.isOwner, true);
});
