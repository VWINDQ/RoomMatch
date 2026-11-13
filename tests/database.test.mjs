import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { scryptSync, timingSafeEqual } from 'node:crypto';
import { test } from 'node:test';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const migrationDirectory = resolve('database/migrations');
const migrationSql = readdirSync(migrationDirectory)
  .filter((filename) => filename.endsWith('.sql'))
  .sort()
  .map((filename) => readFileSync(resolve(migrationDirectory, filename), 'utf8'));
const seedSql = readFileSync(resolve('database/seed.sql'), 'utf8');

function createSeededDatabase({ repeat = false } = {}) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true });
  db.exec('PRAGMA foreign_keys = ON');
  for (const sql of migrationSql) db.exec(sql);
  if (repeat) {
    for (const sql of migrationSql) db.exec(sql);
  }
  db.exec(seedSql);
  if (repeat) db.exec(seedSql);
  return db;
}

test('migration preserves eight ER tables and adds isolated friend connections', () => {
  const db = createSeededDatabase({ repeat: true });
  try {
    const tables = db.prepare(`
      SELECT name FROM sqlite_schema
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all().map(({ name }) => name);

    assert.deepEqual(tables, [
      'FRIEND_CONNECTION',
      'LIFESTYLE',
      'MATCHES',
      'PREFERENCE',
      'ROOM',
      'ROOM_FAVORITE',
      'ROOM_IMAGE',
      'ROOM_MEMBER',
      'ROOM_REQUEST',
      'USER',
    ]);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);

    const memberPrimaryKey = db.prepare('PRAGMA table_info(ROOM_MEMBER)').all()
      .filter(({ pk }) => pk > 0)
      .sort((left, right) => left.pk - right.pk)
      .map(({ name }) => name);
    assert.deepEqual(memberPrimaryKey, ['user_id', 'room_id']);

    assert.throws(
      () => db.exec("INSERT INTO LIFESTYLE(user_id, lifestyle_name) VALUES (1, 'duplicate')"),
      /UNIQUE constraint failed/,
    );
    assert.throws(
      () => db.exec("INSERT INTO PREFERENCE(user_id) VALUES (1)"),
      /UNIQUE constraint failed/,
    );
  } finally {
    db.close();
  }
});

test('seed is repeatable, realistic, and uses the supported demo password hash', () => {
  const db = createSeededDatabase({ repeat: true });
  try {
    const expectedCounts = {
      USER: 5,
      LIFESTYLE: 5,
      PREFERENCE: 5,
      ROOM: 4,
      ROOM_IMAGE: 8,
      ROOM_MEMBER: 2,
      ROOM_REQUEST: 5,
      MATCHES: 2,
    };
    for (const [table, expected] of Object.entries(expectedCounts)) {
      assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, expected);
    }

    const requestStatuses = db.prepare(`
      SELECT status, COUNT(*) AS count FROM ROOM_REQUEST GROUP BY status
    `).all();
    assert.deepEqual(
      Object.fromEntries(requestStatuses.map(({ status, count }) => [status, count])),
      { approved: 2, pending: 2, rejected: 1 },
    );

    const descriptions = db.prepare(`
      SELECT description FROM ROOM ORDER BY room_id
    `).all();
    assert.ok(descriptions.every(({ description }) => description.includes('\n')));
    assert.ok(!descriptions.some(({ description }) => description.includes('\\n')));

    const { password_hash: encodedHash } = db.prepare(`
      SELECT password_hash FROM USER WHERE email = ? COLLATE NOCASE
    `).get('phoom.s@mail.kmutt.ac.th');
    const [algorithm, n, r, p, saltHex, expectedHex] = encodedHash.split('$');
    const actual = scryptSync('roommatch', Buffer.from(saltHex, 'hex'), 64, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: 64 * 1024 * 1024,
    });
    assert.equal(algorithm, 'scrypt');
    assert.equal(Buffer.from(expectedHex, 'hex').length, 64);
    assert.ok(timingSafeEqual(actual, Buffer.from(expectedHex, 'hex')));
  } finally {
    db.close();
  }
});

test('legacy room title separators are repaired without altering real line feeds', () => {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true });
  try {
    db.exec('PRAGMA foreign_keys = ON');
    db.exec(migrationSql[0]);
    db.prepare(`
      INSERT INTO USER(first_name, last_name, password_hash, email)
      VALUES ('Legacy', 'Owner', 'test-only-hash', 'legacy@example.test')
    `).run();
    db.prepare(`
      INSERT INTO ROOM(owner_id, google_maps_url, price, capacity, description)
      VALUES (1, 'https://maps.example.test', 5000, 2, ?)
    `).run('Legacy title\\nLegacy body');

    db.exec(migrationSql[1]);

    assert.equal(
      db.prepare('SELECT description FROM ROOM WHERE room_id = 1').get().description,
      'Legacy title\nLegacy body',
    );
  } finally {
    db.close();
  }
});

test('database triggers protect request, capacity, membership, and match invariants', () => {
  const db = createSeededDatabase();
  try {
    assert.throws(
      () => db.exec('INSERT INTO ROOM_REQUEST(user_id, room_id) VALUES (1, 1)'),
      /room owner cannot request own room/,
    );
    assert.throws(
      () => db.exec('INSERT INTO ROOM_REQUEST(user_id, room_id) VALUES (3, 1)'),
      /UNIQUE constraint failed/,
    );
    assert.throws(
      () => db.exec('INSERT INTO ROOM_REQUEST(user_id, room_id) VALUES (3, 2)'),
      /room is not available for requests/,
    );
    assert.throws(
      () => db.exec('UPDATE ROOM SET capacity = 1 WHERE room_id = 1'),
      /capacity cannot be lower than current occupancy/,
    );
    assert.throws(
      () => db.exec("INSERT INTO ROOM_MEMBER(user_id, room_id, status) VALUES (1, 1, 'left')"),
      /room owner is not stored as a room member/,
    );
    assert.throws(
      () => db.exec('INSERT INTO MATCHES(initiator_user_id, completer_user_id, room_id) VALUES (1, 1, 1)'),
      /cannot create a self-match/,
    );

    const fullRoom = db.prepare(`
      SELECT status, capacity,
        1 + (SELECT COUNT(*) FROM ROOM_MEMBER WHERE room_id = ROOM.room_id AND status = 'approved') AS occupancy
      FROM ROOM WHERE room_id = 2
    `).get();
    assert.deepEqual({ ...fullRoom }, { status: 'full', capacity: 2, occupancy: 2 });
  } finally {
    db.close();
  }
});
