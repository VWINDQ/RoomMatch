import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, testConnectionString } from './support/postgres.mjs';
import { openDatabase as openPostgres, runMigrations, seedDatabase, compileSql, BUSINESS_TABLES, tableIdentifier } from '../server/database.js';
import { openDatabase as openSqlite } from './support/sqlite-legacy.js';
import { importSqlite } from '../scripts/import-sqlite.mjs';
import { startRoomMatchServer } from '../server/app.js';
import { createToken } from '../server/auth.js';

const fkError = (error) => error.code === '23503';
const uniqueError = (error) => error.code === '23505';

test('account profile migration preserves legacy records without classifying their email or university', async () => {
  const db = await openDatabase({ filename: ':memory:', seed: false, migrate: false });
  const directory = mkdtempSync(join(tmpdir(), 'roommatch-account-migration-'));
  try {
    for (const file of ['001_initial_schema.sql', '002_google_oauth.sql', '003_account_profile.sql']) {
      writeFileSync(join(directory, file), readFileSync(new URL(`../database/postgresql/migrations/${file}`, import.meta.url)));
    }
    await runMigrations(db, directory);
    const legacy = await db.prepare(`INSERT INTO USER(first_name,last_name,email,password_hash,university)
      VALUES('Existing','Student','old@mail.kmutt.ac.th','legacy-hash','Legacy University') RETURNING *`).get();
    const students = await Promise.all([
      ['kmutt_student', 'มหาวิทยาลัยเทคโนโลยีพระจอมเกล้าธนบุรี'], ['other_student', 'Unlisted University'],
    ].map(([type, university]) => db.prepare(`INSERT INTO USER(first_name,last_name,email,password_hash,university,account_type)
      VALUES('Existing','Student',?,'legacy-hash',?,?) RETURNING user_id, university`).get(`${type}@example.test`, university, type)));
    await runMigrations(db);
    await runMigrations(db);
    const { account_type, profile_setup_pending, profile_reminder_seen_at, ...retained } = await db.prepare('SELECT * FROM USER WHERE user_id=?').get(legacy.user_id);
    assert.deepEqual(retained, Object.fromEntries(Object.entries(legacy).filter(([name]) => !['account_type', 'profile_setup_pending'].includes(name))));
    assert.equal(account_type, null);
    assert.equal(profile_setup_pending, false);
    assert.equal(profile_reminder_seen_at, null);
    for (const student of students) {
      assert.deepEqual(await db.prepare('SELECT account_type, university FROM USER WHERE user_id=?').get(student.user_id),
        { account_type: 'student', university: student.university });
    }
    await assert.rejects(db.prepare("UPDATE USER SET account_type='general' WHERE user_id=?").run(legacy.user_id), error => error.code === '23514');
  } finally { await db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('SQL binding leaves string literals, identifiers, comments and function bodies intact', () => {
  assert.equal(compileSql(`SELECT '?' AS "?", user_id FROM USER WHERE email = ? -- USER ?\nAND first_name = ? /* ? USER */`), `SELECT '?' AS "?", user_id FROM "USER" WHERE email = $1 -- USER ?\nAND first_name = $2 /* ? USER */`);
  assert.equal(compileSql('DO $$ BEGIN RAISE NOTICE \'USER ?\'; END $$;'), 'DO $$ BEGIN RAISE NOTICE \'USER ?\'; END $$;');
  assert.equal(compileSql('ALTER TABLE room DISABLE TRIGGER USER'), 'ALTER TABLE room DISABLE TRIGGER USER');
  assert.equal(compileSql(String.raw`SELECT E'quote\' USER ?', ? /* outer /* nested ? */ USER ? */ , ?`), String.raw`SELECT E'quote\' USER ?', $1 /* outer /* nested ? */ USER ? */ , $2`);
});

test('PostgreSQL schema, seed, identity sequences, case-insensitive email and foreign keys', async () => {
  const db = await openDatabase({ filename: ':memory:' });
  assert.equal((await db.prepare('SELECT version() AS version').get()).version.startsWith('PostgreSQL'), true);
  const tables = await db.prepare("SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename <> '_roommatch_migrations'").all();
  assert.deepEqual(tables.map(row => row.tablename.toUpperCase()).sort(), [...BUSINESS_TABLES, 'OAUTH_IDENTITY', 'OAUTH_ATTEMPT', 'OAUTH_TICKET'].sort());
  assert.equal(await seedDatabase(db), false);
  const user = await db.prepare("INSERT INTO USER(first_name,last_name,email,password_hash) VALUES('New','Student','NEW@example.test','test-hash') RETURNING user_id,created_at").get();
  assert.ok(user.user_id > 5);
  assert.match(user.created_at, /^\d{4}-\d\d-\d\dT.*Z$/);
  await assert.rejects(db.prepare("INSERT INTO USER(first_name,last_name,email,password_hash) VALUES('Dup','Student','new@EXAMPLE.test','test-hash')").run(), uniqueError);
  await assert.rejects(db.prepare('INSERT INTO ROOM_FAVORITE(user_id,room_id) VALUES(999,1)').run(), fkError);
  await assert.rejects(db.prepare('INSERT INTO PREFERENCE(user_id,budget_min,budget_max) VALUES(?,100,1)').run(user.user_id), error => error.code === '23514');
  await assert.rejects(db.prepare("UPDATE ROOM SET capacity=1 WHERE room_id=1").run(), /current occupancy/);
  await assert.rejects(db.prepare("INSERT INTO ROOM_MEMBER(user_id,room_id,status) VALUES(1,1,'left')").run(), /owner is not stored/);
  const money = Number.MAX_SAFE_INTEGER;
  await db.prepare('UPDATE ROOM SET price = ? WHERE room_id = 1').run(money);
  assert.equal((await db.prepare('SELECT price FROM ROOM WHERE room_id=1').get()).price, money);
  await db.prepare("UPDATE USER SET date_of_birth='2000-01-02' WHERE user_id=?").run(user.user_id);
  assert.equal((await db.prepare('SELECT date_of_birth FROM USER WHERE user_id=?').get(user.user_id)).date_of_birth, '2000-01-02');
  await db.close();
});

test('PostgreSQL migration errors roll back schema and ledger; applied checksums cannot change', async () => {
  const db = await openDatabase({ filename: ':memory:', seed: false });
  const directory = mkdtempSync(join(tmpdir(), 'roommatch-pg-migration-'));
  try {
    const migration = join(directory, '002_probe.sql');
    writeFileSync(migration, 'CREATE TABLE migration_probe(id BIGINT PRIMARY KEY); INSERT INTO nonexistent_table VALUES(1);');
    await assert.rejects(runMigrations(db, directory), error => error.code === '42P01');
    assert.equal((await db.prepare("SELECT to_regclass('migration_probe') AS target").get()).target, null);
    assert.equal(await db.prepare("SELECT 1 FROM _roommatch_migrations WHERE filename='002_probe.sql'").get(), undefined);
    writeFileSync(migration, 'CREATE TABLE migration_probe(id BIGINT PRIMARY KEY);');
    await runMigrations(db, directory);
    await runMigrations(db, directory);
    writeFileSync(migration, 'CREATE TABLE changed_probe(id BIGINT PRIMARY KEY);');
    await assert.rejects(runMigrations(db, directory), /Applied migration changed/);
    assert.equal((await db.prepare("SELECT to_regclass('changed_probe') AS target").get()).target, null);
  } finally { await db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('SQLite import preserves every business row, credentials, image paths, history and identities without changing its source', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'roommatch-pg-import-'));
  const source = join(directory, 'legacy.sqlite');
  const sqlite = openSqlite({ filename: source });
  const expected = new Map();
  try {
    sqlite.exec("UPDATE ROOM_MEMBER SET status='left' WHERE room_id=2; INSERT INTO FRIEND_CONNECTION(sender_id,recipient_id,status,responded_at) VALUES(3,4,'cancelled',CURRENT_TIMESTAMP)");
    sqlite.exec("UPDATE USER SET profile_image='/uploads/1/00000000-0000-0000-0000-000000000000.webp' WHERE user_id=1");
    for (const table of BUSINESS_TABLES) expected.set(table, sqlite.prepare(`SELECT * FROM "${table}" ORDER BY 1, 2`).all());
  } finally { sqlite.close(); }
  const before = readFileSync(source);
  const db = await openDatabase({ filename: ':memory:', seed: false });
  try {
    const counts = await importSqlite({ source, connectionString: testConnectionString(), schema: db.schema });
    for (const table of BUSINESS_TABLES) {
      const actual = await db.prepare(`SELECT * FROM ${tableIdentifier(table)} ORDER BY 1, 2`).all();
      const normalized = expected.get(table).map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value && ['created_at','updated_at','requested_at','responded_at','joined_at','matched_at'].includes(key) ? new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : value + 'Z').toISOString() : value])));
      assert.deepEqual(actual, table === 'USER' ? normalized.map(row => ({ ...row, account_type: null, profile_setup_pending: false, profile_reminder_seen_at: null })) : table === 'ROOM' ? normalized.map(row => ({ ...row, owner_is_resident: true })) : normalized, table);
      assert.equal(counts[table], normalized.length);
    }
    assert.deepEqual(readFileSync(source), before);
    await assert.rejects(importSqlite({ source, connectionString: testConnectionString(), schema: db.schema }), /destination must be empty/);
    assert.equal((await db.prepare("INSERT INTO USER(first_name,last_name,email,password_hash) VALUES('Imported','Next','import-next@example.test','unused') RETURNING user_id").get()).user_id, 6);
    // Trigger disabling during import must not leak into normal writes.
    await assert.rejects(db.prepare("INSERT INTO ROOM_MEMBER(user_id,room_id,status) VALUES(1,1,'left')").run(), /owner is not stored/);
  } finally { await db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('a failed SQLite import rolls back all rows and re-enables triggers before a retry', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'roommatch-pg-import-fail-'));
  const source = join(directory, 'legacy.sqlite');
  const sqlite = openSqlite({ filename: source });
  sqlite.exec("UPDATE USER SET date_of_birth='not-a-date' WHERE user_id=1");
  sqlite.close();
  const db = await openDatabase({ filename: ':memory:', seed: false });
  try {
    await assert.rejects(importSqlite({ source, connectionString: testConnectionString(), schema: db.schema }), error => error.code === '22007');
    for (const table of BUSINESS_TABLES) assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM ${tableIdentifier(table)}`).get()).n, 0);
    const disabled = await db.prepare("SELECT tgname FROM pg_trigger WHERE tgrelid IN (SELECT oid FROM pg_class WHERE relnamespace=current_schema()::regnamespace) AND NOT tgisinternal AND tgenabled='D'").all();
    assert.deepEqual(disabled, []);
  } finally { await db.close(); rmSync(directory, { recursive: true, force: true }); }
});

async function twoServers(t) {
  const db = await openDatabase({ filename: ':memory:' });
  const second = await openPostgres({ connectionString: testConnectionString(), schema: db.schema, seed: false });
  const apps = await Promise.all([db, second].map(db => startRoomMatchServer({ db, port: 0, logger: { error() {} } })));
  t.after(async () => { await Promise.all(apps.map(app => new Promise(resolve => app.server.close(resolve)))); await second.close(); await db.close(); });
  const api = async (server, path, userId, method, body) => {
    const response = await fetch(`http://127.0.0.1:${apps[server].server.address().port}/api${path}`, { method, headers: { Authorization: `Bearer ${createToken(userId)}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  return { db, api };
}

test('two independent API pools cannot approve two applicants into the last remaining place', async t => {
  const { db, api } = await twoServers(t);
  const request = await api(0, '/rooms/1/requests', 4, 'POST');
  assert.equal(request.status, 201);
  const results = await Promise.all([
    api(0, '/requests/2', 1, 'PATCH', { status: 'approved' }),
    api(1, `/requests/${request.body.request.requestId}`, 1, 'PATCH', { status: 'approved' }),
  ]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM ROOM_MEMBER WHERE room_id=1 AND status='approved'").get()).n, 2);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM MATCHES WHERE room_id=1").get()).n, 2);
  assert.equal((await db.prepare('SELECT status FROM ROOM WHERE room_id=1').get()).status, 'full');
});

test('two independent pools serialize inverse invitations and cancellation versus consent', async t => {
  const { db, api } = await twoServers(t);
  const invitations = await Promise.all([
    api(0, '/friends/connections', 3, 'POST', { recipientId: 4 }),
    api(1, '/friends/connections', 4, 'POST', { recipientId: 3 }),
  ]);
  assert.deepEqual(invitations.map(result => result.status).sort(), [201, 409]);
  const row = await db.prepare('SELECT * FROM FRIEND_CONNECTION').get();
  const decisions = await Promise.all([
    api(0, `/friends/connections/${row.connection_id}/cancel`, row.sender_id, 'POST'),
    api(1, `/friends/connections/${row.connection_id}`, row.recipient_id, 'PATCH', { status: 'accepted' }),
  ]);
  assert.deepEqual(decisions.map(result => result.status).sort(), [200, 409]);
  assert.equal((await db.prepare('SELECT status FROM FRIEND_CONNECTION').get()).status, decisions.find(result => result.status === 200).body.connection.status);
});

test('legacy SQLite databases without optional friend/favorite tables keep the original eight tables intact', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'roommatch-pg-early-import-'));
  const source = join(directory, 'legacy.sqlite');
  const sqlite = openSqlite({ filename: source });
  sqlite.exec('DROP TABLE FRIEND_CONNECTION; DROP TABLE ROOM_FAVORITE;');
  sqlite.close();
  const db = await openDatabase({ filename: ':memory:', seed: false });
  try {
    const counts = await importSqlite({ source, connectionString: testConnectionString(), schema: db.schema });
    assert.equal(counts.USER, 5);
    assert.equal(counts.ROOM, 4);
    assert.equal(counts.MATCHES, 2);
    assert.equal(counts.FRIEND_CONNECTION, 0);
    assert.equal(counts.ROOM_FAVORITE, 0);
  } finally { await db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('a PostgreSQL connection failure returns a safe API error while the SPA remains available', async t => {
  const db = await openDatabase({ filename: ':memory:', seed: false });
  const directory = mkdtempSync(join(tmpdir(), 'roommatch-pg-outage-'));
  writeFileSync(join(directory, 'index.html'), '<!doctype html><title>RoomMatch outage test</title>');
  const app = await startRoomMatchServer({ db, port: 0, staticDirectory: directory, logger: { error() {} } });
  t.after(async () => { await new Promise(resolve => app.server.close(resolve)); rmSync(directory, { recursive: true, force: true }); });
  await db.close();
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const page = await fetch(`${base}/profile`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /RoomMatch outage test/);
  const response = await fetch(`${base}/api/health`);
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'Internal server error' });
});
