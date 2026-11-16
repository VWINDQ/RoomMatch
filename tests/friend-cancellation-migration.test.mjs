import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { openDatabase, runMigrations } from '../server/database.js';

const migrationName = '006_cancel_friend_invitation.sql';

function legacyFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'roommatch-friend-cancel-migration-'));
  for (const filename of readdirSync('database/migrations').filter(name => name.endsWith('.sql') && Number(name.slice(0, 3)) < 6)) {
    copyFileSync(`database/migrations/${filename}`, join(directory, filename));
  }
  const db = openDatabase({ filename: ':memory:', migrationsDirectory: directory });
  db.exec(`INSERT INTO FRIEND_CONNECTION(connection_id,sender_id,recipient_id,status,created_at,responded_at) VALUES
    (11,1,2,'pending','2026-01-01T00:00:00Z',NULL),
    (12,1,3,'accepted','2026-01-02T00:00:00Z','2026-01-03T00:00:00Z'),
    (13,2,3,'declined','2026-01-04T00:00:00Z','2026-01-05T00:00:00Z')`);
  return { db, directory, close() { db.close(); rmSync(directory, { recursive: true, force: true }); } };
}

function originalTables(db) {
  return db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT GLOB '_roommatch_*' AND name != 'FRIEND_CONNECTION' ORDER BY name").all()
    .map(table => ({ ...table, rows: db.prepare(`SELECT * FROM ${table.name} ORDER BY rowid`).all() }));
}

test('friend cancellation migration preserves all existing rows and other schemas and applies once', () => {
  const fixture = legacyFixture();
  const { db, directory } = fixture;
  try {
    const original = originalTables(db);
    const invitations = db.prepare('SELECT * FROM FRIEND_CONNECTION ORDER BY connection_id').all();
    copyFileSync(`database/migrations/${migrationName}`, join(directory, migrationName));
    runMigrations(db, directory);
    runMigrations(db, directory);
    assert.deepEqual(originalTables(db), original);
    assert.deepEqual(db.prepare('SELECT * FROM FRIEND_CONNECTION ORDER BY connection_id').all(), invitations);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 6);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM _roommatch_migrations WHERE filename=?').get(migrationName).n, 1);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.deepEqual(db.prepare("PRAGMA index_list('FRIEND_CONNECTION')").all().map(row => row.name).sort(),
      ['friend_connection_pair', 'friend_connection_recipient', 'friend_connection_sender']);
  } finally { fixture.close(); }
});

test('cancelled invitations require a timestamp and preserve finality, pair uniqueness and foreign keys', () => {
  const db = openDatabase({ filename: ':memory:' });
  try {
    db.exec('INSERT INTO FRIEND_CONNECTION(sender_id,recipient_id) VALUES(1,2)');
    assert.throws(() => db.exec("UPDATE FRIEND_CONNECTION SET status='cancelled'"), /CHECK/);
    assert.throws(() => db.exec("UPDATE FRIEND_CONNECTION SET status='unknown',responded_at=CURRENT_TIMESTAMP"), /Invalid friend connection transition/);
    assert.throws(() => db.exec('UPDATE FRIEND_CONNECTION SET sender_id=3'), /Invalid friend connection transition/);
    db.exec("UPDATE FRIEND_CONNECTION SET status='cancelled',responded_at=CURRENT_TIMESTAMP");
    const cancelled = db.prepare('SELECT * FROM FRIEND_CONNECTION').get();
    assert.equal(cancelled.status, 'cancelled');
    assert.ok(cancelled.responded_at);
    assert.throws(() => db.exec("UPDATE FRIEND_CONNECTION SET status='accepted'"), /Invalid friend connection transition/);
    assert.throws(() => db.exec("UPDATE FRIEND_CONNECTION SET status='pending',responded_at=NULL"), /Invalid friend connection transition/);
    assert.throws(() => db.exec('INSERT INTO FRIEND_CONNECTION(sender_id,recipient_id) VALUES(2,1)'), /UNIQUE/);
    assert.throws(() => db.exec('INSERT INTO FRIEND_CONNECTION(sender_id,recipient_id) VALUES(1,1)'), /CHECK/);
    assert.throws(() => db.exec('INSERT INTO FRIEND_CONNECTION(sender_id,recipient_id) VALUES(1,999)'), /FOREIGN KEY/);
    db.exec('DELETE FROM USER WHERE user_id=2');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM FRIEND_CONNECTION').get().n, 0);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { db.close(); }
});

test('failure during friend table rebuild rolls back rows, schema, indexes and ledger before retry', () => {
  const fixture = legacyFixture();
  const { db, directory } = fixture;
  try {
    const original = db.prepare("SELECT type,name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
    const invitations = db.prepare('SELECT * FROM FRIEND_CONNECTION ORDER BY connection_id').all();
    const migration = readFileSync(`database/migrations/${migrationName}`, 'utf8');
    writeFileSync(join(directory, migrationName), `${migration}\nINSERT INTO missing_table VALUES(1);`);
    assert.throws(() => runMigrations(db, directory), /Migration 006_cancel_friend_invitation.sql failed/);
    assert.deepEqual(db.prepare("SELECT type,name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all(), original);
    assert.deepEqual(db.prepare('SELECT * FROM FRIEND_CONNECTION ORDER BY connection_id').all(), invitations);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 5);
    assert.equal(db.prepare('SELECT filename FROM _roommatch_migrations WHERE filename=?').get(migrationName), undefined);
    writeFileSync(join(directory, migrationName), migration);
    runMigrations(db, directory);
    assert.deepEqual(db.prepare('SELECT * FROM FRIEND_CONNECTION ORDER BY connection_id').all(), invitations);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { fixture.close(); }
});
