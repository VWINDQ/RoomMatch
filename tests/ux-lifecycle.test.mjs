import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase, runMigrations } from '../server/database.js';
import { startRoomMatchServer } from '../server/app.js';
import { createToken } from '../server/auth.js';

async function fixture(t) {
  const db = openDatabase({ filename: ':memory:' });
  const app = await startRoomMatchServer({ db, port: 0, logger: { error() {} } });
  const base = `http://127.0.0.1:${app.server.address().port}/api`;
  t.after(async () => { await new Promise(resolve => app.server.close(resolve)); db.close(); });
  const api = async (path, id = 1, method = 'GET', body) => {
    const response = await fetch(base + path, { method, headers: { ...(id ? { Authorization: `Bearer ${createToken(id)}` } : {}), 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  return { db, api };
}

test('UX migration preserves legacy rows and permits a lower-numbered teammate migration arriving later', () => {
  const directory = mkdtempSync(join(tmpdir(), 'roommatch-migration-order-'));
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true });
  try {
    for (const name of ['001_initial_schema.sql', '002_repair_room_description_newlines.sql', '003_friend_connections.sql']) {
      copyFileSync(`database/migrations/${name}`, join(directory, name));
      db.exec(readFileSync(join(directory, name), 'utf8'));
    }
    db.exec(readFileSync('database/seed.sql', 'utf8'));
    db.exec('PRAGMA user_version = 3');
    const requests = db.prepare('SELECT * FROM ROOM_REQUEST ORDER BY request_id').all();
    const rooms = db.prepare('SELECT * FROM ROOM ORDER BY room_id').all().map(row => ({ ...row }));
    copyFileSync('database/migrations/005_ux_listing_and_request_lifecycle.sql', join(directory, '005_ux_listing_and_request_lifecycle.sql'));
    runMigrations(db, directory);
    assert.deepEqual(db.prepare('SELECT * FROM ROOM_REQUEST ORDER BY request_id').all(), requests);
    assert.deepEqual(db.prepare('SELECT * FROM ROOM ORDER BY room_id').all().map(({ price_basis, locality, cost_notes, ...room }) => room), rooms);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.throws(() => db.exec("UPDATE ROOM_REQUEST SET status = 'cancelled', responded_at = CURRENT_TIMESTAMP WHERE request_id = 1"), /decision is final/);
    writeFileSync(join(directory, '004_teammate.sql'), 'CREATE TABLE teammate_migration_probe(id INTEGER PRIMARY KEY) STRICT;');
    runMigrations(db, directory);
    runMigrations(db, directory);
    assert.ok(db.prepare("SELECT 1 FROM sqlite_schema WHERE name = 'teammate_migration_probe'").get());
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 5);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM _roommatch_migrations').get().n, 5);
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('listing metadata remains unknown for legacy rooms and is validated, searched and preserved on unrelated edits', async t => {
  const { api } = await fixture(t);
  const legacy = await api('/rooms/1');
  assert.equal(legacy.body.room.priceBasis, null);
  assert.equal(legacy.body.room.locality, null);
  const payload = { title: 'ห้องใหม่', description: 'ห้องสำหรับทดสอบ', googleMapsUrl: 'https://maps.google.com/', price: 6000, capacity: 3, priceBasis: 'per_room', locality: 'ซอยประชาอุทิศ 100% ใกล้ มจธ.', costNotes: 'ไม่รวมค่าน้ำไฟ เงินประกัน 1 เดือน' };
  const created = await api('/rooms', 1, 'POST', payload);
  assert.equal(created.status, 201);
  const id = created.body.room.roomId;
  const edited = await api(`/rooms/${id}`, 1, 'PATCH', { price: 6500 });
  assert.equal(edited.body.room.priceBasis, 'per_room');
  assert.equal(edited.body.room.locality, payload.locality);
  assert.equal(edited.body.room.costNotes, payload.costNotes);
  assert.equal((await api('/rooms?q=100%25')).body.rooms.length, 1);
  assert.equal((await api('/rooms?priceBasis=per_room')).body.rooms.length, 1);
  for (const bad of [{ priceBasis: 'bogus' }, { locality: 'ย'.repeat(201) }, { costNotes: 'x'.repeat(1001) }]) assert.equal((await api(`/rooms/${id}`, 1, 'PATCH', bad)).status, 400);
  assert.equal((await api('/rooms?priceBasis=bogus')).status, 400);
  for (const value of ['0', '-1', '101', '2.5', 'x']) assert.equal((await api(`/rooms?minSlots=${value}`)).status, 400);
});

test('a failed migration rolls back schema and ledger changes and can be retried', () => {
  const directory = mkdtempSync(join(tmpdir(), 'roommatch-migration-retry-'));
  const db = openDatabase({ filename: ':memory:' });
  try {
    writeFileSync(join(directory, '006_failure.sql'), 'ALTER TABLE ROOM ADD COLUMN retry_probe TEXT; INSERT INTO missing_table VALUES(1);');
    assert.throws(() => runMigrations(db, directory), /Migration 006_failure.sql failed/);
    assert.equal(db.prepare('PRAGMA table_info(ROOM)').all().some(row => row.name === 'retry_probe'), false);
    assert.equal(db.prepare("SELECT 1 FROM _roommatch_migrations WHERE filename = '006_failure.sql'").get(), undefined);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 5);
    writeFileSync(join(directory, '006_failure.sql'), 'ALTER TABLE ROOM ADD COLUMN retry_probe TEXT;');
    runMigrations(db, directory);
    assert.ok(db.prepare('PRAGMA table_info(ROOM)').all().some(row => row.name === 'retry_probe'));
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('withdrawal and leaving persist after closing and reopening the database', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'roommatch-lifecycle-durable-'));
  const filename = join(directory, 'qa.sqlite');
  let db = openDatabase({ filename });
  let app;
  try {
    app = await startRoomMatchServer({ db, port: 0, logger: { error() {} } });
    for (const [path, method, user] of [['requests/2/cancel', 'POST', 3], ['rooms/2/members/me', 'DELETE', 5]]) {
      const response = await fetch(`http://127.0.0.1:${app.server.address().port}/api/${path}`, { method, headers: { Authorization: `Bearer ${createToken(user)}` } });
      assert.equal(response.status, 200);
    }
    await new Promise(resolve => app.server.close(resolve)); app = null;
    db.close(); db = openDatabase({ filename, seed: false });
    assert.equal(db.prepare('SELECT status FROM ROOM_REQUEST WHERE request_id = 2').get().status, 'cancelled');
    assert.equal(db.prepare('SELECT status FROM ROOM_MEMBER WHERE room_id = 2 AND user_id = 5').get().status, 'left');
    assert.equal(db.prepare('SELECT status FROM ROOM WHERE room_id = 2').get().status, 'available');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM MATCHES WHERE room_id = 2').get().n, 1);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { if (app) await new Promise(resolve => app.server.close(resolve)); db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('pair search requires accepted friendship and enough places only for participants who are not already residents', async t => {
  const { db, api } = await fixture(t);
  const accept = (sender, recipient) => db.prepare("INSERT INTO FRIEND_CONNECTION(sender_id, recipient_id, status, responded_at) VALUES (?, ?, 'accepted', CURRENT_TIMESTAMP)").run(sender, recipient);
  accept(3, 4); accept(1, 3); accept(2, 3);
  assert.equal((await api('/rooms?withFriend=4', 3)).body.rooms.length, 0); // both would need two places
  assert.ok((await api('/rooms?withFriend=3&status=available', 1)).body.rooms.some(room => room.roomId === 1)); // owner already present
  assert.ok((await api('/rooms?withFriend=3&status=available', 2)).body.rooms.some(room => room.roomId === 1)); // member already present
  assert.equal((await api('/rooms?minSlots=2&status=available')).body.rooms.length, 0);
  assert.equal((await api('/rooms?withFriend=3', 3)).status, 400);
  assert.equal((await api('/rooms?withFriend=5', 3)).status, 403);
  assert.equal((await api('/rooms?withFriend=4', null)).status, 401);
});

test('only the requester can withdraw pending; history remains, retry is safe, and a new application can be sent', async t => {
  const { api, db } = await fixture(t);
  assert.equal((await api('/requests/2/cancel', null, 'POST')).status, 401);
  assert.equal((await api('/requests/2/cancel', 1, 'POST')).status, 403);
  assert.equal((await api('/requests/2/cancel', 4, 'POST')).status, 403);
  assert.equal((await api('/requests/1/cancel', 2, 'POST')).status, 409);
  const cancelled = await api('/requests/2/cancel', 3, 'POST');
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.request.status, 'cancelled');
  assert.ok(cancelled.body.request.respondedAt);
  assert.equal((await api('/requests/2/cancel', 3, 'POST')).status, 200);
  assert.equal((await api('/requests/2', 1, 'PATCH', { status: 'approved' })).status, 409);
  assert.equal((await api('/rooms/1/requests', 3, 'POST')).status, 201);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ROOM_REQUEST WHERE user_id = 3 AND room_id = 1').get().n, 2);
  assert.equal((await api('/owner/requests')).body.requests.find(row => row.requestId === 2).status, 'cancelled');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM MATCHES').get().n, 2);
});

test('withdraw and approval racing for the same request have only one winning final state', async t => {
  const { api, db } = await fixture(t);
  const results = await Promise.all([api('/requests/2/cancel', 3, 'POST'), api('/requests/2', 1, 'PATCH', { status: 'approved' })]);
  assert.deepEqual(results.map(row => row.status).sort(), [200, 409]);
  const state = db.prepare('SELECT status FROM ROOM_REQUEST WHERE request_id = 2').get().status;
  const member = db.prepare("SELECT 1 FROM ROOM_MEMBER WHERE room_id = 1 AND user_id = 3 AND status = 'approved'").get();
  assert.equal(Boolean(member), state === 'approved');
});

test('leave releases a full room, revokes private member/match access, keeps history, and supports applying again', async t => {
  const { api, db } = await fixture(t);
  assert.equal((await api('/rooms/2/members/me', null, 'DELETE')).status, 401);
  assert.equal((await api('/rooms/2/members/me', 2, 'DELETE')).status, 403);
  assert.equal((await api('/rooms/2/members/me', 3, 'DELETE')).status, 403);
  assert.equal((await api('/rooms/2/members/me', 5, 'DELETE')).status, 200);
  assert.equal((await api('/rooms/2/members/me', 5, 'DELETE')).status, 200);
  assert.equal(db.prepare('SELECT status FROM ROOM WHERE room_id = 2').get().status, 'available');
  assert.equal(db.prepare('SELECT status FROM ROOM_MEMBER WHERE room_id = 2 AND user_id = 5').get().status, 'left');
  assert.equal((await api('/rooms/2/members', 5)).status, 403);
  assert.equal((await api('/matches', 5)).body.matches.length, 0);
  assert.equal((await api('/rooms/2', 5)).body.room.isMember, false);
  assert.equal((await api('/requests/mine', 5)).body.requests.find(request => request.room.roomId === 2).membershipActive, false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM MATCHES WHERE room_id = 2').get().n, 1);
  const request = await api('/rooms/2/requests', 5, 'POST');
  assert.equal(request.status, 201);
  assert.equal((await api(`/requests/${request.body.request.requestId}`, 2, 'PATCH', { status: 'approved' })).status, 200);
  assert.equal((await api('/rooms/2', 5)).body.room.isMember, true);
  assert.equal((await api('/matches', 5)).body.matches.length, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM MATCHES WHERE room_id = 2').get().n, 1);
  assert.equal(db.prepare('SELECT status FROM ROOM WHERE room_id = 2').get().status, 'full');
});

test('leave keeps paused listings paused and database failures cannot partially cancel or end membership', async t => {
  const { api, db } = await fixture(t);
  db.exec('PRAGMA query_only = ON');
  assert.equal((await api('/requests/2/cancel', 3, 'POST')).status, 500);
  assert.equal((await api('/rooms/2/members/me', 5, 'DELETE')).status, 500);
  db.exec('PRAGMA query_only = OFF');
  assert.equal(db.prepare('SELECT status FROM ROOM_REQUEST WHERE request_id = 2').get().status, 'pending');
  assert.equal(db.prepare('SELECT status FROM ROOM_MEMBER WHERE room_id = 2 AND user_id = 5').get().status, 'approved');
  await api('/rooms/2', 2, 'PATCH', { status: 'inactive' });
  assert.equal((await api('/rooms/2/members/me', 5, 'DELETE')).status, 200);
  assert.equal(db.prepare('SELECT status FROM ROOM WHERE room_id = 2').get().status, 'inactive');
});
