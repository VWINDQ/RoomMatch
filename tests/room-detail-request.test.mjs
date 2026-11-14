import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDatabase } from '../server/database.js';
import { startRoomMatchServer } from '../server/app.js';
import { createToken } from '../server/auth.js';

async function fixture(t) {
  const db = openDatabase({ filename: ':memory:' });
  const app = await startRoomMatchServer({ db, port: 0, logger: { error() {} } });
  t.after(async () => { await new Promise(resolve => app.server.close(resolve)); db.close(); });
  return async (path, userId, method = 'GET', body) => {
    const response = await fetch(`http://127.0.0.1:${app.server.address().port}/api${path}`, {
      method, headers: { ...(userId ? { Authorization: `Bearer ${createToken(userId)}` } : {}), 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json() };
  };
}

test('room details return only the viewer own pending request ID, never another applicant ID', async t => {
  const api = await fixture(t);
  const anonymous = await api('/rooms/1');
  assert.equal(anonymous.status, 200);
  assert.equal(Object.hasOwn(anonymous.body.room, 'pendingRequestId'), false);
  assert.equal((await api('/rooms/1', 3)).body.room.pendingRequestId, 2);
  for (const user of [1, 2, 4, 5]) assert.equal((await api('/rooms/1', user)).body.room.pendingRequestId, null);
  assert.equal((await api('/rooms/3', 3)).body.room.pendingRequestId, null);
  assert.equal((await api('/requests/2/cancel', 4, 'POST')).status, 403);
});

test('detail withdrawal uses the current request; refresh, reapply, and approval show the correct next action', async t => {
  const api = await fixture(t);
  const created = await api('/rooms/3/requests', 4, 'POST');
  assert.equal(created.status, 201);
  const requestId = (await api('/rooms/3', 4)).body.room.pendingRequestId;
  assert.equal(requestId, created.body.request.requestId);
  assert.equal((await api(`/requests/${requestId}/cancel`, 4, 'POST')).status, 200);
  const afterWithdrawal = (await api('/rooms/3', 4)).body.room;
  assert.equal(afterWithdrawal.pendingRequestId, null);
  assert.equal(afterWithdrawal.requestStatus, 'cancelled');
  const retry = await api('/rooms/3/requests', 4, 'POST');
  assert.equal(retry.status, 201);
  assert.notEqual(retry.body.request.requestId, requestId);
  assert.equal((await api('/rooms/3', 4)).body.room.pendingRequestId, retry.body.request.requestId);
  assert.equal((await api(`/requests/${retry.body.request.requestId}`, 1, 'PATCH', { status: 'approved' })).status, 200);
  const afterApproval = (await api('/rooms/3', 4)).body.room;
  assert.equal(afterApproval.requestStatus, 'approved');
  assert.equal(afterApproval.pendingRequestId, null);
  assert.equal(afterApproval.isMember, true);
  assert.equal((await api(`/requests/${retry.body.request.requestId}/cancel`, 4, 'POST')).status, 409);
});

test('pending requests remain withdrawable from details after a room is paused or filled', async t => {
  const api = await fixture(t);
  assert.equal((await api('/rooms/1', 1, 'PATCH', { status: 'inactive' })).status, 200);
  const paused = (await api('/rooms/1', 3)).body.room;
  assert.equal(paused.status, 'inactive');
  assert.equal(paused.pendingRequestId, 2);
  assert.equal((await api('/requests/2/cancel', 3, 'POST')).status, 200);
  assert.equal((await api('/rooms/1', 1, 'PATCH', { status: 'available' })).status, 200);
  const waiting = await api('/rooms/1/requests', 3, 'POST');
  const competitor = await api('/rooms/1/requests', 4, 'POST');
  assert.equal((await api(`/requests/${competitor.body.request.requestId}`, 1, 'PATCH', { status: 'approved' })).status, 200);
  const full = (await api('/rooms/1', 3)).body.room;
  assert.equal(full.status, 'full');
  assert.equal(full.pendingRequestId, waiting.body.request.requestId);
  assert.equal((await api(`/requests/${full.pendingRequestId}/cancel`, 3, 'POST')).status, 200);
  const afterWithdrawal = (await api('/rooms/1', 3)).body.room;
  assert.equal(afterWithdrawal.status, 'full');
  assert.equal(afterWithdrawal.pendingRequestId, null);
});
