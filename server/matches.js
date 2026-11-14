import { assert } from './errors.js';

export function canViewRoomMembers(db, room, userId) {
  if (!userId) return false;
  if (room.owner_id === userId) return true;
  return Boolean(db.prepare(`SELECT 1 FROM ROOM_MEMBER
    WHERE room_id = ? AND user_id = ? AND status = 'approved'`).get(room.room_id, userId));
}

export function listRoomMembers(db, roomId, userDto) {
  const rows = db.prepare(`
    SELECT u.user_id, u.first_name, u.last_name, u.profile_image,
      'owner' AS membership_status, 0 AS role_order,
      strftime('%Y-%m-%dT%H:%M:%fZ', room.created_at) AS joined_at
    FROM ROOM room JOIN USER u ON u.user_id = room.owner_id WHERE room.room_id = ?
    UNION ALL
    SELECT u.user_id, u.first_name, u.last_name, u.profile_image,
      rm.status AS membership_status, 1 AS role_order,
      strftime('%Y-%m-%dT%H:%M:%fZ', rm.joined_at) AS joined_at
    FROM ROOM_MEMBER rm JOIN USER u ON u.user_id = rm.user_id
    WHERE rm.room_id = ? AND rm.status = 'approved'
    ORDER BY role_order, joined_at, user_id
  `).all(roomId, roomId);
  return rows.map(row => ({
    ...userDto(row),
    status: row.membership_status,
    joinedAt: row.joined_at,
  }));
}

// Keep the existing authentication, public-profile projection and match response contract.
export function createRoomMatchesHandler(db, {
  authenticate, sendJson, getRoomRow, userDto, matchSelect, matchDto,
}) {
  return async function handleRoomMatches(request, response, url) {
    const leavePath = /^\/api\/rooms\/(\d+)\/members\/me$/.exec(url.pathname);
    if (request.method === 'DELETE' && leavePath) {
      const user = authenticate(db, request);
      const roomId = Number(leavePath[1]);
      assert(Number.isSafeInteger(roomId) && roomId > 0, 400, 'roomId must be a positive safe integer');
      db.exec('BEGIN IMMEDIATE');
      try {
        const room = getRoomRow(db, roomId);
        assert(room, 404, 'Room not found');
        assert(room.owner_id !== user.user_id, 403, 'Owners must manage their listing instead of leaving it');
        const member = db.prepare('SELECT status FROM ROOM_MEMBER WHERE room_id = ? AND user_id = ?').get(roomId, user.user_id);
        assert(member && ['approved', 'left'].includes(member.status), 403, 'Only a current or former member can leave this room');
        db.prepare("UPDATE ROOM_MEMBER SET status = 'left' WHERE room_id = ? AND user_id = ? AND status = 'approved'").run(roomId, user.user_id);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      sendJson(response, 200, { success: true }, request);
      return true;
    }
    const pathMatch = /^\/api\/rooms\/(\d+)\/members$/.exec(url.pathname);
    if (request.method === 'GET' && pathMatch) {
      const user = authenticate(db, request);
      const roomId = Number(pathMatch[1]);
      assert(Number.isSafeInteger(roomId) && roomId > 0, 400, 'roomId must be a positive safe integer');
      const room = getRoomRow(db, roomId);
      assert(room, 404, 'Room not found');
      assert(canViewRoomMembers(db, room, user.user_id), 403, 'Only the room owner or a member can view members');
      sendJson(response, 200, { members: listRoomMembers(db, roomId, userDto) }, request);
      return true;
    }

    if (request.method === 'GET' && url.pathname === '/api/matches') {
      const user = authenticate(db, request);
      // Historical matches remain stored, but must not expose contacts after membership ends.
      const rows = db.prepare(`
        ${matchSelect()}
        JOIN ROOM_MEMBER member ON member.room_id = m.room_id
          AND member.user_id = m.completer_user_id AND member.status = 'approved'
        WHERE (m.initiator_user_id = ? OR m.completer_user_id = ?)
          AND room.owner_id = m.initiator_user_id
        ORDER BY m.matched_at DESC, m.match_id DESC
      `).all(user.user_id, user.user_id);
      sendJson(response, 200, { matches: rows.map(row => matchDto(row, user.user_id)) }, request);
      return true;
    }
    return false;
  };
}
