import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startRoomMatchServer } from '../server/app.js';
import { openDatabase } from './support/postgres.mjs';

let db, app, base, token;
const account = { firstName: 'Profile', lastName: 'Validation', phone: '0890000000', email: 'profile-validation@example.test', password: 'profile-test-password' };
before(async () => {
  db = await openDatabase({ filename: ':memory:', seed: false });
  app = await startRoomMatchServer({ db, host: '127.0.0.1', port: 0 });
  base = `http://127.0.0.1:${app.server.address().port}/api`;
  const result = await request('/auth/register', account);
  assert.equal(result.status, 201);
  token = result.body.token;
});
after(async () => {
  if (app) await new Promise(resolve => app.server.close(resolve));
  if (db) await db.close();
});
async function request(path, body, method = 'POST') {
  const response = await fetch(`${base}${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}

test('profile API rejects non-ten-digit phones without changing any profile fields', async () => {
  const original = (await request('/profile', undefined, 'GET')).body;
  for (const phone of ['', '1', '081234567', '08123456789', 'abcdefghij', '081-234567', '๐๘๑๒๓๔๕๖๗๘', null, 812345678, {}]) {
    const rejected = await request('/profile', { phone, firstName: 'Must not save', lifestyleName: 'Must not save' }, 'PATCH');
    assert.equal(rejected.status, 400, JSON.stringify(phone));
    assert.ok(rejected.body.error);
    assert.deepEqual((await request('/profile', undefined, 'GET')).body, original);
  }
  const saved = await request('/profile', { phone: ' 0812345678 ' }, 'PATCH');
  assert.equal(saved.status, 200);
  assert.equal(saved.body.user.phone, '0812345678');
  assert.equal((await request('/profile', undefined, 'GET')).body.user.phone, '0812345678');
});

test('registration enforces the same phone rule and does not create invalid accounts', async () => {
  for (const phone of ['1', '081234567', '08123456789', 'abcdefghij']) {
    const result = await request('/auth/register', { ...account, email: 'invalid-phone@example.test', phone });
    assert.equal(result.status, 400, phone);
  }
  assert.equal((await db.prepare('SELECT count(*) AS count FROM USER').get()).count, 1);
});
