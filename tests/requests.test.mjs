import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startRoomMatchServer } from '../server/app.js';
import { createToken } from '../server/auth.js';
import { openDatabase } from '../server/database.js';

let db, application, baseUrl;
const headersFor = userId => ({ Authorization: `Bearer ${createToken(userId)}` });

beforeEach(async () => {
  db = openDatabase({ filename: ':memory:', seed: false });
  const insert = db.prepare('INSERT INTO USER (user_id, first_name, last_name, email, password_hash) VALUES (?, ?, ?, ?, ?)');
  for (let id = 1; id <= 4; id += 1) {
    insert.run(id, `Student ${id}`, 'Request test', `request-${id}@example.test`, 'unused-test-hash');
  }
  application = await startRoomMatchServer({ db, host: '127.0.0.1', port: 0, logger: { error() {} } });
  baseUrl = `http://127.0.0.1:${application.server.address().port}`;
});

afterEach(async () => {
  if (application) await new Promise(resolve => application.server.close(resolve));
  db?.close();
});

async function api(path, userId, method = 'GET', payload) {
  const response = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: { ...(userId ? headersFor(userId) : {}), ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  return { status: response.status, body: await response.json() };
}

async function createRoom(ownerId = 1, overrides = {}) {
  const result = await api('/rooms', ownerId, 'POST', {
    title: 'ห้องทดสอบคำขอ', description: 'เก็บรายละเอียดแยกจากชื่อใน API',
    googleMapsUrl: 'https://maps.google.com/?q=KMUTT', price: 5000,
    capacity: 2, images: [], ...overrides,
  });
  assert.equal(result.status, 201);
  return result.body.room.roomId;
}

async function sendRequest(roomId, userId = 2) {
  const result = await api(`/rooms/${roomId}/requests`, userId, 'POST');
  assert.equal(result.status, 201);
  return result.body.request;
}

function snapshot() {
  return Object.fromEntries(['ROOM_REQUEST', 'ROOM_MEMBER', 'MATCHES', 'ROOM'].map(table => [
    table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
  ]));
}

test('request endpoints require authentication and empty lists stay isolated', async () => {
  const roomId = await createRoom();
  for (const [path, method, payload] of [
    ['/requests/mine', 'GET'], ['/owner/requests', 'GET'],
    [`/rooms/${roomId}/requests`, 'POST'], ['/requests/1', 'PATCH', { status: 'approved' }],
  ]) assert.equal((await api(path, null, method, payload)).status, 401);
  for (const path of ['/requests/mine', '/owner/requests']) {
    assert.deepEqual((await api(path, 2)).body, { requests: [] });
  }
  assert.equal(db.prepare('SELECT count(*) AS count FROM ROOM_REQUEST').get().count, 0);
});

test('sending a request uses the authenticated identity and exposes only safe profile fields', async () => {
  const roomId = await createRoom();
  const result = await api(`/rooms/${roomId}/requests`, 2, 'POST', { userId: 3, status: 'approved' });
  assert.equal(result.status, 201);
  const request = result.body.request;
  assert.equal(request.status, 'pending');
  assert.equal(request.respondedAt, null);
  assert.equal(request.requester.userId, 2);
  assert.equal(request.room.title, 'ห้องทดสอบคำขอ');
  assert.deepEqual(Object.keys(request.requester).sort(), ['firstName', 'lastName', 'profileImage', 'userId']);
  assert.equal(db.prepare('SELECT user_id FROM ROOM_REQUEST').get().user_id, 2);
  assert.deepEqual((await api('/requests/mine', 2)).body.requests, [request]);
  assert.deepEqual((await api('/owner/requests', 1)).body.requests, [request]);
  assert.deepEqual((await api('/requests/mine', 3)).body.requests, []);
  assert.deepEqual((await api('/owner/requests', 3)).body.requests, []);
  assert.equal((await api(`/rooms/${roomId}`, 2)).body.room.requestStatus, 'pending');
});

test('own-room, duplicate, missing, inactive and full-room submissions do not create records', async () => {
  const roomId = await createRoom();
  assert.equal((await api(`/rooms/${roomId}/requests`, 1, 'POST')).status, 409);
  assert.equal((await api('/rooms/999999/requests', 2, 'POST')).status, 404);
  const inactiveId = await createRoom(1, { status: 'inactive' });
  assert.equal((await api(`/rooms/${inactiveId}/requests`, 2, 'POST')).status, 409);
  const request = await sendRequest(roomId);
  assert.equal((await api(`/rooms/${roomId}/requests`, 2, 'POST')).status, 409);
  assert.equal((await api(`/requests/${request.requestId}`, 1, 'PATCH', { status: 'approved' })).status, 200);
  assert.equal((await api(`/rooms/${roomId}/requests`, 3, 'POST')).status, 409);
  assert.equal((await api(`/rooms/${roomId}/requests`, 2, 'POST')).status, 409);
  assert.equal(db.prepare('SELECT count(*) AS count FROM ROOM_REQUEST').get().count, 1);
});

test('only the room owner can decide and invalid decisions leave the pending request untouched', async () => {
  const request = await sendRequest(await createRoom());
  const initial = snapshot();
  for (const userId of [2, 3]) {
    for (const status of ['approved', 'rejected']) {
      assert.equal((await api(`/requests/${request.requestId}`, userId, 'PATCH', { status })).status, 403);
    }
  }
  for (const payload of [{}, { status: 'pending' }, { status: 'accepted' }, { status: null }]) {
    assert.equal((await api(`/requests/${request.requestId}`, 1, 'PATCH', payload)).status, 400);
  }
  const malformed = await fetch(`${baseUrl}/api/requests/${request.requestId}`, {
    method: 'PATCH', headers: { ...headersFor(1), 'Content-Type': 'application/json' }, body: '{',
  });
  assert.equal(malformed.status, 400);
  assert.equal((await api('/requests/999999', 1, 'PATCH', { status: 'approved' })).status, 404);
  assert.deepEqual(snapshot(), initial);
});

test('request IDs must be positive safe integers', async () => {
  for (const id of ['0', '9007199254740993', '999999999999999999999999999999999999']) {
    assert.equal((await api(`/rooms/${id}/requests`, 2, 'POST')).status, 400, `room ID ${id}`);
    assert.equal((await api(`/requests/${id}`, 1, 'PATCH', { status: 'approved' })).status, 400, `request ID ${id}`);
  }
});

test('approval atomically fills the last place and preserves the existing match response contract', async () => {
  const roomId = await createRoom();
  const request = await sendRequest(roomId);
  const result = await api(`/requests/${request.requestId}`, 1, 'PATCH', { status: 'approved' });
  assert.equal(result.status, 200);
  assert.equal(result.body.request.status, 'approved');
  assert.match(result.body.request.respondedAt, /^\d{4}-\d{2}-\d{2}T.*Z$/);
  assert.equal(result.body.match.otherUser.userId, 2);
  assert.equal(result.body.match.room.roomId, roomId);
  assert.equal(db.prepare('SELECT status FROM ROOM_MEMBER').get().status, 'approved');
  assert.equal(db.prepare('SELECT status FROM ROOM').get().status, 'full');
  assert.equal(db.prepare('SELECT count(*) AS count FROM MATCHES').get().count, 1);
  assert.equal((await api(`/rooms/${roomId}`, 2)).body.room.availableSlots, 0);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  const final = snapshot();
  for (const status of ['approved', 'rejected']) {
    assert.equal((await api(`/requests/${request.requestId}`, 1, 'PATCH', { status })).status, 409);
  }
  assert.deepEqual(snapshot(), final);
});

test('rejection creates no member or match and permits a new request without erasing history', async () => {
  const roomId = await createRoom();
  const first = await sendRequest(roomId);
  const rejected = await api(`/requests/${first.requestId}`, 1, 'PATCH', { status: 'rejected' });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.body.request.status, 'rejected');
  assert.match(rejected.body.request.respondedAt, /^\d{4}-\d{2}-\d{2}T.*Z$/);
  assert.equal('match' in rejected.body, false);
  const second = await sendRequest(roomId);
  assert.notEqual(second.requestId, first.requestId);
  assert.deepEqual((await api('/requests/mine', 2)).body.requests.map(row => row.status), ['pending', 'rejected']);
  assert.equal((await api(`/rooms/${roomId}`, 2)).body.room.requestStatus, 'pending');
  assert.equal(db.prepare('SELECT count(*) AS count FROM ROOM_MEMBER').get().count, 0);
  assert.equal(db.prepare('SELECT count(*) AS count FROM MATCHES').get().count, 0);
  assert.equal((await api(`/requests/${first.requestId}`, 1, 'PATCH', { status: 'approved' })).status, 409);
});

test('two submissions or approvals competing for the same resource produce one winner', async () => {
  const roomId = await createRoom();
  const submissions = await Promise.all([api(`/rooms/${roomId}/requests`, 2, 'POST'), api(`/rooms/${roomId}/requests`, 2, 'POST')]);
  assert.deepEqual(submissions.map(result => result.status).sort(), [201, 409]);
  const first = submissions.find(result => result.status === 201).body.request;
  const second = await sendRequest(roomId, 3);
  const decisions = await Promise.all([first, second].map(request => api(`/requests/${request.requestId}`, 1, 'PATCH', { status: 'approved' })));
  assert.deepEqual(decisions.map(result => result.status).sort(), [200, 409]);
  assert.equal(db.prepare("SELECT count(*) AS count FROM ROOM_REQUEST WHERE status = 'approved'").get().count, 1);
  assert.equal(db.prepare('SELECT count(*) AS count FROM ROOM_MEMBER').get().count, 1);
  assert.equal(db.prepare('SELECT count(*) AS count FROM MATCHES').get().count, 1);
  const loser = [first, second][decisions.findIndex(result => result.status === 409)];
  assert.equal(db.prepare('SELECT status FROM ROOM_REQUEST WHERE request_id = ?').get(loser.requestId).status, 'pending');
  assert.equal((await api(`/requests/${loser.requestId}`, 1, 'PATCH', { status: 'rejected' })).status, 200);
});

test('a room paused after submission cannot be approved but its request can be rejected', async () => {
  const roomId = await createRoom();
  const request = await sendRequest(roomId);
  assert.equal((await api(`/rooms/${roomId}`, 1, 'PATCH', { status: 'inactive' })).status, 200);
  const paused = snapshot();
  assert.equal((await api(`/requests/${request.requestId}`, 1, 'PATCH', { status: 'approved' })).status, 409);
  assert.deepEqual(snapshot(), paused);
  assert.equal((await api(`/requests/${request.requestId}`, 1, 'PATCH', { status: 'rejected' })).status, 200);
});

test('database failures leave no submitted request or partial approval and a retry succeeds', async () => {
  const roomId = await createRoom();
  const initial = snapshot();
  db.exec('PRAGMA query_only = ON');
  try {
    const failed = await api(`/rooms/${roomId}/requests`, 2, 'POST');
    assert.deepEqual(failed, { status: 500, body: { error: 'Internal server error' } });
  } finally { db.exec('PRAGMA query_only = OFF'); }
  assert.deepEqual(snapshot(), initial);
  const request = await sendRequest(roomId);
  const pending = snapshot();
  // Fail the final insert, after the request update, member insert and full-room trigger.
  db.exec("CREATE TRIGGER fail_request_match BEFORE INSERT ON MATCHES BEGIN SELECT RAISE(ABORT, 'test failure'); END");
  try {
    const failed = await api(`/requests/${request.requestId}`, 1, 'PATCH', { status: 'approved' });
    assert.deepEqual(failed, { status: 500, body: { error: 'Internal server error' } });
    assert.deepEqual(snapshot(), pending);
  } finally { db.exec('DROP TRIGGER fail_request_match'); }
  assert.equal((await api(`/requests/${request.requestId}`, 1, 'PATCH', { status: 'approved' })).status, 200);
});

test('approved request, member and match persist when reopening an on-disk database', async () => {
  const filename = join(mkdtempSync(join(tmpdir(), 'roommatch-requests-')), 'requests.sqlite');
  db.exec(`VACUUM INTO '${filename.replaceAll("'", "''")}'`);
  await new Promise(resolve => application.server.close(resolve));
  db.close();
  db = openDatabase({ filename, seed: false });
  application = await startRoomMatchServer({ db, host: '127.0.0.1', port: 0, logger: { error() {} } });
  baseUrl = `http://127.0.0.1:${application.server.address().port}`;
  const roomId = await createRoom();
  const request = await sendRequest(roomId);
  assert.equal((await api(`/requests/${request.requestId}`, 1, 'PATCH', { status: 'approved' })).status, 200);
  await new Promise(resolve => application.server.close(resolve));
  db.close();
  db = openDatabase({ filename, seed: false });
  application = await startRoomMatchServer({ db, host: '127.0.0.1', port: 0, logger: { error() {} } });
  baseUrl = `http://127.0.0.1:${application.server.address().port}`;
  assert.equal(db.prepare('SELECT status FROM ROOM_REQUEST').get().status, 'approved');
  assert.equal(db.prepare('SELECT count(*) AS count FROM ROOM_MEMBER').get().count, 1);
  assert.equal(db.prepare('SELECT count(*) AS count FROM MATCHES').get().count, 1);
  assert.equal(db.prepare('SELECT status FROM ROOM').get().status, 'full');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal((await api('/requests/mine', 2)).body.requests[0].status, 'approved');
  assert.equal((await api('/owner/requests', 1)).body.requests[0].requestId, request.requestId);
});
