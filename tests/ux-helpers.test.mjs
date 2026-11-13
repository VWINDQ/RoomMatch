import assert from 'node:assert/strict';
import { test } from 'node:test';
import { friendlyApiError } from '../src/lib/apiErrors.ts';
import { roomReturn } from '../src/lib/roomNavigation.ts';

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
