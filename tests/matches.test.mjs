import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startRoomMatchServer } from '../server/app.js';
import { createToken } from '../server/auth.js';
import { openDatabase } from '../server/database.js';

let db, application, baseUrl;

async function start() {
  application = await startRoomMatchServer({ db, host: '127.0.0.1', port: 0, logger: { error() {} } });
  baseUrl = `http://127.0.0.1:${application.server.address().port}/api`;
}

beforeEach(async () => {
  db = openDatabase({ filename: ':memory:', seed: false });
  const insert = db.prepare(`INSERT INTO USER
    (user_id, first_name, last_name, email, password_hash, phone, line_id, instagram, date_of_birth, bio)
    VALUES (?, ?, 'Match test', ?, 'unused-test-hash', '0890000000', ?, ?, '2000-01-01', 'คำแนะนำตัว')`);
  for (let id = 1; id <= 6; id += 1) {
    insert.run(id, `Student ${id}`, `match-${id}@example.test`, `line-${id}`, `instagram-${id}`);
  }
  await start();
});

afterEach(async () => {
  if (application) await new Promise(resolve => application.server.close(resolve));
  db?.close();
});

async function api(path, userId, method = 'GET', payload) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(userId ? { Authorization: `Bearer ${createToken(userId)}` } : {}),
      ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  return { status: response.status, body: await response.json() };
}

async function room(ownerId = 1, capacity = 3) {
  const result = await api('/rooms', ownerId, 'POST', {
    title: 'ห้องทดสอบสมาชิก', description: 'ห้องที่ใช้ตรวจสมาชิกและแมตช์',
    googleMapsUrl: 'https://maps.google.com/?q=KMUTT', price: 5000, capacity, images: [],
  });
  assert.equal(result.status, 201);
  return result.body.room.roomId;
}

async function request(roomId, userId) {
  const result = await api(`/rooms/${roomId}/requests`, userId, 'POST');
  assert.equal(result.status, 201);
  return result.body.request.requestId;
}

async function approve(roomId, userId = 2, ownerId = 1) {
  const requestId = await request(roomId, userId);
  const result = await api(`/requests/${requestId}`, ownerId, 'PATCH', { status: 'approved' });
  assert.equal(result.status, 200);
  return result.body.match;
}

function snapshot() {
  return Object.fromEntries(['ROOM', 'ROOM_REQUEST', 'ROOM_MEMBER', 'MATCHES', 'USER'].map(table => [
    table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
  ]));
}

test('members and matches require authentication; invalid room IDs are rejected', async () => {
  const roomId = await room();
  assert.equal((await api('/matches')).status, 401);
  assert.equal((await api(`/rooms/${roomId}/members`)).status, 401);
  for (const id of ['0', '9007199254740993', '999999999999999999999999999999']) {
    assert.equal((await api(`/rooms/${id}/members`, 1)).status, 400, id);
  }
  assert.equal((await api('/rooms/999999/members', 1)).status, 404);
});

test('an empty match list and an owner-only room have correct response shapes', async () => {
  const roomId = await room();
  for (const userId of [1, 2, 3]) {
    assert.deepEqual(await api('/matches', userId), { status: 200, body: { matches: [] } });
  }
  const result = await api(`/rooms/${roomId}/members`, 1);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.members.map(member => [member.userId, member.status]), [[1, 'owner']]);
});

test('pending/rejected applicants and unrelated users cannot read the member list', async () => {
  const roomId = await room();
  const pending = await request(roomId, 2);
  const rejected = await request(roomId, 3);
  assert.equal((await api(`/requests/${rejected}`, 1, 'PATCH', { status: 'rejected' })).status, 200);
  for (const userId of [2, 3, 4]) {
    assert.equal((await api(`/rooms/${roomId}/members`, userId)).status, 403);
    assert.deepEqual((await api('/matches', userId)).body.matches, []);
  }
  assert.equal(db.prepare('SELECT status FROM ROOM_REQUEST WHERE request_id = ?').get(pending).status, 'pending');
});

test('public room details cannot bypass member-list authorization', async () => {
  const roomId = await room();
  await approve(roomId);
  await request(roomId, 3);
  for (const userId of [null, 3, 4]) {
    const details = await api(`/rooms/${roomId}`, userId);
    assert.equal(details.status, 200);
    assert.deepEqual(details.body.room.members, [], `viewer ${userId}`);
    assert.equal(details.body.room.memberCount, 1);
    assert.equal(details.body.room.availableSlots, 1);
    assert.equal(details.body.room.owner.userId, 1);
  }
  for (const userId of [1, 2]) {
    const details = await api(`/rooms/${roomId}`, userId);
    assert.deepEqual(details.body.room.members.map(member => member.userId), [2]);
    assert.equal('lineId' in details.body.room.members[0], false);
  }
});

test('owner and approved members see the owner exactly once, with safe fields and stable ordering', async () => {
  const roomId = await room();
  await approve(roomId, 2);
  await approve(roomId, 3);
  // Legacy SQL timestamps sort before ISO timestamps unless normalized; owner must stay first.
  db.prepare('UPDATE ROOM SET created_at = ? WHERE room_id = ?').run('2026-01-01T00:00:00.000Z', roomId);
  db.prepare('UPDATE ROOM_MEMBER SET joined_at = ? WHERE room_id = ?').run('2026-01-01 00:00:00', roomId);
  const initial = snapshot();
  for (const userId of [1, 2, 3]) {
    const result = await api(`/rooms/${roomId}/members`, userId);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.members.map(member => [member.userId, member.status]), [[1, 'owner'], [2, 'approved'], [3, 'approved']]);
    for (const member of result.body.members) {
      assert.deepEqual(Object.keys(member).sort(), ['firstName', 'joinedAt', 'lastName', 'profileImage', 'status', 'userId']);
      assert.match(member.joinedAt, /^\d{4}-\d{2}-\d{2}T.*Z$/);
    }
  }
  assert.deepEqual(snapshot(), initial);
  assert.equal(db.prepare('SELECT count(*) AS count FROM ROOM_MEMBER WHERE user_id = 1').get().count, 0);
});

test('match lists are scoped to the authenticated user and return the other participant', async () => {
  const roomId = await room();
  const first = await approve(roomId, 2);
  const second = await approve(roomId, 3);
  const otherRoom = await room(4, 2);
  await approve(otherRoom, 5, 4);
  // Force a timestamp tie to verify match_id DESC provides deterministic order.
  db.exec("UPDATE MATCHES SET matched_at = '2026-01-01T00:00:00.000Z'");
  const initial = snapshot();
  db.exec('PRAGMA query_only = ON');
  try {
    const ownerMatches = await api('/matches?userId=4', 1);
    assert.equal(ownerMatches.status, 200);
    assert.deepEqual(ownerMatches.body.matches.map(match => match.matchId), [second.matchId, first.matchId]);
    assert.deepEqual(ownerMatches.body.matches.map(match => match.otherUser.userId), [3, 2]);
    const memberMatches = (await api('/matches', 2)).body.matches;
    assert.equal(memberMatches.length, 1);
    assert.equal(memberMatches[0].room.roomId, roomId);
    assert.equal(memberMatches[0].otherUser.userId, 1);
    assert.equal(memberMatches[0].otherUser.lineId, 'line-1');
    assert.equal(memberMatches[0].otherUser.instagram, 'instagram-1');
    assert.deepEqual(Object.keys(memberMatches[0].otherUser).sort(), ['bio', 'firstName', 'instagram', 'lastName', 'lineId', 'profileImage', 'userId']);
    assert.equal((await api(`/rooms/${roomId}/members`, 2)).status, 200);
    assert.deepEqual((await api('/matches', 6)).body.matches, []);
  } finally { db.exec('PRAGMA query_only = OFF'); }
  assert.deepEqual(snapshot(), initial);
});

test('leaving a room revokes member access and hides stale match contacts without deleting history', async () => {
  const roomId = await room();
  await approve(roomId, 2);
  db.prepare("UPDATE ROOM_MEMBER SET status = 'left' WHERE room_id = ? AND user_id = ?").run(roomId, 2);
  assert.equal((await api(`/rooms/${roomId}/members`, 2)).status, 403);
  assert.deepEqual((await api('/matches', 2)).body.matches, []);
  assert.deepEqual((await api('/matches', 1)).body.matches, []);
  assert.deepEqual((await api(`/rooms/${roomId}`, 2)).body.room.members, []);
  assert.equal(db.prepare('SELECT count(*) AS count FROM MATCHES').get().count, 1);
});

test('pausing a listing keeps current members and matches available to participants', async () => {
  const roomId = await room();
  await approve(roomId);
  assert.equal((await api(`/rooms/${roomId}`, 1, 'PATCH', { status: 'inactive' })).status, 200);
  for (const userId of [1, 2]) {
    assert.equal((await api(`/rooms/${roomId}/members`, userId)).status, 200);
    assert.equal((await api('/matches', userId)).body.matches.length, 1);
  }
});

test('deleting a room removes its matches and member rows instead of leaving broken references', async () => {
  const roomId = await room();
  await approve(roomId);
  assert.equal((await api(`/rooms/${roomId}`, 1, 'DELETE')).status, 200);
  assert.equal((await api(`/rooms/${roomId}/members`, 2)).status, 404);
  assert.deepEqual((await api('/matches', 1)).body.matches, []);
  assert.deepEqual((await api('/matches', 2)).body.matches, []);
  assert.equal(db.prepare('SELECT count(*) AS count FROM ROOM_MEMBER').get().count, 0);
  assert.equal(db.prepare('SELECT count(*) AS count FROM MATCHES').get().count, 0);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('unavailable database tables return generic errors without SQL or contact details', async () => {
  const roomId = await room();
  await approve(roomId);
  db.exec('DROP TABLE MATCHES');
  assert.deepEqual(await api('/matches', 2), { status: 500, body: { error: 'Internal server error' } });
  db.exec('DROP TABLE ROOM_MEMBER');
  assert.deepEqual(await api(`/rooms/${roomId}/members`, 2), { status: 500, body: { error: 'Internal server error' } });
});

test('inactive accounts cannot access members or match contacts', async () => {
  const roomId = await room();
  await approve(roomId);
  db.prepare('UPDATE USER SET is_active = 0 WHERE user_id = ?').run(2);
  assert.equal((await api('/matches', 2)).status, 401);
  assert.equal((await api(`/rooms/${roomId}/members`, 2)).status, 401);
});

test('member and match reads survive a database restart without modifying persisted records', async () => {
  const roomId = await room();
  await approve(roomId);
  const filename = join(mkdtempSync(join(tmpdir(), 'roommatch-matches-')), 'matches.sqlite');
  db.exec(`VACUUM INTO '${filename.replaceAll("'", "''")}'`);
  const initial = snapshot();
  await new Promise(resolve => application.server.close(resolve));
  db.close();
  db = openDatabase({ filename, seed: false });
  await start();
  assert.equal((await api(`/rooms/${roomId}/members`, 2)).body.members.length, 2);
  assert.equal((await api('/matches', 2)).body.matches.length, 1);
  assert.deepEqual(snapshot(), initial);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});
