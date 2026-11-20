import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { startRoomMatchServer } from '../server/app.js';
import { openDatabase } from './support/postgres.mjs';

const db = await openDatabase({ filename: ':memory:' });
let application, baseUrl;
before(async () => {
  application = await startRoomMatchServer({ db, host: '127.0.0.1', port: 0 });
  baseUrl = `http://127.0.0.1:${application.server.address().port}`;
});
after(async () => { await new Promise(resolve => application.server.close(resolve)); await db.close(); });

async function api(path, token, method = 'GET', payload) {
  const response = await fetch(`${baseUrl}/api${path}`, { method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(payload ? { 'Content-Type': 'application/json' } : {}) },
    ...(payload ? { body: JSON.stringify(payload) } : {}) });
  return { status: response.status, body: await response.json() };
}
async function account(name) {
  const result = await api('/auth/register', null, 'POST', {
    firstName: name, lastName: 'FriendTest', email: `${name}@friend.test`, phone: '0800000000', password: 'friend-test-password',
    dateOfBirth: '2000-02-29',
  });
  assert.equal(result.status, 201);
  return { token: result.body.token, id: result.body.user.userId };
}

test('friend invitation → consent → shared contacts without changing room matches', async () => {
  const alice = await account('Alice');
  const bob = await account('Bob');
  const outsider = await account('Outsider');
  const roomTables = ['ROOM', 'ROOM_IMAGE', 'ROOM_REQUEST', 'ROOM_MEMBER', 'MATCHES'];
  const snapshot = async () => await Promise.all(roomTables.map(async table => await db.prepare(`SELECT * FROM ${table}`).all()));
  const beforeRooms = await snapshot();
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
  assert.deepEqual(await snapshot(), beforeRooms);

  const declinedInvite = await api('/friends/connections', outsider.token, 'POST', { recipientId: bob.id });
  const declined = await api(`/friends/connections/${declinedInvite.body.connection.connectionId}`, bob.token, 'PATCH', { status: 'declined' });
  assert.equal(declined.status, 200);
  assert.equal('email' in declined.body.connection.person, false);
  await assert.rejects(async () => await db.prepare('INSERT INTO FRIEND_CONNECTION(sender_id, recipient_id) VALUES (?, ?)').run(bob.id, alice.id), /unique/i);
  await assert.rejects(async () => await db.prepare('INSERT INTO FRIEND_CONNECTION(sender_id, recipient_id) VALUES (?, ?)').run(bob.id, bob.id), /check/i);
});
