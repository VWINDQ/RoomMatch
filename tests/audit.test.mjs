import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { startRoomMatchServer } from '../server/app.js';
import { openDatabase } from '../server/database.js';

test('empty database, invalid inputs, database failures, and durable profile persistence', async () => {
  const filename = join(mkdtempSync(join(tmpdir(), 'roommatch-regression-')), 'audit.sqlite');
  let db = openDatabase({ filename, seed: false });
  const app = await startRoomMatchServer({ db, port: 0, logger: { error() {} } });
  const url = `http://127.0.0.1:${app.server.address().port}/api`;
  let token;
  const api = async (path, method = 'GET', body) => {
    const result = await fetch(`${url}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: result.status, body: await result.json() };
  };
  const registration = { firstName: 'Audit', lastName: 'Student', phone: '0890000000', email: 'audit@regression.test', password: 'local-test-password' };
  try {
    for (const invalid of [{ ...registration, email: 'bad' }, { ...registration, password: 'short' }, { ...registration, firstName: '' }, { ...registration, dateOfBirth: '2099-01-01' }]) {
      assert.equal((await api('/auth/register', 'POST', invalid)).status, 400);
      assert.equal(db.prepare('SELECT count(*) AS count FROM USER').get().count, 0);
    }
    db.exec('PRAGMA query_only = ON');
    assert.equal((await api('/auth/register', 'POST', registration)).status, 500);
    db.exec('PRAGMA query_only = OFF');
    const registered = await api('/auth/register', 'POST', registration);
    assert.equal(registered.status, 201);
    token = registered.body.token;
    assert.equal((await api('/auth/register', 'POST', registration)).status, 409);
    assert.equal((await api('/auth/login', 'POST', { email: registration.email, password: 'wrong' })).status, 401);
    assert.equal((await api('/auth/login', 'POST', { email: registration.email, password: registration.password })).status, 200);
    for (const [path, property] of [['/rooms', 'rooms'], ['/friends', 'people'], ['/friends/connections', 'connections'], ['/matches', 'matches'], ['/requests/mine', 'requests'], ['/owner/requests', 'requests']]) {
      const result = await api(path);
      assert.equal(result.status, 200, path);
      assert.deepEqual(result.body[property], [], path);
    }
    const original = await api('/profile');
    assert.equal(original.body.lifestyle, null);
    assert.equal(original.body.preference, null);
    for (const invalid of [{ profileImage: 'javascript:alert(1)' }, { profileImage: 'http://' }, { dateOfBirth: '2026-02-30' }, { firstName: '' }, { firstName: 'Changed', preference: { budgetMin: 50, budgetMax: 0 } }]) {
      assert.equal((await api('/profile', 'PATCH', invalid)).status, 400);
      assert.deepEqual((await api('/profile')).body, original.body);
    }
    assert.equal((await api('/friends/connections', 'POST', { recipientId: 1 })).status, 400);
    assert.equal((await api('/friends/connections', 'POST', { recipientId: 9999 })).status, 404);
    const saved = await api('/profile', 'PATCH', { firstName: 'Durable', lifestyleName: 'เงียบ', preference: { budgetMin: 0, budgetMax: 6000 } });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.preference.budgetMin, 0);
    db.exec('PRAGMA query_only = ON');
    const failed = await api('/profile', 'PATCH', { firstName: 'Must not persist' });
    assert.equal(failed.status, 500);
    assert.deepEqual(Object.keys(failed.body), ['error']);
    assert.equal(failed.body.error, 'Internal server error');
    db.exec('PRAGMA query_only = OFF');
    assert.deepEqual((await api('/profile')).body, saved.body);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    await new Promise(resolve => app.server.close(resolve));
    db.close();
  }
  db = openDatabase({ filename, seed: false });
  try {
    assert.equal(db.prepare('SELECT first_name FROM USER').get().first_name, 'Durable');
    assert.equal(db.prepare('SELECT lifestyle_name FROM LIFESTYLE').get().lifestyle_name, 'เงียบ');
    assert.equal(db.prepare('SELECT budget_min FROM PREFERENCE').get().budget_min, 0);
    assert.equal(db.prepare('SELECT count(*) AS count FROM USER').get().count, 1);
  } finally { db.close(); }
});
