import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'vite';

test('listing status actions lock synchronously per room, use the response and allow retry', async t => {
  const vite = await createServer({ configFile: false, envDir: false, server: { middlewareMode: true, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } });
  t.after(() => vite.close());
  const { createListingStatusActions } = await vite.ssrLoadModule('/src/lib/listingStatus.ts');
  const requests = []; const updates = []; const errors = []; let pending;
  const actions = createListingStatusActions({
    update: (roomId, payload) => new Promise((resolve, reject) => requests.push({ roomId, payload, resolve, reject })),
    onPending: ids => { pending = ids; }, onUpdated: room => updates.push(room), onError: message => errors.push(message),
  });
  const room = { roomId: '1', status: 'inactive', price: 3500 };
  const first = actions.toggle(room);
  const duplicate = actions.toggle(room);
  assert.equal(requests.length, 1);
  assert.equal(actions.isPending('1'), true);
  assert.deepEqual([...pending], ['1']);
  const other = actions.toggle({ ...room, roomId: '2' });
  assert.equal(requests.length, 2);
  assert.deepEqual([...pending], ['1', '2']);
  const serverRoom = { ...room, status: 'full', price: 4321, availableSlots: 0 };
  requests[0].resolve(serverRoom);
  await Promise.all([first, duplicate]);
  assert.equal(updates[0], serverRoom);
  assert.deepEqual([...pending], ['2']);
  requests[1].reject(new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่อีกครั้ง'));
  await other;
  assert.equal(updates.length, 1);
  assert.deepEqual(errors, ['เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่อีกครั้ง']);
  assert.equal(pending.size, 0);
  const retry = actions.toggle({ ...room, roomId: '2' });
  assert.equal(requests.length, 3);
  requests[2].resolve({ ...room, roomId: '2', status: 'available' });
  await retry;
  assert.equal(updates.length, 2);
  assert.equal(pending.size, 0);
});

test('an account change discards the old listing error and releases its pending lock', async t => {
  const vite = await createServer({ configFile: false, envDir: false, server: { middlewareMode: true, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } });
  t.after(() => vite.close());
  const { createListingStatusActions } = await vite.ssrLoadModule('/src/lib/listingStatus.ts');
  const { SessionChangedError } = await vite.ssrLoadModule('/src/lib/api.ts');
  const errors = []; const updates = []; let pending; let rejectRequest;
  const actions = createListingStatusActions({
    update: () => new Promise((_, reject) => { rejectRequest = reject; }),
    onPending: ids => { pending = ids; }, onUpdated: room => updates.push(room), onError: message => errors.push(message),
  });
  const request = actions.toggle({ roomId: '1', status: 'available' });
  assert.equal(actions.isPending('1'), true);
  rejectRequest(new SessionChangedError());
  await request;
  assert.deepEqual(errors, [], 'the next account must not receive an obsolete error notification');
  assert.deepEqual(updates, []);
  assert.equal(actions.isPending('1'), false);
  assert.equal(pending.size, 0);
});
