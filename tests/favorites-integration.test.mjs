import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createToken } from '../server/auth.js';
import { openDatabase, runMigrations } from '../server/database.js';
import { startRoomMatchServer } from '../server/app.js';

test('real Favorites migration 004 arriving after UX 005 preserves rows and applies exactly once', () => {
  const directory = mkdtempSync(join(tmpdir(), 'roommatch-favorites-late-'));
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true });
  try {
    for (const name of ['001_initial_schema.sql', '002_repair_room_description_newlines.sql', '003_friend_connections.sql']) {
      copyFileSync(`database/migrations/${name}`, join(directory, name));
      db.exec(readFileSync(join(directory, name), 'utf8'));
    }
    db.exec(readFileSync('tests/fixtures/legacy-seed.sql', 'utf8'));
    db.exec('PRAGMA user_version=3');
    copyFileSync('database/migrations/005_ux_listing_and_request_lifecycle.sql', join(directory, '005_ux_listing_and_request_lifecycle.sql'));
    runMigrations(db, directory);
    db.exec("UPDATE ROOM SET price_basis='per_room',locality='ประชาอุทิศ',cost_notes='ไม่รวมค่าน้ำไฟ' WHERE room_id=1");
    const rooms = db.prepare('SELECT * FROM ROOM ORDER BY room_id').all();
    const requests = db.prepare('SELECT * FROM ROOM_REQUEST ORDER BY request_id').all();
    copyFileSync('database/migrations/004_room_favorites.sql', join(directory, '004_room_favorites.sql'));
    runMigrations(db, directory);
    db.exec('INSERT INTO ROOM_FAVORITE(user_id,room_id) VALUES(3,1)');
    runMigrations(db, directory);
    assert.deepEqual(db.prepare('SELECT * FROM ROOM ORDER BY room_id').all(), rooms);
    assert.deepEqual(db.prepare('SELECT * FROM ROOM_REQUEST ORDER BY request_id').all(), requests);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ROOM_FAVORITE').get().n, 1);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 5);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

async function fixture(t) {
  const db = openDatabase({ filename: ':memory:' });
  const app = await startRoomMatchServer({ db, port: 0, logger: { error() {} } });
  t.after(async () => { await new Promise(resolve => app.server.close(resolve)); db.close(); });
  const api = async (path, user = 3, method = 'GET', body) => {
    const response = await fetch(`http://127.0.0.1:${app.server.address().port}/api${path}`, { method,
      headers: { ...(user ? { Authorization: `Bearer ${createToken(user)}` } : {}), 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json() };
  };
  return { db, api };
}

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
  db.exec("INSERT INTO FRIEND_CONNECTION(sender_id,recipient_id,status,responded_at) VALUES(3,4,'accepted',CURRENT_TIMESTAMP)");
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
