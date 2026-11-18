// Historical SQLite migration coverage remains separate from PostgreSQL API tests.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, runMigrations } from './support/sqlite-legacy.js';

test('additive migration preserves every original table row and schema', () => {
  const migrations = mkdtempSync(join(tmpdir(), 'roommatch-friend-migration-'));
  for (const file of ['001_initial_schema.sql', '002_repair_room_description_newlines.sql', '003_friend_connections.sql']) copyFileSync(`database/migrations/${file}`, join(migrations, file));
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
    runMigrations(legacy, migrations);
    assert.deepEqual(snapshot(), original);
    assert.equal(legacy.prepare('SELECT COUNT(*) AS count FROM FRIEND_CONNECTION').get().count, 0);
    runMigrations(legacy, migrations);
    assert.deepEqual(snapshot(), original);
    assert.deepEqual(legacy.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { legacy.close(); rmSync(migrations, { recursive: true, force: true }); }
});

test('UX migration preserves legacy rows and permits a lower-numbered teammate migration arriving later', () => {
  const directory = mkdtempSync(join(tmpdir(), 'roommatch-migration-order-'));
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true });
  try {
    for (const name of ['001_initial_schema.sql', '002_repair_room_description_newlines.sql', '003_friend_connections.sql']) {
      copyFileSync(`database/migrations/${name}`, join(directory, name));
      db.exec(readFileSync(join(directory, name), 'utf8'));
    }
    db.exec(readFileSync('tests/fixtures/legacy-seed.sql', 'utf8'));
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

test('a failed migration rolls back schema and ledger changes and can be retried', () => {
  const directory = mkdtempSync(join(tmpdir(), 'roommatch-migration-retry-'));
  const db = openDatabase({ filename: ':memory:' });
  const originalVersion = db.prepare('PRAGMA user_version').get().user_version;
  try {
    writeFileSync(join(directory, '006_failure.sql'), 'ALTER TABLE ROOM ADD COLUMN retry_probe TEXT; INSERT INTO missing_table VALUES(1);');
    assert.throws(() => runMigrations(db, directory), /Migration 006_failure.sql failed/);
    assert.equal(db.prepare('PRAGMA table_info(ROOM)').all().some(row => row.name === 'retry_probe'), false);
    assert.equal(db.prepare("SELECT 1 FROM _roommatch_migrations WHERE filename = '006_failure.sql'").get(), undefined);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, originalVersion);
    writeFileSync(join(directory, '006_failure.sql'), 'ALTER TABLE ROOM ADD COLUMN retry_probe TEXT;');
    runMigrations(db, directory);
    assert.ok(db.prepare('PRAGMA table_info(ROOM)').all().some(row => row.name === 'retry_probe'));
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

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

