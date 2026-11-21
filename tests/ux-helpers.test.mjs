import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { transformWithOxc } from 'vite';
import { friendlyApiError } from '../src/lib/apiErrors.ts';
import { listingReturn, roomReturn } from '../src/lib/roomNavigation.ts';

test('form errors explain authentication and failed saves in Thai without leaking internal errors', () => {
  assert.equal(friendlyApiError('Invalid email or password', 401), 'อีเมลหรือรหัสผ่านไม่ถูกต้อง');
  assert.match(friendlyApiError('password must be at least 8 characters', 400), /8/);
  assert.match(friendlyApiError('locality is too long', 400), /ทำเล.*ยาวเกิน/);
  assert.match(friendlyApiError('SQLITE_ERROR: no such table USER', 500), /กรุณาลองอีกครั้ง/);
  assert.doesNotMatch(friendlyApiError('SQLITE_ERROR: no such table USER', 500), /SQLITE|USER/);
  assert.equal(friendlyApiError('กรุณาตรวจสอบไฟล์รูปภาพ', 400), 'กรุณาตรวจสอบไฟล์รูปภาพ');
});

test('room return preserves list context and filters while rejecting arbitrary destinations', () => {
  for (const from of ['/rooms?q=บางมด&minSlots=2', '/requests?view=sent', '/matches', '/my-listings', '/favorites']) {
    assert.equal(roomReturn({ from, focusReturnId: 'room-card-1' }).to, from);
    assert.equal(roomReturn({ from, focusReturnId: 'room-card-1' }).focusTarget, 'room-card-1');
  }
  for (const state of [null, {}, { from: '//evil.example' }, { from: 'https://evil.example' }, { from: '/rooms/1' }, { from: '/rooms-unrelated' }]) assert.equal(roomReturn(state).to, '/rooms');
});

test('edit return preserves personal-list page and filters and rejects unsafe destinations', () => {
  for (const from of ['/my-listings?page=3&status=inactive&sort=price_asc', '/favorites?q=test&page=2', '/rooms?page=5']) {
    const back = listingReturn({ from, focusReturnId: 'listing-12' });
    assert.equal(back.to, from);
    assert.equal(back.focusTarget, 'listing-12');
  }
  for (const state of [null, {}, { from: '//example.com' }, { from: '/my-listings/12/edit' }, { from: '/favorites-unrelated' }]) {
    assert.equal(listingReturn(state).to, '/my-listings');
  }
});

test('room request conflicts explain the actual state rather than using one generic availability message', () => {
  const cases = [
    ['A pending request already exists', /ส่งคำขอ.*ไว้แล้ว/],
    ['You are already a member of this room', /เป็นสมาชิก.*แล้ว/],
    ['This room has no available place', /ห้องเต็ม/],
    ['This room has reached capacity', /ห้องเต็ม/],
    ['Inactive rooms cannot accept requests', /พักรับคำขอ/],
    ['You cannot request to join your own room', /ห้องตัวเองไม่ได้/],
    ['This request has already been handled', /ถูกจัดการแล้ว/],
    ['Only a pending request can be withdrawn', /เฉพาะ.*รอเจ้าของ/],
    ['The requester is already a room member', /ผู้ขอเป็นสมาชิก/],
  ];
  for (const [message, expected] of cases) assert.match(friendlyApiError(message, 409), expected, message);
  assert.doesNotMatch(friendlyApiError('Inactive rooms cannot accept requests', 409), /เต็ม/);
  assert.doesNotMatch(friendlyApiError('A pending request already exists', 409), /เต็ม|ที่ว่าง/);
  assert.doesNotMatch(friendlyApiError('A future connection conflict', 409), /ห้อง|ที่ว่าง/);
});

test('request permissions and profile errors state the required role without exposing internal details', () => {
  for (const message of ['Only the room owner can respond to this request', 'Only the room owner can view the requester profile']) {
    assert.match(friendlyApiError(message, 403), /เจ้าของห้อง/);
  }
  assert.match(friendlyApiError('Only the requester can withdraw this request', 403), /ผู้ส่งคำขอ/);
  assert.match(friendlyApiError('Only the room owner or a member can view members', 403), /สมาชิกปัจจุบัน/);
  assert.match(friendlyApiError('Requester profile is unavailable', 404), /ไม่พบโปรไฟล์ผู้ขอ/);
  for (const status of [500, 503]) {
    assert.doesNotMatch(friendlyApiError('SQLITE_ERROR: no such table ROOM_REQUEST', status), /SQLITE|ROOM_REQUEST/);
  }
});

test('friend decision and cancellation errors retain their specific Thai guidance', () => {
  for (const message of [
    'เฉพาะผู้รับคำชวนเท่านั้นที่ตอบรับได้',
    'เฉพาะผู้ส่งเท่านั้นที่ถอนคำชวนได้',
    'คำชวนนี้ได้รับการตอบกลับแล้ว',
    'คำชวนนี้ได้รับการตอบกลับแล้ว ถอนคำชวนไม่ได้ กรุณาอัปเดตคำชวน',
  ]) assert.equal(friendlyApiError(message, 409), message);
});

test('API errors translate raw server messages at construction while keeping status and session notifications', async t => {
  // Exercise the actual adapter, including main's session-expiry path, without a browser or network.
  const source = readFileSync('src/lib/api.ts', 'utf8');
  const compiled = (await transformWithOxc(source, 'src/lib/api.ts')).code
    .replace(/from ['"]\.\/apiErrors['"]/, `from '${pathToFileURL(resolve('src/lib/apiErrors.ts')).href}'`);
  const adapter = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  const values = new Map();
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  } });
  t.after(() => { if (previousStorage) Object.defineProperty(globalThis, 'sessionStorage', previousStorage); else delete globalThis.sessionStorage; });
  adapter.tokenStorage.set('test-session');
  const notifications = [];
  const unsubscribe = adapter.subscribeUnauthorized?.(token => notifications.push(token));
  if (unsubscribe) t.after(unsubscribe);
  let current;
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ error: current.message, fieldErrors: current.fieldErrors }), { status: current.status }));
  for (const [status, message, expected] of [
    [409, 'You are already a member of this room', /เป็นสมาชิก.*แล้ว/],
    [409, 'Inactive rooms cannot accept requests', /พักรับคำขอ/],
    [403, 'Only the requester can withdraw this request', /ผู้ส่งคำขอ/],
    [500, 'SQLITE_ERROR: no such table ROOM_REQUEST', /ระบบขัดข้อง/],
    [401, 'Invalid or expired authentication token', /หมดอายุ/],
  ]) {
    current = { status, message };
    const direct = new adapter.ApiError(message, status);
    assert.match(direct.message, expected);
    assert.equal(direct.status, status);
    assert.equal(direct.name, 'ApiError');
    assert.equal(new adapter.ApiError(direct.message, status).message, direct.message);
    await assert.rejects(adapter.api.createJoinRequest('1'), caught => caught instanceof adapter.ApiError && caught.status === status && expected.test(caught.message));
  }
  current = { status: 400, message: 'Invalid listing fields', fieldErrors: { title: 'กรุณากรอกหัวข้อประกาศ', price: 12 } };
  await assert.rejects(adapter.api.createRoom({}), caught => {
    assert.deepEqual(caught.fieldErrors, { title: 'กรุณากรอกหัวข้อประกาศ' });
    return true;
  });
  if (adapter.subscribeUnauthorized) assert.deepEqual(notifications, ['test-session']);
});
