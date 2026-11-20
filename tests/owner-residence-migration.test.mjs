import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readdirSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from './support/postgres.mjs';
import { runMigrations } from '../server/database.js';

test('owner residence migration preserves legacy rooms, memberships and history and defaults new rooms to rentals', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'roommatch-before-residence-'));
  const source = new URL('../database/postgresql/migrations/', import.meta.url);
  for (const name of readdirSync(source).filter(name => name < '005')) copyFileSync(new URL(name, source), join(directory, name));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const db = await openDatabase({ filename: ':memory:', seed: false, migrationsDirectory: directory });
  t.after(() => db.close());
  for (const id of [1, 2]) await db.prepare('INSERT INTO USER(user_id,first_name,last_name,email,password_hash) VALUES(?,?,?,?,?)').run(id, 'Migration', 'Test', `migration-${id}@example.test`, 'unused-test-hash');
  await db.exec("INSERT INTO ROOM(room_id,owner_id,google_maps_url,price,capacity,description,status) VALUES(1,1,'https://maps.google.com/',4000,2,'Legacy shared room','available'),(2,1,'https://maps.google.com/',4000,1,'Legacy full room','full')");
  await db.exec("INSERT INTO ROOM_REQUEST(user_id,room_id,status,responded_at) VALUES(2,1,'approved',CURRENT_TIMESTAMP)");
  await db.exec("INSERT INTO ROOM_MEMBER(user_id,room_id,status) VALUES(2,1,'approved')");
  await db.exec('INSERT INTO MATCHES(initiator_user_id,completer_user_id,room_id) VALUES(1,2,1)');
  const snapshots = async () => Object.fromEntries(await Promise.all(['ROOM_REQUEST', 'ROOM_MEMBER', 'MATCHES'].map(async table => [table, await db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()])));
  const before = await snapshots();
  await runMigrations(db);
  assert.deepEqual(await snapshots(), before);
  assert.deepEqual(await db.prepare('SELECT room_id,capacity,status,owner_is_resident FROM ROOM ORDER BY room_id').all(), [
    { room_id: 1, capacity: 2, status: 'full', owner_is_resident: true },
    { room_id: 2, capacity: 1, status: 'full', owner_is_resident: true },
  ]);
  await db.exec("INSERT INTO ROOM(room_id,owner_id,google_maps_url,price,capacity,description) VALUES(3,1,'https://maps.google.com/',4000,1,'New rental')");
  const rental = await db.prepare("SELECT owner_is_resident,status FROM ROOM WHERE description='New rental'").get();
  assert.deepEqual(rental, { owner_is_resident: false, status: 'available' });
  await runMigrations(db);
  assert.deepEqual(await snapshots(), before);
});
