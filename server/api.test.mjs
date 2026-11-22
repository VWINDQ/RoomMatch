import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startRoomMatchServer } from './app.js';
import { openDatabase } from '../tests/support/postgres.mjs';

const database = await openDatabase({ filename: ':memory:' });
const staticDirectory = await mkdtemp(join(tmpdir(), 'roommatch-api-static-'));
const fixtureHtml = '<!doctype html><title>RoomMatch API routing fixture</title><main id="root"></main>';
await writeFile(join(staticDirectory, 'index.html'), fixtureHtml);
let application;
let baseUrl;

before(async () => {
  application = await startRoomMatchServer({
    db: database,
    host: '127.0.0.1',
    port: 0,
    logger: { error: () => {} },
    staticDirectory,
  });
  const address = application.server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise((resolve) => application.server.close(resolve));
  await database.close();
  await rm(staticDirectory, { recursive: true, force: true });
});

async function api(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  return { response, body: await response.json() };
}

test('register, authenticate, and update one-to-one profile data', async () => {
  const registration = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      firstName: 'New',
      lastName: 'Student',
      phone: '0800000000',
      accountType: 'general', dateOfBirth: '2000-02-29',
      email: 'new.student@example.test',
      password: 'safe-password',
    }),
  });
  assert.equal(registration.response.status, 201);
  assert.ok(registration.body.token);
  const account = await database.prepare('SELECT password_hash FROM USER WHERE lower(email)=?').get('new.student@example.test');
  assert.match(account.password_hash, /^\$argon2id\$v=19\$/);

  const headers = { Authorization: `Bearer ${registration.body.token}` };
  const lifestyle = await api('/api/lifestyle', {
    method: 'PUT',
    headers,
    body: JSON.stringify({ lifestyleName: 'ตื่นเช้า • ไม่สูบบุหรี่' }),
  });
  assert.equal(lifestyle.response.status, 200);

  const preference = await api('/api/preference', {
    method: 'PUT',
    headers,
    body: JSON.stringify({ preferredGender: 'any', preferredAgeMin: 18, preferredAgeMax: 26, budgetMin: 4000, budgetMax: 7000 }),
  });
  assert.equal(preference.response.status, 200);

  const profile = await api('/api/profile', { headers });
  assert.equal(profile.response.status, 200);
  assert.equal(profile.body.lifestyle.lifestyleName, 'ตื่นเช้า • ไม่สูบบุหรี่');
  assert.equal(profile.body.preference.budgetMax, 7000);
  await database.prepare("UPDATE PREFERENCE SET preferred_gender = 'non_binary' WHERE user_id = ?").run(profile.body.user.userId);
  const saveGender = (path, method, preference) => api(path, {
    method, headers, body: JSON.stringify(method === 'PATCH' ? { bio: 'Preference regression', preference } : preference),
  });
  assert.equal((await saveGender('/api/profile', 'PATCH', { preferredGender: 'non_binary' })).body.preference.preferredGender, 'non_binary');
  assert.equal((await saveGender('/api/profile', 'PATCH', { budgetMax: 7000 })).body.preference.preferredGender, 'non_binary');
  assert.equal((await saveGender('/api/profile', 'PATCH', { preferredGender: 'other' })).response.status, 400);
  for (const preferredGender of ['male', 'female', 'any']) {
    const result = await saveGender('/api/preference', 'PUT', { preferredGender, budgetMax: 7000 });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.preference.preferredGender, preferredGender);
  }
  assert.equal((await saveGender('/api/preference', 'PUT', { preferredGender: 'non_binary' })).response.status, 400);

  const invalidBirthDate = await api('/api/profile', {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ dateOfBirth: '2025-02-29' }),
  });
  assert.equal(invalidBirthDate.response.status, 400);

  const updatedProfile = await api('/api/profile', {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ bio: 'Updated profile' }),
  });
  assert.equal(updatedProfile.response.status, 200);
  assert.equal(updatedProfile.body.lifestyle.lifestyleName, 'ตื่นเช้า • ไม่สูบบุหรี่');
  assert.equal(updatedProfile.body.preference.budgetMax, 7000);

  const bundled = { firstName: 'Atomic', lifestyleName: 'เงียบ', preference: { budgetMin: 0, budgetMax: 5000 } };
  const invalidBundle = await api('/api/profile', { method: 'PATCH', headers, body: JSON.stringify({ ...bundled, preference: { budgetMin: 6000, budgetMax: 5000 } }) });
  assert.equal(invalidBundle.response.status, 400);
  assert.equal((await database.prepare('SELECT first_name FROM USER WHERE email = ?').get('new.student@example.test')).first_name, 'New');
  // Force a database failure after USER was updated, not merely a rejected request.
  await database.exec(`CREATE FUNCTION audit_preference_failure_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit failure'; END $$; CREATE TRIGGER audit_preference_failure BEFORE UPDATE ON PREFERENCE FOR EACH ROW EXECUTE FUNCTION audit_preference_failure_fn();`);
  try {
    const failed = await api('/api/profile', { method: 'PATCH', headers, body: JSON.stringify(bundled) });
    assert.equal(failed.response.status, 500);
    const unchanged = await api('/api/profile', { headers });
    assert.equal(unchanged.body.user.firstName, 'New');
    assert.equal(unchanged.body.lifestyle.lifestyleName, 'ตื่นเช้า • ไม่สูบบุหรี่');
    assert.equal(unchanged.body.preference.budgetMax, 7000);
  } finally { await database.exec('DROP TRIGGER audit_preference_failure ON PREFERENCE; DROP FUNCTION audit_preference_failure_fn()'); }
  const saved = await api('/api/profile', { method: 'PATCH', headers, body: JSON.stringify(bundled) });
  assert.equal(saved.response.status, 200);
  assert.equal(saved.body.user.firstName, 'Atomic');
  assert.equal(saved.body.preference.budgetMin, 0);
  const reread = await api('/api/profile', { headers });
  assert.deepEqual(reread.body, saved.body);
});

test('room request approval atomically creates membership and match', async () => {
  const login = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'phoom.s@mail.kmutt.ac.th', password: 'roommatch' }),
  });
  assert.equal(login.response.status, 200);
  const headers = { Authorization: `Bearer ${login.body.token}` };

  const approval = await api('/api/requests/2', {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ status: 'approved' }),
  });
  assert.equal(approval.response.status, 200);
  assert.equal(approval.body.request.status, 'approved');
  assert.equal(approval.body.match.otherUser.userId, 3);

  const room = await api('/api/rooms/1', { headers });
  assert.equal(room.response.status, 200);
  assert.equal(room.body.room.status, 'full');
  assert.equal(room.body.room.availableSlots, 0);

  const members = await api('/api/rooms/1/members', { headers });
  assert.equal(members.response.status, 200);
  assert.deepEqual(members.body.members.map((member) => member.userId).sort(), [1, 2, 3]);

  const duplicateDecision = await api('/api/requests/2', {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ status: 'approved' }),
  });
  assert.equal(duplicateDecision.response.status, 409);
});

test('room writes enforce ownership and title convention', async () => {
  const login = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'phoom.s@mail.kmutt.ac.th', password: 'roommatch' }),
  });
  const headers = { Authorization: `Bearer ${login.body.token}` };
  const created = await api('/api/rooms', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      title: 'Test room',
      description: 'Persisted in the description body.',
      priceBasis: 'per_room', locality: 'Test locality', googleMapsUrl: 'https://maps.google.com/?q=13.7,100.5',
      price: 5000,
      capacity: 2,
      images: ['https://images.example.test/room.jpg'],
    }),
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.room.title, 'Test room');
  assert.equal(created.body.room.availableSlots, 2);
  assert.equal(created.body.room.ownerIsResident, false);

  const anonymousDelete = await api(`/api/rooms/${created.body.room.roomId}`, { method: 'DELETE' });
  assert.equal(anonymousDelete.response.status, 401);

  const nonOwnerLogin = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'new.student@example.test', password: 'safe-password' }),
  });
  const nonOwnerDelete = await api(`/api/rooms/${created.body.room.roomId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${nonOwnerLogin.body.token}` },
  });
  assert.equal(nonOwnerDelete.response.status, 403);

  const ownerDelete = await api(`/api/rooms/${created.body.room.roomId}`, {
    method: 'DELETE', headers,
  });
  assert.equal(ownerDelete.response.status, 200);
  assert.equal(ownerDelete.body.success, true);
  const deletedRoom = await api(`/api/rooms/${created.body.room.roomId}`, { headers });
  assert.equal(deletedRoom.response.status, 404);
  assert.equal((await database.prepare('SELECT COUNT(*) AS count FROM ROOM_IMAGE WHERE room_id = ?').get(created.body.room.roomId)).count, 0);
});

test('serves SPA routes without a prior build and without masking unknown API routes or missing assets', async () => {
  const pageResponse = await fetch(`${baseUrl}/rooms/1`);
  assert.equal(pageResponse.status, 200);
  assert.match(pageResponse.headers.get('content-type'), /^text\/html/);
  assert.equal(await pageResponse.text(), fixtureHtml);
  assert.equal(pageResponse.headers.get('cache-control'), 'no-cache');

  const headResponse = await fetch(`${baseUrl}/profile`, { method: 'HEAD' });
  assert.equal(headResponse.status, 200);
  assert.equal(await headResponse.text(), '');
  assert.equal((await fetch(`${baseUrl}/assets/missing.js`)).status, 404);

  const missingApi = await api('/api/not-a-route');
  assert.equal(missingApi.response.status, 404);
  assert.equal(missingApi.body.error, 'Endpoint not found');
});
