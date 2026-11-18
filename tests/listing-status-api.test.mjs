import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDatabase } from './support/postgres.mjs';
import { startRoomMatchServer } from '../server/app.js';
import { createToken } from '../server/auth.js';

async function openIsolatedDatabase(filename) {
  // Reject an unintended target before opening a PostgreSQL fixture.
  assert.equal(filename, ':memory:', 'RM-07 tests require an explicit in-memory database');
  return await openDatabase({ filename });
}

test('RM-07 database setup refuses missing, malformed and disk database targets', async () => {
  for (const filename of [undefined, null, {}, { filename: ':memory:' }, '', 'database/roommatch.sqlite']) {
    await assert.rejects(async () => await openIsolatedDatabase(filename), /explicit in-memory database/);
  }
});

test('status PATCH reads the latest room inside its transaction and preserves listing fields', async t => {
  const db = await openIsolatedDatabase(':memory:');
  const app = await startRoomMatchServer({ db, port: 0, logger: { error() {} } });
  t.after(async () => { await new Promise(resolve => app.server.close(resolve)); await db.close(); });
  const patch = async (body, userId = 1) => {
    const response = await fetch(`http://127.0.0.1:${app.server.address().port}/api/rooms/1`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${createToken(userId)}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  const exec = db.exec.bind(db);
  let interleaved = false;
  // Deterministically interleave a committed edit immediately before the write lock.
  t.mock.method(db, 'exec', async sql => {
    if (sql === 'BEGIN' && !interleaved) {
      interleaved = true;
      await db.prepare("UPDATE ROOM SET price=4321, description='Latest title\nLatest description', capacity=2 WHERE room_id=1").run();
    }
    return exec(sql);
  });
  const opened = await patch({ status: 'available' });
  assert.equal(opened.status, 200);
  assert.equal(opened.body.room.price, 4321);
  assert.equal(opened.body.room.capacity, 2);
  assert.equal(opened.body.room.status, 'full');
  assert.equal((await db.prepare('SELECT description FROM ROOM WHERE room_id=1').get()).description, 'Latest title\nLatest description');
  assert.equal((await patch({ status: 'inactive' })).body.room.status, 'inactive');
  assert.equal((await patch({ status: 'bogus' })).status, 400);
  assert.equal((await patch({ status: 'available' }, 2)).status, 403);
  assert.equal((await db.prepare('SELECT status FROM ROOM WHERE room_id=1').get()).status, 'inactive');
  // Status changes must never write listing columns or trigger capacity updates.
  await db.exec(`CREATE FUNCTION status_test_no_listing_write_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'unexpected listing write'; END $$; CREATE TRIGGER status_test_no_listing_write BEFORE UPDATE OF price, capacity, description, google_maps_url, price_basis, locality, cost_notes ON ROOM FOR EACH ROW EXECUTE FUNCTION status_test_no_listing_write_fn();`);
  db.setReadOnly(true);
  assert.equal((await patch({ status: 'available' })).status, 500);
  db.setReadOnly(false);
  assert.equal((await db.prepare('SELECT status FROM ROOM WHERE room_id=1').get()).status, 'inactive');
  assert.equal((await patch({ status: 'available' })).body.room.status, 'full');
  // Ownership is rechecked after obtaining the transaction lock, too.
  t.mock.method(db, 'exec', async sql => {
    if (sql === 'BEGIN') await db.prepare('UPDATE ROOM SET owner_id=2 WHERE room_id=1').run();
    return exec(sql);
  });
  assert.equal((await patch({ status: 'inactive' })).status, 403);
  assert.equal((await db.prepare('SELECT status FROM ROOM WHERE room_id=1').get()).status, 'full');
});
