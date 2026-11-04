import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { startRoomMatchServer } from '../server/app.js';
import { openDatabase } from '../server/database.js';

const database = openDatabase({ filename: ':memory:' });
let application;
let baseUrl;

before(async () => {
  application = await startRoomMatchServer({
    db: database,
    host: '127.0.0.1',
    port: 0,
    logger: { error: () => {} },
  });
  baseUrl = `http://127.0.0.1:${application.server.address().port}`;
});

after(async () => {
  if (application) await new Promise((resolve) => application.server.close(resolve));
  database.close();
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

async function register({ firstName, email }) {
  const result = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      firstName,
      lastName: 'Journey',
      phone: '0890000000',
      email,
      password: 'journey-password',
    }),
  });
  assert.equal(result.response.status, 201);
  return {
    ...result.body.user,
    headers: { Authorization: `Bearer ${result.body.token}` },
  };
}

test('register → list → request → approve/reject → membership and match', async () => {
  const owner = await register({ firstName: 'Owner', email: 'owner.journey@example.test' });
  const seeker = await register({ firstName: 'Seeker', email: 'seeker.journey@example.test' });
  const secondSeeker = await register({ firstName: 'Second', email: 'second.journey@example.test' });

  const created = await api('/api/rooms', {
    method: 'POST',
    headers: owner.headers,
    body: JSON.stringify({
      title: 'Journey room',
      description: 'A persisted room used by the complete API journey.',
      googleMapsUrl: 'https://maps.google.com/?q=13.65,100.49',
      price: 5900,
      capacity: 2,
      images: [
        'https://images.example.test/journey-1.jpg',
        'https://images.example.test/journey-2.jpg',
      ],
    }),
  });
  assert.equal(created.response.status, 201);
  const roomId = created.body.room.roomId;
  assert.equal(created.body.room.title, 'Journey room');
  assert.deepEqual(created.body.room.images.map(({ imageOrder }) => imageOrder), [0, 1]);

  const browse = await api(`/api/rooms?q=${encodeURIComponent('Journey room')}`);
  assert.equal(browse.response.status, 200);
  assert.ok(browse.body.rooms.some((room) => room.roomId === roomId));

  const ownRequest = await api(`/api/rooms/${roomId}/requests`, {
    method: 'POST',
    headers: owner.headers,
    body: JSON.stringify({}),
  });
  assert.equal(ownRequest.response.status, 409);

  const requested = await api(`/api/rooms/${roomId}/requests`, {
    method: 'POST',
    headers: seeker.headers,
    body: JSON.stringify({}),
  });
  assert.equal(requested.response.status, 201);
  assert.equal(requested.body.request.status, 'pending');

  const approved = await api(`/api/requests/${requested.body.request.requestId}`, {
    method: 'PATCH',
    headers: owner.headers,
    body: JSON.stringify({ status: 'approved' }),
  });
  assert.equal(approved.response.status, 200);
  assert.equal(approved.body.request.status, 'approved');
  assert.equal(approved.body.match.otherUser.userId, seeker.userId);

  const roomAfterApproval = await api(`/api/rooms/${roomId}`, { headers: seeker.headers });
  assert.equal(roomAfterApproval.response.status, 200);
  assert.equal(roomAfterApproval.body.room.status, 'full');
  assert.equal(roomAfterApproval.body.room.availableSlots, 0);

  const members = await api(`/api/rooms/${roomId}/members`, { headers: seeker.headers });
  assert.equal(members.response.status, 200);
  assert.deepEqual(
    members.body.members.map(({ userId }) => userId).sort((left, right) => left - right),
    [owner.userId, seeker.userId].sort((left, right) => left - right),
  );

  const matches = await api('/api/matches', { headers: seeker.headers });
  assert.equal(matches.response.status, 200);
  assert.ok(matches.body.matches.some((match) => (
    match.room.roomId === roomId && match.otherUser.userId === owner.userId
  )));

  const fullRoomRequest = await api(`/api/rooms/${roomId}/requests`, {
    method: 'POST',
    headers: secondSeeker.headers,
    body: JSON.stringify({}),
  });
  assert.equal(fullRoomRequest.response.status, 409);

  const rejectionRoom = await api('/api/rooms', {
    method: 'POST',
    headers: owner.headers,
    body: JSON.stringify({
      title: 'Rejection journey room',
      description: 'Keeps the rejection path independent.',
      googleMapsUrl: 'https://maps.google.com/?q=13.66,100.50',
      price: 5100,
      capacity: 2,
      images: [],
    }),
  });
  assert.equal(rejectionRoom.response.status, 201);

  const pendingRejection = await api(`/api/rooms/${rejectionRoom.body.room.roomId}/requests`, {
    method: 'POST',
    headers: secondSeeker.headers,
    body: JSON.stringify({}),
  });
  assert.equal(pendingRejection.response.status, 201);

  const rejected = await api(`/api/requests/${pendingRejection.body.request.requestId}`, {
    method: 'PATCH',
    headers: owner.headers,
    body: JSON.stringify({ status: 'rejected' }),
  });
  assert.equal(rejected.response.status, 200);
  assert.equal(rejected.body.request.status, 'rejected');
  assert.equal(Object.hasOwn(rejected.body, 'match'), false);

  const secondSeekerRequests = await api('/api/requests/mine', { headers: secondSeeker.headers });
  assert.equal(secondSeekerRequests.response.status, 200);
  assert.ok(secondSeekerRequests.body.requests.some((request) => (
    request.requestId === pendingRejection.body.request.requestId && request.status === 'rejected'
  )));
});
