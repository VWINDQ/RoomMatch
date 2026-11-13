import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { startRoomMatchServer } from '../server/app.js';
import { openDatabase, runMigrations } from '../server/database.js';

const db = openDatabase({ filename: ':memory:' });
let application, baseUrl;
before(async () => {
  application = await startRoomMatchServer({ db, host: '127.0.0.1', port: 0 });
  baseUrl = `http://127.0.0.1:${application.server.address().port}`;
});
after(async () => { await new Promise(resolve => application.server.close(resolve)); db.close(); });

async function api(path, token, method = 'GET', payload) {
  const response = await fetch(`${baseUrl}/api${path}`, { method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(payload ? { 'Content-Type': 'application/json' } : {}) },
    ...(payload ? { body: JSON.stringify(payload) } : {}) });
  return { status: response.status, body: await response.json() };
}
async function account(name) {
  const result = await api('/auth/register', null, 'POST', {
    firstName: name, lastName: 'FriendTest', email: `${name}@friend.test`, phone: '0800000000', password: 'friend-test-password',
  });
  assert.equal(result.status, 201);
  return { token: result.body.token, id: result.body.user.userId };
}

test('additive migration preserves every original table row and schema', () => {
  const legacy = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true });
  try {
    legacy.exec(readFileSync('database/migrations/001_initial_schema.sql', 'utf8'));
    legacy.exec(readFileSync('database/migrations/002_repair_room_description_newlines.sql', 'utf8'));
    legacy.exec(readFileSync('tests/fixtures/legacy-seed.sql', 'utf8'));
    legacy.exec('PRAGMA user_version = 2');
    const tables = ['USER', 'LIFESTYLE', 'PREFERENCE', 'ROOM', 'ROOM_IMAGE', 'ROOM_MEMBER', 'ROOM_REQUEST', 'MATCHES'];
    const snapshot = () => tables.map(table => ({
      table, schema: legacy.prepare('SELECT sql FROM sqlite_schema WHERE name = ?').get(table).sql,
      rows: legacy.prepare(`SELECT * FROM ${table}`).all(),
    }));
    const original = snapshot();
    runMigrations(legacy);
    assert.deepEqual(snapshot(), original);
    assert.equal(legacy.prepare('SELECT COUNT(*) AS count FROM FRIEND_CONNECTION').get().count, 0);
    runMigrations(legacy);
    assert.deepEqual(snapshot(), original);
    assert.deepEqual(legacy.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { legacy.close(); }
});

test('friend invitation → consent → shared contacts without changing room matches', async () => {
  const alice = await account('Alice');
  const bob = await account('Bob');
  const outsider = await account('Outsider');
  const roomTables = ['ROOM', 'ROOM_IMAGE', 'ROOM_REQUEST', 'ROOM_MEMBER', 'MATCHES'];
  const snapshot = () => roomTables.map(table => db.prepare(`SELECT * FROM ${table}`).all());
  const beforeRooms = snapshot();
  assert.equal((await api('/friends')).status, 401);
  const discover = await api('/friends?q=Bob', alice.token);
  assert.equal(discover.status, 200);
  assert.equal(discover.body.people.length, 1);
  assert.equal(discover.body.people[0].userId, bob.id);
  for (const field of ['email', 'phone', 'lineId', 'instagram', 'passwordHash', 'dateOfBirth']) {
    assert.equal(field in discover.body.people[0], false);
  }
  assert.equal((await api('/friends?q=%25', alice.token)).body.people.length, 0);
  assert.equal((await api('/friends/connections', alice.token, 'POST', { recipientId: alice.id })).status, 400);
  const invitation = await api('/friends/connections', alice.token, 'POST', { recipientId: bob.id });
  assert.equal(invitation.status, 201);
  const id = invitation.body.connection.connectionId;
  assert.equal((await api('/friends/connections', bob.token, 'POST', { recipientId: alice.id })).status, 409);
  const incoming = await api('/friends/connections', bob.token);
  assert.equal(incoming.body.connections[0].direction, 'incoming');
  assert.equal('email' in incoming.body.connections[0].person, false);
  assert.equal((await api(`/friends/connections/${id}`, alice.token, 'PATCH', { status: 'accepted' })).status, 403);
  assert.equal((await api(`/friends/connections/${id}`, outsider.token, 'PATCH', { status: 'accepted' })).status, 403);
  const accepted = await api(`/friends/connections/${id}`, bob.token, 'PATCH', { status: 'accepted' });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.connection.person.email, 'alice@friend.test');
  assert.equal(accepted.body.connection.status, 'accepted');
  assert.equal((await api('/friends/connections', alice.token)).body.connections[0].person.email, 'bob@friend.test');
  assert.equal((await api('/friends/connections', outsider.token)).body.connections.length, 0);
  assert.equal((await api(`/friends/connections/${id}`, bob.token, 'PATCH', { status: 'declined' })).status, 409);
  assert.deepEqual(snapshot(), beforeRooms);

  const declinedInvite = await api('/friends/connections', outsider.token, 'POST', { recipientId: bob.id });
  const declined = await api(`/friends/connections/${declinedInvite.body.connection.connectionId}`, bob.token, 'PATCH', { status: 'declined' });
  assert.equal(declined.status, 200);
  assert.equal('email' in declined.body.connection.person, false);
  assert.throws(() => db.prepare('INSERT INTO FRIEND_CONNECTION(sender_id, recipient_id) VALUES (?, ?)').run(bob.id, alice.id), /UNIQUE/);
  assert.throws(() => db.prepare('INSERT INTO FRIEND_CONNECTION(sender_id, recipient_id) VALUES (?, ?)').run(bob.id, bob.id), /CHECK/);
});
