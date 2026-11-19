import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from './support/postgres.mjs';
import { demoEmail, demoListings, manageDemoRooms } from '../scripts/demo-rooms.mjs';

test('development demos are idempotent and cleanup never cascades into user records', async t => {
  const db = await openDatabase({ filename: ':memory:' });
  const client = await db.pool.connect();
  const directory = await mkdtemp(join(tmpdir(), 'rm12-demo-test-'));
  const manifestPath = join(directory, 'manifest.json');
  t.after(async () => { client.release(); await db.close(); await rm(directory, { recursive: true }); });
  const manage = action => manageDemoRooms(client, { action, manifestPath });
  const original = (await client.query('SELECT to_jsonb(r)::text AS snapshot FROM room r ORDER BY room_id')).rows;
  const added = await manage('seed');
  assert.equal(added.added, 30);
  assert.equal((await manage('seed')).added, 0);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert.equal(manifest.rooms.length, 30);
  assert.equal(manifest.images.length, 30);
  assert.equal(manifest.email, demoEmail);
  assert.equal('password' in manifest, false);
  const owner = (await client.query('SELECT * FROM "USER" WHERE user_id=$1', [added.ownerId])).rows[0];
  assert.match(owner.password_hash, /^\$argon2id\$v=19\$m=65536,t=3,p=1\$/);
  const roomId = added.roomIds[0];
  for (const [insert, remove, params] of [
    ['INSERT INTO room_favorite(user_id,room_id) VALUES(1,$1)', 'DELETE FROM room_favorite WHERE user_id=1 AND room_id=$1', [roomId]],
    ["INSERT INTO room_request(user_id,room_id) VALUES(1,$1)", 'DELETE FROM room_request WHERE user_id=1 AND room_id=$1', [roomId]],
    ["INSERT INTO friend_connection(sender_id,recipient_id) VALUES(1,$1)", 'DELETE FROM friend_connection WHERE sender_id=1 AND recipient_id=$1', [added.ownerId]],
    ["INSERT INTO lifestyle(user_id,lifestyle_name) VALUES($1,'user added')", 'DELETE FROM lifestyle WHERE user_id=$1', [added.ownerId]],
    ["INSERT INTO room_image(room_id,image_url,image_order) VALUES($1,'http://localhost/extra.png',1)", 'DELETE FROM room_image WHERE room_id=$1 AND image_order=1', [roomId]],
    ["INSERT INTO room(owner_id,description,google_maps_url,price,capacity) VALUES($1,'user added','https://maps.google.com',1000,2)", "DELETE FROM room WHERE owner_id=$1 AND description='user added'", [added.ownerId]],
  ]) {
    await client.query(insert, params);
    await assert.rejects(manage('cleanup'), /Related records exist/);
    assert.equal((await client.query('SELECT COUNT(*)::int AS count FROM room WHERE owner_id=$1', [added.ownerId])).rows[0].count >= 30, true);
    await client.query(remove, params);
  }
  await client.query('UPDATE room SET price=price+1 WHERE room_id=$1', [roomId]);
  await assert.rejects(manage('cleanup'), /Tracked rooms changed/);
  await assert.rejects(manage('seed'), /Tracked rooms changed/);
  await client.query('UPDATE room SET price=price-1 WHERE room_id=$1', [roomId]);
  const cleaned = await manage('cleanup');
  assert.deepEqual(cleaned, { removed: 30, ownerRemoved: 1 });
  assert.deepEqual((await client.query('SELECT to_jsonb(r)::text AS snapshot FROM room r ORDER BY room_id')).rows, original);
  assert.equal((await manage('cleanup')).removed, 0);
  // An existing account with the reserved email must never be adopted by the script.
  await client.query('INSERT INTO "USER"(first_name,last_name,email,password_hash) VALUES($1,$2,$3,$4)', ['Other', 'Account', demoEmail, 'unrelated']);
  await assert.rejects(manage('seed'), /already exists without an owned manifest/);
  assert.equal(demoListings('http://localhost:5173').length, 30);
  assert.throws(() => demoListings('https://example.com'), /local HTTP origin/);
});
