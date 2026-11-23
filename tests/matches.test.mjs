import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startRoomMatchServer } from '../server/app.js';
import { createToken } from '../server/auth.js';
import { calculateAge } from '../shared/age.js';
import { openDatabase } from './support/postgres.mjs';

let db, application, baseUrl;

async function start() {
  application = await startRoomMatchServer({ db, host: '127.0.0.1', port: 0, logger: { error() {} } });
  baseUrl = `http://127.0.0.1:${application.server.address().port}/api`;
}

beforeEach(async () => {
  db = await openDatabase({ filename: ':memory:', seed: false });
  const insert = db.prepare(`INSERT INTO USER
    (user_id, first_name, last_name, email, password_hash, phone, line_id, instagram, date_of_birth, bio)
    VALUES (?, ?, 'Match test', ?, 'unused-test-hash', '0890000000', ?, ?, '2000-01-01', 'คำแนะนำตัว')`);
  for (let id = 1; id <= 6; id += 1) {
    await insert.run(id, `Student ${id}`, `match-${id}@example.test`, `line-${id}`, `instagram-${id}`);
  }
  await start();
});

afterEach(async () => {
  if (application) await new Promise(resolve => application.server.close(resolve));
  await db?.close();
});

async function api(path, userId, method = 'GET', payload) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(userId ? { Authorization: `Bearer ${createToken(userId)}` } : {}),
      ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  return { status: response.status, body: await response.json() };
}

async function room(ownerId = 1, capacity = 3) {
  const result = await api('/rooms', ownerId, 'POST', {
    title: 'ห้องทดสอบสมาชิก', description: 'ห้องที่ใช้ตรวจสมาชิกและแมตช์',
    priceBasis: 'per_room', locality: 'Test locality', googleMapsUrl: 'https://maps.google.com/?q=KMUTT', price: 5000, capacity, ownerIsResident: true, images: ['https://example.test/room.jpg'],
  });
  assert.equal(result.status, 201);
  return result.body.room.roomId;
}

async function request(roomId, userId) {
  const result = await api(`/rooms/${roomId}/requests`, userId, 'POST');
  assert.equal(result.status, 201);
  return result.body.request.requestId;
}

async function approve(roomId, userId = 2, ownerId = 1) {
  const requestId = await request(roomId, userId);
  const result = await api(`/requests/${requestId}`, ownerId, 'PATCH', { status: 'approved' });
  assert.equal(result.status, 200);
  return result.body.match;
}

async function snapshot() {
  return Object.fromEntries(await Promise.all(['ROOM', 'ROOM_REQUEST', 'ROOM_MEMBER', 'MATCHES', 'USER'].map(async table => [
    table, await db.prepare(`SELECT * FROM ${table} ORDER BY 1, 2`).all(),
  ])));
}

test('members and matches require authentication; invalid room IDs are rejected', async () => {
  const roomId = await room();
  assert.equal((await api('/matches')).status, 401);
  assert.equal((await api(`/rooms/${roomId}/members`)).status, 401);
  for (const id of ['0', '9007199254740993', '999999999999999999999999999999']) {
    assert.equal((await api(`/rooms/${id}/members`, 1)).status, 400, id);
  }
  assert.equal((await api('/rooms/999999/members', 1)).status, 404);
});

test('an empty match list and an owner-only room have correct response shapes', async () => {
  const roomId = await room();
  for (const userId of [1, 2, 3]) {
    assert.deepEqual(await api('/matches', userId), { status: 200, body: { matches: [] } });
  }
  const result = await api(`/rooms/${roomId}/members`, 1);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.members.map(member => [member.userId, member.status]), [[1, 'owner']]);
});

test('pending/rejected applicants and unrelated users cannot read the member list', async () => {
  const roomId = await room();
  const pending = await request(roomId, 2);
  const rejected = await request(roomId, 3);
  assert.equal((await api(`/requests/${rejected}`, 1, 'PATCH', { status: 'rejected' })).status, 200);
  for (const userId of [2, 3, 4]) {
    assert.equal((await api(`/rooms/${roomId}/members`, userId)).status, 403);
    assert.deepEqual((await api('/matches', userId)).body.matches, []);
  }
  assert.equal((await db.prepare('SELECT status FROM ROOM_REQUEST WHERE request_id = ?').get(pending)).status, 'pending');
});

test('public room details cannot bypass member-list authorization', async () => {
  const roomId = await room();
  await approve(roomId);
  await request(roomId, 3);
  for (const userId of [null, 3, 4]) {
    const details = await api(`/rooms/${roomId}`, userId);
    assert.equal(details.status, 200);
    assert.deepEqual(details.body.room.members, [], `viewer ${userId}`);
    assert.equal('ownerResidentProfile' in details.body.room, false);
    assert.equal(details.body.room.memberCount, 1);
    assert.equal(details.body.room.availableSlots, 1);
    assert.equal(details.body.room.owner.userId, 1);
  }
  for (const userId of [1, 2]) {
    const details = await api(`/rooms/${roomId}`, userId);
    assert.deepEqual(details.body.room.members.map(member => member.userId), [2]);
    assert.equal('lineId' in details.body.room.members[0], false);
  }
});

test('room details disclose only opted-in current residents to signed-in applicants', async () => {
  const roomId = await room(1, 3);
  const path = `/rooms/${roomId}`;
  const consent = (id, value) => api('/profile', id, 'PATCH', { shareResidentProfile: value });
  const details = async viewer => (await api(path, viewer)).body.room;
  assert.equal((await api('/profile', 2)).body.user.shareResidentProfile, false);
  assert.equal((await consent(null, true)).status, 401);
  for (const invalid of ['true', null, 1]) assert.equal((await consent(2, invalid)).status, 400);
  await approve(roomId, 2);
  await request(roomId, 3);
  const hidden = await details(4);
  assert.equal(hidden.occupantCount, 2);
  assert.equal(hidden.availableSlots, 1);
  assert.deepEqual(hidden.sharedResidentProfiles, []);
  assert.deepEqual(hidden.members, []);
  assert.equal('ownerResidentProfile' in hidden, false);
  assert.equal(JSON.stringify(hidden).includes('Student 2'), false);

  assert.equal((await api('/profile', 2, 'PATCH', { userId: 3, shareResidentProfile: true, lifestyleName: 'Quiet' })).body.user.shareResidentProfile, true);
  assert.equal((await api('/profile', 3)).body.user.shareResidentProfile, false);
  assert.equal((await consent(1, true)).status, 200);
  assert.equal((await consent(3, true)).status, 200);
  const shown = await details(4);
  assert.deepEqual(shown.sharedResidentProfiles.map(profile => [profile.userId, profile.isListingOwner]), [[1, true], [2, false]]);
  for (const profile of shown.sharedResidentProfiles) {
    assert.deepEqual(Object.keys(profile).sort(), ['bio', 'firstName', 'isListingOwner', 'lastName', 'lifestyle', 'profileImage', 'userId']);
  }
  assert.equal(shown.sharedResidentProfiles[1].lifestyle, 'Quiet');
  assert.equal('sharedResidentProfiles' in await details(null), false);
  assert.equal((await api(`${path}/members`, null)).status, 401);
  assert.equal((await api(`${path}/members`, 4)).status, 403);

  await approve(roomId, 5);
  assert.equal((await details(4)).status, 'full');
  assert.equal((await details(4)).availableSlots, 0);
  assert.equal((await consent(2, false)).status, 200);
  assert.deepEqual((await details(4)).sharedResidentProfiles.map(person => person.userId), [1]);
  for (const viewer of [1, 2]) {
    const privileged = await details(viewer);
    assert.equal('sharedResidentProfiles' in privileged, false);
    assert.equal(privileged.ownerResidentProfile.userId, 1);
    assert.deepEqual(privileged.members.map(member => member.profile.userId), [2, 5]);
  }
  await consent(2, true);
  assert.equal((await api(`${path}/members/me`, 2, 'DELETE')).status, 200);
  assert.equal((await details(4)).occupantCount, 2);
  assert.deepEqual((await details(4)).sharedResidentProfiles.map(person => person.userId), [1]);
  assert.equal((await api(path, 1, 'PATCH', { ownerIsResident: false })).status, 200);
  const nonresidentOwner = await details(4);
  assert.equal(nonresidentOwner.occupantCount, 1);
  assert.deepEqual(nonresidentOwner.sharedResidentProfiles, []);
  assert.equal((await api(`${path}/members/me`, 5, 'DELETE')).status, 200);
  assert.equal((await details(4)).occupantCount, 0);
});

test('room details attach resident profiles only to the room owner and approved viewers', async () => {
  const roomId = await room();
  await approve(roomId);
  await db.prepare("UPDATE USER SET gender = 'female', university = 'Resident University' WHERE user_id = 2").run();
  await db.prepare("INSERT INTO LIFESTYLE(user_id,lifestyle_name) VALUES (2,'Quiet')").run();
  await db.prepare("INSERT INTO PREFERENCE(user_id,preferred_gender,preferred_age_min,budget_max) VALUES (2,'any',20,5000)").run();
  for (const viewer of [1, 2]) {
    const { body } = await api(`/rooms/${roomId}`, viewer);
    assert.equal(body.room.ownerResidentProfile.userId, 1);
    assert.equal(body.room.ownerResidentProfile.gender, null);
    assert.deepEqual(body.room.members[0].profile, {
      userId: 2, firstName: 'Student 2', lastName: 'Match test', profileImage: null,
      gender: 'female', age: calculateAge('2000-01-01'), university: 'Resident University',
      bio: 'คำแนะนำตัว', lifestyle: 'Quiet', preferredGender: 'any', preferredAgeMin: 20,
      preferredAgeMax: null, budgetMin: null, budgetMax: 5000,
    });
    for (const field of ['dateOfBirth', 'date_of_birth', 'lineId', 'instagram', 'email', 'phone']) {
      assert.equal(field in body.room.ownerResidentProfile, false);
    }
  }
  await db.prepare('UPDATE ROOM SET owner_is_resident = FALSE WHERE room_id = ?').run(roomId);
  const { body } = await api(`/rooms/${roomId}`, 1);
  assert.equal('ownerResidentProfile' in body.room, false);
  assert.equal(body.room.members[0].profile.userId, 2);
});

test('owner and approved members see the owner exactly once, with safe fields and stable ordering', async () => {
  const roomId = await room();
  await approve(roomId, 2);
  await approve(roomId, 3);
  // Legacy SQL timestamps sort before ISO timestamps unless normalized; owner must stay first.
  await db.prepare('UPDATE ROOM SET created_at = ? WHERE room_id = ?').run('2026-01-01T00:00:00.000Z', roomId);
  await db.prepare('UPDATE ROOM_MEMBER SET joined_at = ? WHERE room_id = ?').run('2026-01-01 00:00:00', roomId);
  const initial = await snapshot();
  for (const userId of [1, 2, 3]) {
    const result = await api(`/rooms/${roomId}/members`, userId);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.members.map(member => [member.userId, member.status]), [[1, 'owner'], [2, 'approved'], [3, 'approved']]);
    for (const member of result.body.members) {
      assert.deepEqual(Object.keys(member).sort(), ['firstName', 'joinedAt', 'lastName', 'profileImage', 'status', 'userId']);
      assert.match(member.joinedAt, /^\d{4}-\d{2}-\d{2}T.*Z$/);
    }
  }
  assert.deepEqual(await snapshot(), initial);
  assert.equal((await db.prepare('SELECT count(*) AS count FROM ROOM_MEMBER WHERE user_id = 1').get()).count, 0);
});

test('match lists are scoped to the authenticated user and return the other participant', async () => {
  const roomId = await room();
  const first = await approve(roomId, 2);
  const second = await approve(roomId, 3);
  const otherRoom = await room(4, 2);
  await approve(otherRoom, 5, 4);
  // Force a timestamp tie to verify match_id DESC provides deterministic order.
  await db.exec("UPDATE MATCHES SET matched_at = '2026-01-01T00:00:00.000Z'");
  const initial = await snapshot();
  db.setReadOnly(true);
  try {
    const ownerMatches = await api('/matches?userId=4', 1);
    assert.equal(ownerMatches.status, 200);
    assert.deepEqual(ownerMatches.body.matches.map(match => match.matchId), [second.matchId, first.matchId]);
    assert.deepEqual(ownerMatches.body.matches.map(match => match.otherUser.userId), [3, 2]);
    const memberMatches = (await api('/matches', 2)).body.matches;
    assert.equal(memberMatches.length, 1);
    assert.equal(memberMatches[0].room.roomId, roomId);
    assert.equal(memberMatches[0].otherUser.userId, 1);
    assert.equal(memberMatches[0].otherUser.lineId, 'line-1');
    assert.equal(memberMatches[0].otherUser.instagram, 'instagram-1');
    assert.deepEqual(Object.keys(memberMatches[0].otherUser).sort(), ['bio', 'firstName', 'instagram', 'lastName', 'lineId', 'profileImage', 'userId']);
    assert.equal((await api(`/rooms/${roomId}/members`, 2)).status, 200);
    assert.deepEqual((await api('/matches', 6)).body.matches, []);
  } finally { db.setReadOnly(false); }
  assert.deepEqual(await snapshot(), initial);
});

test('matched owner and member receive each others phone only when social contacts are absent', async () => {
  await db.exec("UPDATE USER SET line_id=NULL,instagram=NULL,phone='0811111111' WHERE user_id=1");
  await db.exec("UPDATE USER SET line_id='',instagram='',phone='0822222222' WHERE user_id=2");
  const roomId = await room();
  assert.deepEqual((await api('/matches', 2)).body.matches, []);
  const approved = await approve(roomId);
  assert.equal(approved.otherUser.phone, '0822222222');
  const initial = await snapshot();
  db.setReadOnly(true);
  try {
    for (const [viewer, expectedUser, expectedPhone] of [[1, 2, '0822222222'], [2, 1, '0811111111']]) {
      const result = await api('/matches', viewer);
      assert.equal(result.status, 200);
      const other = result.body.matches[0].otherUser;
      assert.equal(other.userId, expectedUser);
      assert.equal(other.phone, expectedPhone);
      for (const field of ['email', 'dateOfBirth', 'passwordHash', 'password_hash']) assert.equal(field in other, false);
    }
  } finally { db.setReadOnly(false); }
  assert.deepEqual(await snapshot(), initial);
});

test('existing LINE or Instagram suppresses phone exposure; whitespace-only contacts count as absent', async () => {
  await approve(await room());
  const update = db.prepare('UPDATE USER SET line_id=?,instagram=?,phone=? WHERE user_id=1');
  for (const [lineId, instagram, expectedPhone] of [
    ['line-1', null, false], [null, 'instagram-1', false], ['line-1', 'instagram-1', false],
    [null, null, true], ['', '', true], ['  ', ' \n ', true],
  ]) {
    await update.run(lineId, instagram, ' 0811111111 ');
    const other = (await api('/matches', 2)).body.matches[0].otherUser;
    assert.equal('phone' in other, expectedPhone);
    if (expectedPhone) assert.equal(other.phone, '0811111111');
    assert.equal(other.lineId, lineId);
    assert.equal(other.instagram, instagram);
  }
});

test('profiles without any contact do not fabricate a fallback phone', async () => {
  await approve(await room());
  for (const phone of [null, '', '   ']) {
    await db.prepare('UPDATE USER SET line_id=NULL,instagram=NULL,phone=? WHERE user_id=1').run(phone);
    const other = (await api('/matches', 2)).body.matches[0].otherUser;
    assert.equal('phone' in other, false);
    assert.equal(other.lineId, null);
    assert.equal(other.instagram, null);
  }
});

test('fallback phones remain private from pending, rejected, unrelated and other-room users', async () => {
  await db.exec("UPDATE USER SET line_id=NULL,instagram=NULL WHERE user_id IN (1,2)");
  const roomId = await room(1, 4);
  await approve(roomId, 2);
  await request(roomId, 3);
  const rejected = await request(roomId, 4);
  await api(`/requests/${rejected}`, 1, 'PATCH', { status: 'rejected' });
  await approve(await room(6, 2), 5, 6);
  assert.equal((await api('/matches')).status, 401);
  for (const viewer of [3, 4, 5]) {
    const matches = (await api('/matches?userId=1', viewer)).body.matches;
    assert.equal(matches.some(match => match.room.roomId === roomId), false);
    assert.equal((await api(`/rooms/${roomId}/members`, viewer)).status, 403);
  }
  for (const viewer of [null, 1, 2, 3, 4, 5]) {
    const detail = (await api(`/rooms/${roomId}`, viewer)).body.room;
    assert.equal('phone' in detail.owner, false);
    for (const member of detail.members) assert.equal('phone' in member, false);
  }
  for (const viewer of [1, 2]) {
    for (const member of (await api(`/rooms/${roomId}/members`, viewer)).body.members) assert.equal('phone' in member, false);
  }
});

test('leaving revokes fallback phone access; reapproval returns current profile data', async () => {
  await db.exec("UPDATE USER SET line_id=NULL,instagram=NULL WHERE user_id IN (1,2)");
  const roomId = await room();
  await approve(roomId, 2);
  assert.equal((await api('/matches', 1)).body.matches[0].otherUser.phone, '0890000000');
  assert.equal((await api(`/rooms/${roomId}/members/me`, 2, 'DELETE')).status, 200);
  assert.deepEqual((await api('/matches', 1)).body.matches, []);
  assert.deepEqual((await api('/matches', 2)).body.matches, []);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM MATCHES').get()).n, 1);
  assert.equal((await api('/profile', 2, 'PATCH', { phone: '0833333333' })).status, 200);
  await approve(roomId, 2);
  assert.equal((await api('/matches', 1)).body.matches[0].otherUser.phone, '0833333333');
});

test('leaving a room revokes member access and hides stale match contacts without deleting history', async () => {
  const roomId = await room();
  await approve(roomId, 2);
  await db.prepare("UPDATE ROOM_MEMBER SET status = 'left' WHERE room_id = ? AND user_id = ?").run(roomId, 2);
  assert.equal((await api(`/rooms/${roomId}/members`, 2)).status, 403);
  assert.deepEqual((await api('/matches', 2)).body.matches, []);
  assert.deepEqual((await api('/matches', 1)).body.matches, []);
  assert.deepEqual((await api(`/rooms/${roomId}`, 2)).body.room.members, []);
  assert.equal((await db.prepare('SELECT count(*) AS count FROM MATCHES').get()).count, 1);
});

test('pausing a listing keeps current members and matches available to participants', async () => {
  const roomId = await room();
  await approve(roomId);
  assert.equal((await api(`/rooms/${roomId}`, 1, 'PATCH', { status: 'inactive' })).status, 200);
  for (const userId of [1, 2]) {
    assert.equal((await api(`/rooms/${roomId}/members`, userId)).status, 200);
    assert.equal((await api('/matches', userId)).body.matches.length, 1);
  }
});

test('deleting a vacated room removes its historical matches and member rows', async () => {
  const roomId = await room();
  await approve(roomId);
  assert.equal((await api(`/rooms/${roomId}/members/me`, 2, 'DELETE')).status, 200);
  assert.equal((await api(`/rooms/${roomId}`, 1, 'PATCH', { ownerIsResident: false })).status, 200);
  assert.equal((await api(`/rooms/${roomId}`, 1, 'DELETE')).status, 200);
  assert.equal((await api(`/rooms/${roomId}/members`, 2)).status, 404);
  assert.deepEqual((await api('/matches', 1)).body.matches, []);
  assert.deepEqual((await api('/matches', 2)).body.matches, []);
  assert.equal((await db.prepare('SELECT count(*) AS count FROM ROOM_MEMBER').get()).count, 0);
  assert.equal((await db.prepare('SELECT count(*) AS count FROM MATCHES').get()).count, 0);
  assert.deepEqual(await db.prepare('SELECT conname FROM pg_constraint WHERE connamespace = current_schema()::regnamespace AND contype = \'f\' AND NOT convalidated').all(), []);
});

test('unavailable database tables return generic errors without SQL or contact details', async () => {
  const roomId = await room();
  await db.exec('UPDATE USER SET line_id=NULL,instagram=NULL WHERE user_id=1');
  await approve(roomId);
  assert.equal((await api('/matches', 2)).body.matches[0].otherUser.phone, '0890000000');
  await db.exec('DROP TABLE MATCHES');
  assert.deepEqual(await api('/matches', 2), { status: 500, body: { error: 'Internal server error' } });
  await db.exec('DROP TABLE ROOM_MEMBER');
  assert.deepEqual(await api(`/rooms/${roomId}/members`, 2), { status: 500, body: { error: 'Internal server error' } });
});

test('inactive accounts cannot access members or match contacts', async () => {
  const roomId = await room();
  await approve(roomId);
  await db.prepare('UPDATE USER SET is_active = 0 WHERE user_id = ?').run(2);
  assert.equal((await api('/matches', 2)).status, 401);
  assert.equal((await api(`/rooms/${roomId}/members`, 2)).status, 401);
});

test('member and match reads survive a database restart without modifying persisted records', async () => {
  const roomId = await room();
  await db.exec('UPDATE USER SET line_id=NULL,instagram=NULL WHERE user_id=1');
  await approve(roomId);
  const filename = join(mkdtempSync(join(tmpdir(), 'roommatch-matches-')), 'matches.sqlite');
  const schema = db.schema;
  const initial = await snapshot();
  await new Promise(resolve => application.server.close(resolve));
  await db.close();
  db = await openDatabase({ filename, schema, seed: false });
  await start();
  assert.equal((await api(`/rooms/${roomId}/members`, 2)).body.members.length, 2);
  assert.equal((await api('/matches', 2)).body.matches.length, 1);
  assert.equal((await api('/matches', 2)).body.matches[0].otherUser.phone, '0890000000');
  assert.deepEqual(await snapshot(), initial);
  assert.deepEqual(await db.prepare('SELECT conname FROM pg_constraint WHERE connamespace = current_schema()::regnamespace AND contype = \'f\' AND NOT convalidated').all(), []);
});
