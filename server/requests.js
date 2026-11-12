import { assert } from './errors.js';

const REQUEST_DECISIONS = new Set(['approved', 'rejected']);

function positiveId(value, field) {
  const parsed = Number(value);
  assert(Number.isSafeInteger(parsed) && parsed > 0, 400, `${field} must be a positive safe integer`);
  return parsed;
}

function requestSelect(whereClause) {
  return `
    SELECT rr.*,
      room.description AS room_description,
      requester.user_id AS requester_user_id,
      requester.first_name AS requester_first_name,
      requester.last_name AS requester_last_name,
      requester.profile_image AS requester_profile_image
    FROM ROOM_REQUEST rr
    JOIN ROOM room ON room.room_id = rr.room_id
    JOIN USER requester ON requester.user_id = rr.user_id
    ${whereClause}
  `;
}

// HTTP/authentication and room presentation stay shared with the existing application.
export function createRoomRequestHandler(db, {
  authenticate, readJson, sendJson, getRoomRow, roomSummary, matchSelect, matchDto,
}) {
  function requestDto(row) {
    return {
      requestId: row.request_id,
      status: row.status,
      requestedAt: row.requested_at,
      respondedAt: row.responded_at,
      room: roomSummary(row),
      requester: {
        userId: row.requester_user_id,
        firstName: row.requester_first_name,
        lastName: row.requester_last_name,
        profileImage: row.requester_profile_image,
      },
    };
  }

  return async function handleRoomRequest(request, response, url) {
    const { pathname } = url;
    let pathMatch = /^\/api\/rooms\/(\d+)\/requests$/.exec(pathname)?.slice(1);
    if (request.method === 'POST' && pathMatch) {
      const user = authenticate(db, request);
      const roomId = positiveId(pathMatch[0], 'roomId');
      let row;
      db.exec('BEGIN IMMEDIATE');
      try {
        const room = getRoomRow(db, roomId);
        assert(room, 404, 'Room not found');
        assert(room.owner_id !== user.user_id, 409, 'You cannot request to join your own room');
        assert(room.status === 'available' && room.capacity > Number(room.member_count) + 1, 409, 'This room has no available place');
        assert(!db.prepare("SELECT 1 FROM ROOM_MEMBER WHERE room_id = ? AND user_id = ? AND status = 'approved'").get(roomId, user.user_id), 409, 'You are already a member of this room');
        assert(!db.prepare("SELECT 1 FROM ROOM_REQUEST WHERE room_id = ? AND user_id = ? AND status = 'pending'").get(roomId, user.user_id), 409, 'A pending request already exists');
        const result = db.prepare("INSERT INTO ROOM_REQUEST (user_id, room_id, status) VALUES (?, ?, 'pending')").run(user.user_id, roomId);
        row = db.prepare(requestSelect('WHERE rr.request_id = ?')).get(Number(result.lastInsertRowid));
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      sendJson(response, 201, { request: requestDto(row) }, request);
      return true;
    }

    if (request.method === 'GET' && pathname === '/api/requests/mine') {
      const user = authenticate(db, request);
      const rows = db.prepare(`${requestSelect('WHERE rr.user_id = ?')} ORDER BY rr.requested_at DESC, rr.request_id DESC`).all(user.user_id);
      sendJson(response, 200, { requests: rows.map(requestDto) }, request);
      return true;
    }

    if (request.method === 'GET' && pathname === '/api/owner/requests') {
      const user = authenticate(db, request);
      const rows = db.prepare(`${requestSelect('WHERE room.owner_id = ?')} ORDER BY rr.requested_at DESC, rr.request_id DESC`).all(user.user_id);
      sendJson(response, 200, { requests: rows.map(requestDto) }, request);
      return true;
    }

    pathMatch = /^\/api\/requests\/(\d+)$/.exec(pathname)?.slice(1);
    if (request.method === 'PATCH' && pathMatch) {
      const owner = authenticate(db, request);
      const requestId = positiveId(pathMatch[0], 'requestId');
      const body = await readJson(request);
      assert(REQUEST_DECISIONS.has(body.status), 400, 'status must be approved or rejected');
      let createdMatch = null;

      db.exec('BEGIN IMMEDIATE');
      try {
        const joinRequest = db.prepare(`
          SELECT rr.*, room.owner_id, room.capacity, room.status AS room_status,
            (SELECT COUNT(*) FROM ROOM_MEMBER rm WHERE rm.room_id = room.room_id AND rm.status = 'approved') AS member_count
          FROM ROOM_REQUEST rr JOIN ROOM room ON room.room_id = rr.room_id WHERE rr.request_id = ?
        `).get(requestId);
        assert(joinRequest, 404, 'Request not found');
        assert(joinRequest.owner_id === owner.user_id, 403, 'Only the room owner can respond to this request');
        assert(joinRequest.status === 'pending', 409, 'This request has already been handled');

        if (body.status === 'rejected') {
          db.prepare("UPDATE ROOM_REQUEST SET status = 'rejected', responded_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE request_id = ? AND status = 'pending'").run(requestId);
        } else {
          assert(joinRequest.user_id !== owner.user_id, 409, 'A room owner cannot match with themselves');
          assert(joinRequest.room_status !== 'inactive', 409, 'Inactive rooms cannot accept requests');
          assert(Number(joinRequest.member_count) + 1 < joinRequest.capacity, 409, 'This room has reached capacity');
          assert(!db.prepare("SELECT 1 FROM ROOM_MEMBER WHERE room_id = ? AND user_id = ? AND status = 'approved'").get(joinRequest.room_id, joinRequest.user_id), 409, 'The requester is already a room member');
          assert(!db.prepare('SELECT 1 FROM MATCHES WHERE room_id = ? AND ((initiator_user_id = ? AND completer_user_id = ?) OR (initiator_user_id = ? AND completer_user_id = ?))').get(
            joinRequest.room_id, joinRequest.user_id, owner.user_id, owner.user_id, joinRequest.user_id,
          ), 409, 'A match already exists for these users and room');

          const changed = db.prepare("UPDATE ROOM_REQUEST SET status = 'approved', responded_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE request_id = ? AND status = 'pending'").run(requestId);
          assert(changed.changes === 1, 409, 'This request has already been handled');
          db.prepare("INSERT INTO ROOM_MEMBER (user_id, room_id, status) VALUES (?, ?, 'approved')").run(joinRequest.user_id, joinRequest.room_id);
          const matchResult = db.prepare('INSERT INTO MATCHES (initiator_user_id, completer_user_id, room_id) VALUES (?, ?, ?)').run(owner.user_id, joinRequest.user_id, joinRequest.room_id);
          const occupancy = Number(joinRequest.member_count) + 2;
          if (occupancy >= joinRequest.capacity) {
            db.prepare("UPDATE ROOM SET status = 'full' WHERE room_id = ?").run(joinRequest.room_id);
          }
          createdMatch = db.prepare(`${matchSelect()} WHERE m.match_id = ?`).get(Number(matchResult.lastInsertRowid));
        }
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }

      const updatedRequest = db.prepare(requestSelect('WHERE rr.request_id = ?')).get(requestId);
      sendJson(response, 200, {
        request: requestDto(updatedRequest),
        ...(createdMatch ? { match: matchDto(createdMatch, owner.user_id) } : {}),
      }, request);
      return true;
    }
    return false;
  };
}
