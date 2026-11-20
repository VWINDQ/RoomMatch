import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createToken } from '../server/auth.js';
import { startRoomMatchServer } from '../server/app.js';
import { openDatabase } from './support/postgres.mjs';

async function fixture(t) {
  const db = await openDatabase({ filename: ':memory:', seed: false });
  for (let id = 1; id <= 4; id++) await db.prepare('INSERT INTO USER(user_id,first_name,last_name,email,password_hash) VALUES(?,?,?,?,?)')
    .run(id, `Student ${id}`, 'Occupancy test', `occupancy-${id}@example.test`, 'unused-test-hash');
  const app = await startRoomMatchServer({ db, port: 0, logger: { error() {} } });
  t.after(async () => { await new Promise(resolve => app.server.close(resolve)); await db.close(); });
  const api = async (path, user = 1, method = 'GET', body) => {
    const response = await fetch(`http://127.0.0.1:${app.server.address().port}/api${path}`, { method,
      headers: { ...(user ? { Authorization: `Bearer ${createToken(user)}` } : {}), 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json() };
  };
  const create = async (changes = {}) => {
    const result = await api('/rooms', 1, 'POST', { title: 'ห้องให้เช่าทดสอบ', description: 'ผู้ลงประกาศไม่จำเป็นต้องพัก',
      price: 6000, capacity: 2, priceBasis: 'per_room', locality: 'บางมด', googleMapsUrl: 'https://maps.google.com/', images: ['https://example.test/room.jpg'], ...changes });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    return result.body.room;
  };
  const request = async (roomId, user) => {
    const result = await api(`/rooms/${roomId}/requests`, user, 'POST');
    assert.equal(result.status, 201, JSON.stringify(result.body));
    return result.body.request.requestId;
  };
  const approve = requestId => api(`/requests/${requestId}`, 1, 'PATCH', { status: 'approved' });
  return { db, api, create, request, approve };
}

test('a one-person rental has one vacancy without counting its landlord and restores it on leaving', async t => {
  const { api, create, request, approve } = await fixture(t);
  const room = await create({ capacity: 1 });
  assert.equal(room.ownerIsResident, false);
  assert.equal(room.occupantCount, 0);
  assert.equal(room.availableSlots, 1);
  assert.equal(room.status, 'available');
  assert.deepEqual((await api(`/rooms/${room.roomId}/members`)).body.members, []);
  const requestId = await request(room.roomId, 2);
  assert.equal((await approve(requestId)).status, 200);
  const full = (await api(`/rooms/${room.roomId}`, 2)).body.room;
  assert.equal(full.availableSlots, 0); assert.equal(full.occupantCount, 1); assert.equal(full.memberCount, 1); assert.equal(full.status, 'full');
  assert.deepEqual((await api(`/rooms/${room.roomId}/members`, 2)).body.members.map(row => row.userId), [2]);
  const match = (await api('/matches', 2)).body.matches[0];
  assert.equal(match.otherRole, 'owner');
  assert.equal(match.room.ownerIsResident, false);
  assert.equal((await api(`/rooms/${room.roomId}/members/me`, 2, 'DELETE')).status, 200);
  assert.equal((await api(`/rooms/${room.roomId}`)).body.room.availableSlots, 1);
  assert.deepEqual((await api('/matches', 2)).body.matches, []);
});

test('an owner counts as one occupant only when explicitly marked as living there', async t => {
  const { api, create, request, approve } = await fixture(t);
  const room = await create({ ownerIsResident: true });
  assert.equal(room.ownerIsResident, true); assert.equal(room.occupantCount, 1); assert.equal(room.availableSlots, 1);
  assert.deepEqual((await api(`/rooms/${room.roomId}/members`)).body.members.map(row => row.userId), [1]);
  assert.equal((await approve(await request(room.roomId, 2))).status, 200);
  assert.equal((await api(`/rooms/${room.roomId}`)).body.room.occupantCount, 2);
  assert.deepEqual((await api(`/rooms/${room.roomId}/members`, 2)).body.members.map(row => row.userId), [1, 2]);
  assert.equal((await api(`/rooms/${room.roomId}/members/me`, 2, 'DELETE')).status, 200);
  assert.equal((await api(`/rooms/${room.roomId}`)).body.room.availableSlots, 1);
});

test('vacancy and joint-search filters count actual occupants, including resident owners only', async t => {
  const { db, api, create } = await fixture(t);
  const rental = await create();
  const shared = await create({ ownerIsResident: true });
  const single = await create({ capacity: 1 });
  await db.exec("INSERT INTO FRIEND_CONNECTION(sender_id,recipient_id,status,responded_at) VALUES(2,3,'accepted',CURRENT_TIMESTAMP),(1,2,'accepted',CURRENT_TIMESTAMP)");
  assert.deepEqual((await api('/rooms?minSlots=2')).body.rooms.map(r => r.roomId), [rental.roomId]);
  assert.deepEqual((await api('/rooms?withFriend=3', 2)).body.rooms.map(r => r.roomId), [rental.roomId]);
  const ownSearch = (await api('/rooms?withFriend=2', 1)).body.rooms.map(r => r.roomId);
  assert.ok(ownSearch.includes(rental.roomId)); assert.ok(ownSearch.includes(shared.roomId)); assert.ok(!ownSearch.includes(single.roomId));
  await api(`/rooms/${rental.roomId}/favorite`, 2, 'PUT'); await api(`/rooms/${shared.roomId}/favorite`, 2, 'PUT');
  assert.deepEqual((await api('/favorites?minSlots=2', 2)).body.rooms.map(r => r.roomId), [rental.roomId]);
  assert.deepEqual((await api('/my/rooms?minSlots=2', 1)).body.rooms.map(r => r.roomId), [rental.roomId]);
});

test('changing owner residence cannot overbook, preserves paused status and applies capacity changes atomically', async t => {
  const { api, create, request, approve } = await fixture(t);
  const room = await create({ capacity: 1 });
  await approve(await request(room.roomId, 2));
  assert.equal((await api(`/rooms/${room.roomId}`, 1, 'PATCH', { ownerIsResident: true })).status, 409);
  assert.equal((await api(`/rooms/${room.roomId}`)).body.room.ownerIsResident, false);
  const enlarged = await api(`/rooms/${room.roomId}`, 1, 'PATCH', { capacity: 2, ownerIsResident: true });
  assert.equal(enlarged.status, 200); assert.equal(enlarged.body.room.status, 'full');
  const reduced = await api(`/rooms/${room.roomId}`, 1, 'PATCH', { capacity: 1, ownerIsResident: false });
  assert.equal(reduced.status, 200); assert.equal(reduced.body.room.occupantCount, 1);
  assert.equal((await api(`/rooms/${room.roomId}`, 1, 'PATCH', { status: 'inactive' })).status, 200);
  const paused = await api(`/rooms/${room.roomId}`, 1, 'PATCH', { capacity: 3, ownerIsResident: true });
  assert.equal(paused.status, 200); assert.equal(paused.body.room.status, 'inactive');
  const reopened = await api(`/rooms/${room.roomId}`, 1, 'PATCH', { status: 'available' });
  assert.equal(reopened.body.room.status, 'available'); assert.equal(reopened.body.room.availableSlots, 1);
});

test('residence flag validation and permissions cannot change a room on invalid input', async t => {
  const { api, create } = await fixture(t);
  const room = await create();
  for (const value of ['true', 1, null, [], {}]) assert.equal((await api(`/rooms/${room.roomId}`, 1, 'PATCH', { ownerIsResident: value })).status, 400);
  assert.equal((await api(`/rooms/${room.roomId}`, 2, 'PATCH', { ownerIsResident: true })).status, 403);
  assert.equal((await api(`/rooms/${room.roomId}`)).body.room.ownerIsResident, false);
});

test('concurrent rental approvals fill exactly the advertised number of places', async t => {
  const { api, create, request, approve } = await fixture(t);
  const room = await create();
  const requests = await Promise.all([2, 3, 4].map(user => request(room.roomId, user)));
  const decisions = await Promise.all(requests.map(approve));
  assert.deepEqual(decisions.map(r => r.status).sort(), [200, 200, 409]);
  const full = (await api(`/rooms/${room.roomId}`)).body.room;
  assert.equal(full.occupantCount, 2); assert.equal(full.availableSlots, 0); assert.equal(full.status, 'full');
});

test('database triggers reject overbooking from residence changes and refresh availability after departure', async t => {
  const { db, api, create, request, approve } = await fixture(t);
  const room = await create({ capacity: 1 });
  await approve(await request(room.roomId, 2));
  await assert.rejects(db.prepare('UPDATE ROOM SET owner_is_resident = true WHERE room_id = ?').run(room.roomId), /capacity cannot be lower than current occupancy/);
  await db.prepare("UPDATE ROOM_MEMBER SET status='left' WHERE room_id=? AND user_id=2").run(room.roomId);
  assert.equal((await api(`/rooms/${room.roomId}`)).body.room.status, 'available');
  await db.prepare('UPDATE ROOM SET owner_is_resident = true WHERE room_id = ?').run(room.roomId);
  assert.equal((await api(`/rooms/${room.roomId}`)).body.room.status, 'full');
});

test('a residence change racing with approval cannot reserve the same last place twice', async t => {
  const { api, create, request, approve } = await fixture(t);
  const room = await create({ capacity: 1 });
  const requestId = await request(room.roomId, 2);
  const results = await Promise.all([approve(requestId), api(`/rooms/${room.roomId}`, 1, 'PATCH', { ownerIsResident: true })]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  const full = (await api(`/rooms/${room.roomId}`)).body.room;
  assert.equal(full.occupantCount, 1); assert.equal(full.status, 'full'); assert.equal(full.availableSlots, 0);
});
