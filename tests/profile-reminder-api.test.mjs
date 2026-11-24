import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createToken } from '../server/auth.js';
import { startRoomMatchServer } from '../server/app.js';
import { runMigrations } from '../server/database.js';
import { openDatabase } from './support/postgres.mjs';

async function fixture(t) {
  const db = await openDatabase({ filename: ':memory:' });
  const app = await startRoomMatchServer({ db, port: 0, logger: { error() {} } });
  t.after(async () => { await new Promise(resolve => app.server.close(resolve)); await db.close(); });
  const api = async (path, userId = 1, method = 'GET', body) => {
    const response = await fetch(`http://127.0.0.1:${app.server.address().port}/api${path}`, { method,
      headers: { ...(userId ? { Authorization: `Bearer ${createToken(userId)}` } : {}), 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json() };
  };
  return { db, api };
}

test('profile reminder is acknowledged only for the authenticated account, idempotently across sessions', async t => {
  const { db, api } = await fixture(t);
  const login = () => api('/auth/login', null, 'POST', { email: 'phoom.s@mail.kmutt.ac.th', password: 'roommatch' });
  assert.equal((await login()).body.user.profileReminderSeen, false);
  assert.equal((await api('/profile')).body.user.profileReminderSeen, false);
  assert.equal((await api('/profile/reminder/acknowledge', null, 'POST')).status, 401);
  assert.equal((await api('/profile/reminder/acknowledge', 999999, 'POST')).status, 401);
  const results = await Promise.all([
    api('/profile/reminder/acknowledge', 1, 'POST', { userId: 2 }),
    api('/profile/reminder/acknowledge', 1, 'POST'),
  ]);
  assert.ok(results.every(result => result.status === 200 && result.body.acknowledged === true));
  const seenAt = (await db.prepare('SELECT profile_reminder_seen_at FROM USER WHERE user_id=1').get()).profile_reminder_seen_at;
  assert.ok(seenAt);
  assert.equal((await api('/auth/me')).body.user.profileReminderSeen, true);
  assert.equal((await api('/auth/me', 2)).body.user.profileReminderSeen, false);
  assert.equal((await login()).body.user.profileReminderSeen, true);
  assert.equal((await api('/profile', 1, 'PATCH', { bio: 'Updated after reminder' })).body.user.profileReminderSeen, true);
  assert.equal((await api('/profile/reminder/acknowledge', 1, 'POST')).status, 200);
  assert.deepEqual((await db.prepare('SELECT profile_reminder_seen_at FROM USER WHERE user_id=1').get()).profile_reminder_seen_at, seenAt);
  const registered = await api('/auth/register', null, 'POST', { firstName: 'New', lastName: 'Reminder', phone: '0801234567',
    email: 'new-reminder@example.test', password: 'test-password', dateOfBirth: '2000-01-01', accountType: 'general' });
  assert.equal(registered.status, 201); assert.equal(registered.body.user.profileReminderSeen, false);
  assert.equal((await api('/rooms/1')).body.room.owner.profileReminderSeen, undefined);
});

test('failed reminder acknowledgement preserves the unseen state and can be retried', async t => {
  const { db, api } = await fixture(t);
  db.setReadOnly(true);
  assert.equal((await api('/profile/reminder/acknowledge', 1, 'POST')).status, 500);
  db.setReadOnly(false);
  assert.equal((await api('/auth/me')).body.user.profileReminderSeen, false);
  assert.equal((await api('/profile/reminder/acknowledge', 1, 'POST')).status, 200);
  assert.equal((await api('/auth/me')).body.user.profileReminderSeen, true);
});

test('profile reminder migration preserves existing account data and acknowledgements on rerun', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'roommatch-before-reminder-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const source = new URL('../database/postgresql/migrations/', import.meta.url);
  for (const name of readdirSync(source).filter(name => name < '006')) copyFileSync(new URL(name, source), join(directory, name));
  const db = await openDatabase({ filename: ':memory:', migrationsDirectory: directory });
  t.after(() => db.close());
  const before = await db.prepare('SELECT * FROM USER ORDER BY user_id').all();
  await runMigrations(db);
  const after = await db.prepare('SELECT * FROM USER ORDER BY user_id').all();
  assert.deepEqual(after.map(({ profile_reminder_seen_at, share_resident_profile, ...row }) => row), before);
  assert.ok(after.every(row => row.profile_reminder_seen_at === null && row.share_resident_profile === false));
  await db.exec('UPDATE USER SET profile_reminder_seen_at=CURRENT_TIMESTAMP WHERE user_id=1');
  const acknowledged = await db.prepare('SELECT * FROM USER ORDER BY user_id').all();
  await runMigrations(db);
  assert.deepEqual(await db.prepare('SELECT * FROM USER ORDER BY user_id').all(), acknowledged);
});
