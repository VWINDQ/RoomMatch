import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startRoomMatchServer } from '../server/app.js';
import { createToken } from '../server/auth.js';
import { openDatabase } from '../server/database.js';

let db, application, baseUrl;
const contactFields = ['email', 'phone', 'lineId', 'instagram'];
const profileKeys = ['bio', 'budgetMax', 'budgetMin', 'firstName', 'lastName', 'lifestyle', 'profileImage', 'university', 'userId'];

async function start() {
  application = await startRoomMatchServer({ db, host: '127.0.0.1', port: 0, logger: { error() {} } });
  baseUrl = `http://127.0.0.1:${application.server.address().port}/api`;
}

beforeEach(async () => {
  db = openDatabase({ filename: ':memory:', seed: false });
  const insert = db.prepare(`INSERT INTO USER (user_id, first_name, last_name, email,
    password_hash, phone, line_id, instagram, university, bio)
    VALUES (?, ?, ?, ?, 'unused-test-hash', '0890000000', ?, ?, 'KMUTT', 'ชอบอ่านหนังสือ')`);
  for (const [id, first, last] of [[1, 'Alice', 'Student'], [2, 'สมชาย', 'ใจดี'], [3, 'Carol', 'Student'], [4, 'Dan', 'Student']]) {
    insert.run(id, first, last, `friend-${id}@example.test`, `line-${id}`, `instagram-${id}`);
  }
  db.prepare('INSERT INTO LIFESTYLE (user_id, lifestyle_name) VALUES (?, ?)').run(2, 'ตื่นเช้า ไม่สูบบุหรี่');
  db.prepare('INSERT INTO PREFERENCE (user_id, budget_min, budget_max) VALUES (?, ?, ?)').run(2, 0, 5000);
  await start();
});

afterEach(async () => {
  if (application) await new Promise(resolve => application.server.close(resolve));
  db?.close();
});

async function api(path, userId, method = 'GET', payload) {
  const result = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(userId ? { Authorization: `Bearer ${createToken(userId)}` } : {}),
      ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  return { status: result.status, body: await result.json() };
}

async function invite(senderId = 1, recipientId = 2) {
  const result = await api('/friends/connections', senderId, 'POST', { recipientId });
  assert.equal(result.status, 201);
  return result.body.connection;
}

function originalTables() {
  return Object.fromEntries(['USER', 'LIFESTYLE', 'PREFERENCE', 'ROOM', 'ROOM_IMAGE', 'ROOM_REQUEST', 'ROOM_MEMBER', 'MATCHES']
    .map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
}

test('all friend endpoints require an active authenticated account', async () => {
  for (const [path, method, payload] of [
    ['/friends', 'GET'], ['/friends/connections', 'GET'],
    ['/friends/connections', 'POST', { recipientId: 2 }],
    ['/friends/connections/1', 'PATCH', { status: 'accepted' }],
  ]) assert.equal((await api(path, null, method, payload)).status, 401);
  db.prepare('UPDATE USER SET is_active = 0 WHERE user_id = ?').run(1);
  assert.equal((await api('/friends', 1)).status, 401);
});

test('discovery omits self and inactive accounts and returns only public profile fields', async () => {
  db.prepare('UPDATE USER SET is_active = 0 WHERE user_id = ?').run(4);
  const result = await api('/friends', 1);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.people.map(person => person.userId).sort(), [2, 3]);
  for (const person of result.body.people) assert.deepEqual(Object.keys(person).sort(), profileKeys);
  const person = result.body.people.find(person => person.userId === 2);
  assert.equal(person.budgetMin, 0);
  assert.equal(person.budgetMax, 5000);
  assert.equal(person.lifestyle, 'ตื่นเช้า ไม่สูบบุหรี่');
});

test('search supports Thai full names, name parts, university, bio and lifestyle', async () => {
  for (const query of ['สมชาย ใจดี', 'สมชาย', 'ใจดี', 'ตื่นเช้า']) {
    const result = await api(`/friends?q=${encodeURIComponent(query)}`, 1);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.people.map(person => person.userId), [2], query);
  }
  for (const query of ['kmutt', 'ชอบอ่านหนังสือ', '   ']) {
    assert.equal((await api(`/friends?q=${encodeURIComponent(query)}`, 1)).body.people.length, 3);
  }
});

test('search treats wildcard and SQL-like characters as literals and enforces query length', async () => {
  db.prepare('UPDATE USER SET bio = ? WHERE user_id = 2').run('100% _quiet \\ room');
  for (const query of ['%', '_', '\\']) {
    assert.deepEqual((await api(`/friends?q=${encodeURIComponent(query)}`, 1)).body.people.map(person => person.userId), [2]);
  }
  assert.deepEqual((await api(`/friends?q=${encodeURIComponent("' OR 1=1 --")}`, 1)).body.people, []);
  assert.equal((await api(`/friends?q=${'a'.repeat(101)}`, 1)).status, 400);
  assert.deepEqual((await api(`/friends?q=${encodeURIComponent('ไม่มีคนนี้')}`, 1)).body.people, []);
});

test('empty discovery and invitation lists are successful empty responses', async () => {
  db.exec('UPDATE USER SET is_active = 0 WHERE user_id != 1');
  assert.deepEqual(await api('/friends', 1), { status: 200, body: { people: [] } });
  assert.deepEqual(await api('/friends/connections', 1), { status: 200, body: { connections: [] } });
});

test('invalid recipients and malformed bodies do not create invitations', async () => {
  for (const recipientId of [null, '2', true, {}, [], 0, -1, 2.5, 9007199254740992, 1]) {
    assert.equal((await api('/friends/connections', 1, 'POST', { recipientId })).status, 400);
  }
  assert.equal((await api('/friends/connections', 1, 'POST', {})).status, 400);
  assert.equal((await api('/friends/connections', 1, 'POST', { recipientId: 999999 })).status, 404);
  db.prepare('UPDATE USER SET is_active = 0 WHERE user_id = ?').run(4);
  assert.equal((await api('/friends/connections', 1, 'POST', { recipientId: 4 })).status, 404);
  const malformed = await fetch(`${baseUrl}/friends/connections`, {
    method: 'POST', headers: { Authorization: `Bearer ${createToken(1)}`, 'Content-Type': 'application/json' }, body: '{',
  });
  assert.equal(malformed.status, 400);
  assert.equal(db.prepare('SELECT count(*) AS count FROM FRIEND_CONNECTION').get().count, 0);
});

test('pending invitations have correct directions, hide contacts and reject duplicate or reversed pairs', async () => {
  const invitation = await invite();
  assert.equal(invitation.status, 'pending');
  assert.equal(invitation.direction, 'outgoing');
  assert.equal(invitation.respondedAt, null);
  assert.equal(invitation.person.userId, 2);
  for (const userId of [1, 2]) {
    const result = await api('/friends/connections', userId);
    assert.equal(result.body.connections.length, 1);
    const connection = result.body.connections[0];
    assert.equal(connection.direction, userId === 1 ? 'outgoing' : 'incoming');
    assert.deepEqual(Object.keys(connection.person).sort(), profileKeys);
    assert.equal((await api('/friends', userId)).body.people.some(person => person.userId === (userId === 1 ? 2 : 1)), false);
  }
  assert.deepEqual((await api('/friends/connections', 3)).body.connections, []);
  assert.equal((await api('/friends/connections', 1, 'POST', { recipientId: 2 })).status, 409);
  assert.equal((await api('/friends/connections', 2, 'POST', { recipientId: 1 })).status, 409);
});

test('only the recipient may decide and invalid decisions leave the invitation pending', async () => {
  const invitation = await invite();
  for (const userId of [1, 3]) {
    for (const status of ['accepted', 'declined']) {
      assert.equal((await api(`/friends/connections/${invitation.connectionId}`, userId, 'PATCH', { status })).status, 403);
    }
  }
  for (const payload of [{}, { status: 'pending' }, { status: 'approved' }, { status: null }]) {
    assert.equal((await api(`/friends/connections/${invitation.connectionId}`, 2, 'PATCH', payload)).status, 400);
  }
  assert.equal((await api('/friends/connections/999999', 2, 'PATCH', { status: 'accepted' })).status, 404);
  assert.equal(db.prepare('SELECT status FROM FRIEND_CONNECTION').get().status, 'pending');
});

test('connection IDs must be positive safe integers', async () => {
  for (const id of ['0', '9007199254740993', '999999999999999999999999999999']) {
    assert.equal((await api(`/friends/connections/${id}`, 2, 'PATCH', { status: 'accepted' })).status, 400, id);
  }
});

test('acceptance reveals contacts only to both participants and never changes room data', async () => {
  const before = originalTables();
  const invitation = await invite();
  const result = await api(`/friends/connections/${invitation.connectionId}`, 2, 'PATCH', { status: 'accepted' });
  assert.equal(result.status, 200);
  assert.equal(result.body.connection.person.userId, 1);
  assert.match(result.body.connection.respondedAt, /^\d{4}-\d{2}-\d{2}T.*Z$/);
  for (const userId of [1, 2]) {
    const connection = (await api('/friends/connections', userId)).body.connections[0];
    const otherId = userId === 1 ? 2 : 1;
    assert.equal(connection.status, 'accepted');
    assert.equal(connection.person.email, `friend-${otherId}@example.test`);
    assert.equal(connection.person.lineId, `line-${otherId}`);
    assert.deepEqual(Object.keys(connection.person).sort(), [...profileKeys, ...contactFields].sort());
  }
  assert.deepEqual((await api('/friends/connections?userId=1', 3)).body.connections, []);
  const outsiderProfiles = (await api('/friends', 3)).body.people;
  assert.deepEqual(Object.keys(outsiderProfiles.find(person => person.userId === 2)).sort(), profileKeys);
  assert.equal((await api(`/friends/connections/${invitation.connectionId}`, 3, 'PATCH', { status: 'accepted' })).status, 403);
  assert.deepEqual(originalTables(), before);
});

test('decline never shares contacts and final decisions cannot be changed or re-sent', async () => {
  const invitation = await invite();
  const result = await api(`/friends/connections/${invitation.connectionId}`, 2, 'PATCH', { status: 'declined' });
  assert.equal(result.status, 200);
  assert.equal(result.body.connection.status, 'declined');
  assert.deepEqual(Object.keys(result.body.connection.person).sort(), profileKeys);
  for (const userId of [1, 2]) {
    assert.deepEqual(Object.keys((await api('/friends/connections', userId)).body.connections[0].person).sort(), profileKeys);
  }
  for (const status of ['accepted', 'declined']) {
    assert.equal((await api(`/friends/connections/${invitation.connectionId}`, 2, 'PATCH', { status })).status, 409);
  }
  assert.equal((await api('/friends/connections', 2, 'POST', { recipientId: 1 })).status, 409);
  assert.equal((await api('/friends', 1)).body.people.some(person => person.userId === 2), false);
});

test('inactive partners disappear from connections and cannot be accepted', async () => {
  const invitation = await invite();
  db.prepare('UPDATE USER SET is_active = 0 WHERE user_id = ?').run(1);
  assert.equal((await api(`/friends/connections/${invitation.connectionId}`, 2, 'PATCH', { status: 'accepted' })).status, 409);
  assert.deepEqual((await api('/friends/connections', 2)).body.connections, []);
  assert.equal(db.prepare('SELECT status FROM FRIEND_CONNECTION').get().status, 'pending');
  const accepted = await invite(3, 2);
  assert.equal((await api(`/friends/connections/${accepted.connectionId}`, 2, 'PATCH', { status: 'accepted' })).status, 200);
  db.prepare('UPDATE USER SET is_active = 0 WHERE user_id = ?').run(2);
  assert.deepEqual((await api('/friends/connections', 3)).body.connections, []);
  assert.equal(db.prepare('SELECT status FROM FRIEND_CONNECTION WHERE connection_id = ?').get(accepted.connectionId).status, 'accepted');
});

test('simultaneous reversed invitations and competing decisions have only one successful result', async () => {
  const results = await Promise.all([
    api('/friends/connections', 1, 'POST', { recipientId: 2 }),
    api('/friends/connections', 2, 'POST', { recipientId: 1 }),
  ]);
  assert.deepEqual(results.map(result => result.status).sort(), [201, 409]);
  const row = db.prepare('SELECT * FROM FRIEND_CONNECTION').get();
  const decisions = await Promise.all(['accepted', 'declined'].map(status =>
    api(`/friends/connections/${row.connection_id}`, row.recipient_id, 'PATCH', { status })));
  assert.deepEqual(decisions.map(result => result.status).sort(), [200, 409]);
  assert.equal(db.prepare('SELECT status FROM FRIEND_CONNECTION').get().status, decisions.find(result => result.status === 200).body.connection.status);
  assert.equal(db.prepare('SELECT count(*) AS count FROM FRIEND_CONNECTION').get().count, 1);
});

test('database write failures do not create invitations or partially accept them', async () => {
  db.exec('PRAGMA query_only = ON');
  try {
    assert.deepEqual(await api('/friends/connections', 1, 'POST', { recipientId: 2 }), { status: 500, body: { error: 'Internal server error' } });
  } finally { db.exec('PRAGMA query_only = OFF'); }
  assert.equal(db.prepare('SELECT count(*) AS count FROM FRIEND_CONNECTION').get().count, 0);
  const invitation = await invite();
  db.exec('PRAGMA query_only = ON');
  try {
    assert.deepEqual(await api(`/friends/connections/${invitation.connectionId}`, 2, 'PATCH', { status: 'accepted' }), { status: 500, body: { error: 'Internal server error' } });
  } finally { db.exec('PRAGMA query_only = OFF'); }
  assert.equal(db.prepare('SELECT status FROM FRIEND_CONNECTION').get().status, 'pending');
  assert.equal((await api(`/friends/connections/${invitation.connectionId}`, 2, 'PATCH', { status: 'accepted' })).status, 200);
});

test('a profile read failure after insertion rolls back the invitation instead of returning a false failure', async () => {
  db.exec('DROP TABLE PREFERENCE');
  assert.deepEqual(await api('/friends/connections', 1, 'POST', { recipientId: 2 }), { status: 500, body: { error: 'Internal server error' } });
  assert.equal(db.prepare('SELECT count(*) AS count FROM FRIEND_CONNECTION').get().count, 0);
});

test('a profile read failure after acceptance rolls back consent and its response timestamp', async () => {
  const invitation = await invite();
  db.exec('DROP TABLE PREFERENCE');
  assert.deepEqual(await api(`/friends/connections/${invitation.connectionId}`, 2, 'PATCH', { status: 'accepted' }), { status: 500, body: { error: 'Internal server error' } });
  const row = db.prepare('SELECT status, responded_at FROM FRIEND_CONNECTION').get();
  assert.equal(row.status, 'pending');
  assert.equal(row.responded_at, null);
});

test('multiple accepted friends are supported without a room or automatic membership', async () => {
  for (const recipientId of [2, 3]) {
    const invitation = await invite(1, recipientId);
    assert.equal((await api(`/friends/connections/${invitation.connectionId}`, recipientId, 'PATCH', { status: 'accepted' })).status, 200);
  }
  assert.equal((await api('/friends/connections', 1)).body.connections.filter(connection => connection.status === 'accepted').length, 2);
  for (const table of ['ROOM', 'ROOM_REQUEST', 'ROOM_MEMBER', 'MATCHES']) {
    assert.equal(db.prepare(`SELECT count(*) AS count FROM ${table}`).get().count, 0);
  }
});

test('accepted friendship and privacy survive restarting with the same database', async () => {
  const invitation = await invite();
  assert.equal((await api(`/friends/connections/${invitation.connectionId}`, 2, 'PATCH', { status: 'accepted' })).status, 200);
  const filename = join(mkdtempSync(join(tmpdir(), 'roommatch-friends-')), 'friends.sqlite');
  db.exec(`VACUUM INTO '${filename.replaceAll("'", "''")}'`);
  await new Promise(resolve => application.server.close(resolve));
  db.close();
  db = openDatabase({ filename, seed: false });
  await start();
  const result = await api('/friends/connections', 1);
  assert.equal(result.body.connections[0].status, 'accepted');
  assert.equal(result.body.connections[0].person.email, 'friend-2@example.test');
  assert.deepEqual((await api('/friends/connections', 3)).body.connections, []);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});
