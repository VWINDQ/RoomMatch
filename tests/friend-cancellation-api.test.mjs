import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { startRoomMatchServer } from '../server/app.js';
import { createToken } from '../server/auth.js';
import { openDatabase } from './support/postgres.mjs';

async function fixture(t, filename = ':memory:') {
  const db = await openDatabase({ filename });
  const { server } = await startRoomMatchServer({ db, port: 0, logger: { error() {} } });
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await new Promise(resolve => server.close(resolve));
    await db.close();
  };
  t.after(close);
  const api = async (path, userId = 1, method = 'GET', body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method,
      headers: {
        ...(userId ? { Authorization: `Bearer ${createToken(userId)}` } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  };
  const invite = async (senderId = 1, recipientId = 2) => {
    const result = await api('/friends/connections', senderId, 'POST', { recipientId });
    assert.equal(result.status, 201);
    return result.body.connection;
  };
  const cancel = (id, userId = 1) => api(`/friends/connections/${id}/cancel`, userId, 'POST');
  return { db, api, invite, cancel, close };
}

const privateFields = ['email', 'phone', 'lineId', 'instagram', 'passwordHash', 'dateOfBirth', 'age'];
const row = async (db, id) => await db.prepare('SELECT * FROM FRIEND_CONNECTION WHERE connection_id=?').get(id);

test('sender withdraws pending invitation without sharing contacts or changing room and favorite data', async t => {
  const { db, api, invite, cancel } = await fixture(t);
  const tables = ['USER', 'LIFESTYLE', 'PREFERENCE', 'ROOM', 'ROOM_IMAGE', 'ROOM_REQUEST', 'ROOM_MEMBER', 'MATCHES', 'ROOM_FAVORITE'];
  const snapshot = async () => await Promise.all(tables.map(async table => await db.prepare(`SELECT * FROM ${table} ORDER BY 1, 2`).all()));
  const before = await snapshot();
  const invitation = await invite();
  const result = await cancel(invitation.connectionId);
  assert.equal(result.status, 200);
  assert.equal(result.body.connection.status, 'cancelled');
  assert.equal(result.body.connection.direction, 'outgoing');
  assert.equal(result.body.connection.createdAt, invitation.createdAt);
  assert.match(result.body.connection.respondedAt, /^\d{4}-\d{2}-\d{2}T.*Z$/);
  for (const userId of [1, 2]) {
    const listed = (await api('/friends/connections', userId)).body.connections;
    assert.equal(listed.length, 1);
    assert.equal(listed[0].status, 'cancelled');
    assert.equal(listed[0].direction, userId === 1 ? 'outgoing' : 'incoming');
    for (const field of privateFields) assert.equal(field in listed[0].person, false);
  }
  for (const field of privateFields) assert.equal(field in result.body.connection.person, false);
  assert.deepEqual((await api('/friends/connections', 3)).body.connections, []);
  assert.deepEqual(await snapshot(), before);
});

test('cancellation requires active authentication and is sender-only before and after withdrawal', async t => {
  const { db, api, invite, cancel } = await fixture(t);
  const invitation = await invite();
  const original = await row(db, invitation.connectionId);
  assert.equal((await cancel(invitation.connectionId, null)).status, 401);
  for (const userId of [2, 3]) assert.equal((await cancel(invitation.connectionId, userId)).status, 403);
  await db.exec('UPDATE USER SET is_active=0 WHERE user_id=1');
  assert.equal((await cancel(invitation.connectionId)).status, 401);
  assert.deepEqual(await row(db, invitation.connectionId), original);
  await db.exec('UPDATE USER SET is_active=1 WHERE user_id=1');
  assert.equal((await cancel(invitation.connectionId)).status, 200);
  for (const userId of [2, 3]) assert.equal((await cancel(invitation.connectionId, userId)).status, 403);
  assert.equal((await api('/friends/connections', 3)).body.connections.length, 0);
});

test('invalid and missing connection IDs leave an empty invitation list unchanged', async t => {
  const { db, api, cancel } = await fixture(t);
  for (const id of ['0', '9007199254740993', '99999999999999999999999999']) {
    assert.equal((await cancel(id)).status, 400);
  }
  for (const id of ['-1', 'abc', '1.5']) assert.equal((await cancel(id)).status, 404);
  assert.equal((await cancel(999999)).status, 404);
  assert.deepEqual((await api('/friends/connections')).body.connections, []);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM FRIEND_CONNECTION').get()).n, 0);
});

test('retrying withdrawal preserves its original timestamp and final state', async t => {
  const { db, api, invite, cancel } = await fixture(t);
  const invitation = await invite();
  const first = await cancel(invitation.connectionId);
  const original = await row(db, invitation.connectionId);
  // A repeat must not issue another UPDATE, even if a response was lost.
  await db.exec("CREATE FUNCTION fail_repeat_cancel_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'unexpected repeat update'; END $$; CREATE TRIGGER fail_repeat_cancel BEFORE UPDATE ON FRIEND_CONNECTION FOR EACH ROW EXECUTE FUNCTION fail_repeat_cancel_fn();");
  assert.deepEqual(await cancel(invitation.connectionId), first);
  assert.deepEqual(await row(db, invitation.connectionId), original);
  for (const status of ['accepted', 'declined']) {
    assert.equal((await api(`/friends/connections/${invitation.connectionId}`, 2, 'PATCH', { status })).status, 409);
  }
  for (const [sender, recipient] of [[1, 2], [2, 1]]) {
    assert.equal((await api('/friends/connections', sender, 'POST', { recipientId: recipient })).status, 409);
  }
});

test('accepted or declined invitations cannot be withdrawn or change consent', async t => {
  const { db, api, invite, cancel } = await fixture(t);
  for (const [recipientId, status] of [[2, 'accepted'], [3, 'declined']]) {
    const invitation = await invite(1, recipientId);
    assert.equal((await api(`/friends/connections/${invitation.connectionId}`, recipientId, 'PATCH', { status })).status, 200);
    const original = await row(db, invitation.connectionId);
    assert.equal((await cancel(invitation.connectionId)).status, 409);
    assert.deepEqual(await row(db, invitation.connectionId), original);
    const listed = (await api('/friends/connections')).body.connections.find(item => item.connectionId === invitation.connectionId);
    assert.equal('email' in listed.person, status === 'accepted');
  }
});

test('a sender may withdraw while the recipient is inactive without revealing their contacts', async t => {
  const { db, invite, cancel } = await fixture(t);
  const invitation = await invite();
  await db.exec('UPDATE USER SET is_active=0 WHERE user_id=2');
  const result = await cancel(invitation.connectionId);
  assert.equal(result.status, 200);
  assert.equal((await row(db, invitation.connectionId)).status, 'cancelled');
  for (const field of privateFields) assert.equal(field in result.body.connection.person, false);
});

test('withdrawal and recipient decisions racing have one successful final outcome', async t => {
  const { db, api, invite, cancel } = await fixture(t);
  for (const [sender, recipient, status] of [[1, 2, 'accepted'], [3, 4, 'declined']]) {
    const invitation = await invite(sender, recipient);
    const results = await Promise.all([
      api(`/friends/connections/${invitation.connectionId}`, recipient, 'PATCH', { status }),
      cancel(invitation.connectionId, sender),
    ]);
    assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
    const winner = results.find(result => result.status === 200).body.connection;
    assert.equal((await row(db, invitation.connectionId)).status, winner.status);
    assert.equal((await row(db, invitation.connectionId)).responded_at, winner.respondedAt);
    const listed = (await api('/friends/connections', sender)).body.connections.find(item => item.connectionId === invitation.connectionId);
    assert.equal('email' in listed.person, winner.status === 'accepted');
  }
});

test('write and response-read failures roll back withdrawal and allow a later retry', async t => {
  const { db, invite, cancel } = await fixture(t);
  const invitation = await invite();
  const original = await row(db, invitation.connectionId);
  db.setReadOnly(true);
  try {
    assert.deepEqual(await cancel(invitation.connectionId), { status: 500, body: { error: 'Internal server error' } });
  } finally { db.setReadOnly(false); }
  assert.deepEqual(await row(db, invitation.connectionId), original);
  assert.equal((await cancel(invitation.connectionId)).status, 200);

  const second = await invite(1, 3);
  const beforeReadFailure = await row(db, second.connectionId);
  await db.exec('ALTER TABLE PREFERENCE RENAME TO PREFERENCE_unavailable');
  try {
    assert.deepEqual(await cancel(second.connectionId), { status: 500, body: { error: 'Internal server error' } });
    assert.deepEqual(await row(db, second.connectionId), beforeReadFailure);
  } finally { await db.exec('ALTER TABLE PREFERENCE_unavailable RENAME TO PREFERENCE'); }
  assert.equal((await cancel(second.connectionId)).status, 200);
});

test('withdrawal and private history persist after restarting with the same database', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'roommatch-friend-cancel-api-'));
  const filename = join(directory, 'qa.sqlite');
  const first = await fixture(t, filename);
  let second;
  try {
    const invitation = await first.invite();
    const withdrawn = await first.cancel(invitation.connectionId);
    await first.close();
    second = await fixture(t, filename);
    const restored = (await second.api('/friends/connections')).body.connections[0];
    assert.deepEqual(restored, withdrawn.body.connection);
    assert.deepEqual(await second.cancel(invitation.connectionId), withdrawn);
    assert.deepEqual((await second.api('/friends/connections', 3)).body.connections, []);
    assert.equal((await second.api(`/friends/connections/${invitation.connectionId}`, 2, 'PATCH', { status: 'accepted' })).status, 409);
    assert.deepEqual(await second.db.prepare('SELECT conname FROM pg_constraint WHERE connamespace = current_schema()::regnamespace AND contype = \'f\' AND NOT convalidated').all(), []);
  } finally {
    await first.close();
    await second?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
