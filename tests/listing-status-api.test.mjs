import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations, seedDatabase } from '../server/database.js';
import { startRoomMatchServer } from '../server/app.js';
import { createToken } from '../server/auth.js';

function openIsolatedDatabase(filename) {
  // Validate before opening anything: a wrong argument must never reach a disk database.
  assert.equal(filename, ':memory:', 'RM-07 tests require an explicit in-memory database');
  const db = new DatabaseSync(filename, { enableForeignKeyConstraints: true });
  try {
    assert.equal(db.prepare('PRAGMA database_list').get().file, '');
    runMigrations(db);
    seedDatabase(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

test('RM-07 database setup refuses missing, malformed and disk database targets', () => {
  for (const filename of [undefined, null, {}, { filename: ':memory:' }, '', 'database/roommatch.sqlite']) {
    assert.throws(() => openIsolatedDatabase(filename), /explicit in-memory database/);
  }
});

test('status PATCH reads the latest room inside its transaction and preserves listing fields', async t => {
  const db = openIsolatedDatabase(':memory:');
  const app = await startRoomMatchServer({ db, port: 0, logger: { error() {} } });
  t.after(async () => { await new Promise(resolve => app.server.close(resolve)); db.close(); });
  const patch = async (body, userId = 1) => {
    const response = await fetch(`http://127.0.0.1:${app.server.address().port}/api/rooms/1`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${createToken(userId)}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  const exec = db.exec.bind(db);
  let interleaved = false;
  // Deterministically interleave a committed edit immediately before the write lock.
  t.mock.method(db, 'exec', sql => {
    if (sql === 'BEGIN IMMEDIATE' && !interleaved) {
      interleaved = true;
      db.prepare("UPDATE ROOM SET price=4321, description='Latest title\nLatest description', capacity=2 WHERE room_id=1").run();
    }
    return exec(sql);
  });
  const opened = await patch({ status: 'available' });
  assert.equal(opened.status, 200);
  assert.equal(opened.body.room.price, 4321);
  assert.equal(opened.body.room.capacity, 2);
  assert.equal(opened.body.room.status, 'full');
  assert.equal(db.prepare('SELECT description FROM ROOM WHERE room_id=1').get().description, 'Latest title\nLatest description');
  assert.equal((await patch({ status: 'inactive' })).body.room.status, 'inactive');
  assert.equal((await patch({ status: 'bogus' })).status, 400);
  assert.equal((await patch({ status: 'available' }, 2)).status, 403);
  assert.equal(db.prepare('SELECT status FROM ROOM WHERE room_id=1').get().status, 'inactive');
  // Status changes must never write listing columns or trigger capacity updates.
  db.exec(`CREATE TRIGGER status_test_no_listing_write BEFORE UPDATE OF price, capacity, description, google_maps_url, price_basis, locality, cost_notes ON ROOM
    BEGIN SELECT RAISE(ABORT, 'unexpected listing write'); END;`);
  db.exec('PRAGMA query_only=ON');
  assert.equal((await patch({ status: 'available' })).status, 500);
  db.exec('PRAGMA query_only=OFF');
  assert.equal(db.prepare('SELECT status FROM ROOM WHERE room_id=1').get().status, 'inactive');
  assert.equal((await patch({ status: 'available' })).body.room.status, 'full');
  // Ownership is rechecked after obtaining the transaction lock, too.
  t.mock.method(db, 'exec', sql => {
    if (sql === 'BEGIN IMMEDIATE') db.prepare('UPDATE ROOM SET owner_id=2 WHERE room_id=1').run();
    return exec(sql);
  });
  assert.equal((await patch({ status: 'inactive' })).status, 403);
  assert.equal(db.prepare('SELECT status FROM ROOM WHERE room_id=1').get().status, 'full');
});
