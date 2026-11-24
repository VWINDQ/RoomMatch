import { assert } from './errors.js';
import { calculateAge } from '../shared/age.js';

export async function canViewRoomMembers(db, room, userId) {
  if (!userId) return false;
  if (room.owner_id === userId) return true;
  return Boolean(await db.prepare(`SELECT 1 FROM ROOM_MEMBER
    WHERE room_id = ? AND user_id = ? AND status = 'approved'`).get(room.room_id, userId));
}

const residentsQuery = `WITH residents AS (
    SELECT u.user_id, u.first_name, u.last_name, u.profile_image,
      'owner' AS membership_status, 0 AS role_order,
      room.created_at AS joined_at
    FROM ROOM room JOIN USER u ON u.user_id = room.owner_id WHERE room.room_id = ? AND room.owner_is_resident
    UNION ALL
    SELECT u.user_id, u.first_name, u.last_name, u.profile_image,
      rm.status AS membership_status, 1 AS role_order,
      rm.joined_at AS joined_at
    FROM ROOM_MEMBER rm JOIN USER u ON u.user_id = rm.user_id
    WHERE rm.room_id = ? AND rm.status = 'approved'
    )`;

export async function listRoomMembers(db, roomId, userDto, { includeProfiles = false } = {}) {
  const rows = await db.prepare(`
    ${residentsQuery}
    SELECT residents.*${includeProfiles ? `,
      person.date_of_birth, person.gender, person.university, person.bio, lifestyle.lifestyle_name,
      preference.preferred_gender, preference.preferred_age_min, preference.preferred_age_max,
      preference.budget_min, preference.budget_max` : ''}
    FROM residents
    ${includeProfiles ? `
      JOIN USER person ON person.user_id = residents.user_id
      LEFT JOIN LIFESTYLE lifestyle ON lifestyle.user_id = residents.user_id
      LEFT JOIN PREFERENCE preference ON preference.user_id = residents.user_id` : ''}
    ORDER BY residents.role_order, residents.joined_at, residents.user_id
  `).all(roomId, roomId);
  return rows.map(row => ({
    ...userDto(row),
    status: row.membership_status,
    joinedAt: row.joined_at,
    ...(includeProfiles ? { profile: {
      ...userDto(row),
      age: calculateAge(row.date_of_birth), gender: row.gender, university: row.university, bio: row.bio,
      lifestyle: row.lifestyle_name,
      preferredGender: row.preferred_gender, preferredAgeMin: row.preferred_age_min, preferredAgeMax: row.preferred_age_max,
      budgetMin: row.budget_min, budgetMax: row.budget_max,
    } } : {}),
  }));
}

export async function listSharedResidentProfiles(db, roomId) {
  const rows = await db.prepare(`
    ${residentsQuery}
    SELECT residents.user_id, residents.first_name, residents.last_name, residents.profile_image,
      residents.membership_status, person.bio, lifestyle.lifestyle_name
    FROM residents
    JOIN USER person ON person.user_id = residents.user_id
    LEFT JOIN LIFESTYLE lifestyle ON lifestyle.user_id = residents.user_id
    WHERE person.share_resident_profile AND person.is_active = 1
    ORDER BY residents.role_order, residents.joined_at, residents.user_id
  `).all(roomId, roomId);
  return rows.map(row => ({
    userId: row.user_id, firstName: row.first_name, lastName: row.last_name, profileImage: row.profile_image,
    bio: row.bio, lifestyle: row.lifestyle_name, isListingOwner: row.membership_status === 'owner',
  }));
}

// Keep the existing authentication, public-profile projection and match response contract.
export function createRoomMatchesHandler(db, {
  authenticate, sendJson, getRoomRow, userDto, matchSelect, matchDto,
}) {
  return async function handleRoomMatches(request, response, url) {
    const leavePath = /^\/api\/rooms\/(\d+)\/members\/me$/.exec(url.pathname);
    if (request.method === 'DELETE' && leavePath) {
      const user = await authenticate(db, request);
      const roomId = Number(leavePath[1]);
      assert(Number.isSafeInteger(roomId) && roomId > 0, 400, 'roomId must be a positive safe integer');
      await db.exec('BEGIN');
      try {
        const room = await getRoomRow(db, roomId, { lock: true });
        assert(room, 404, 'Room not found');
        assert(room.owner_id !== user.user_id, 403, 'Owners must manage their listing instead of leaving it');
        const member = await db.prepare('SELECT status FROM ROOM_MEMBER WHERE room_id = ? AND user_id = ?').get(roomId, user.user_id);
        assert(member && ['approved', 'left'].includes(member.status), 403, 'Only a current or former member can leave this room');
        await db.prepare("UPDATE ROOM_MEMBER SET status = 'left' WHERE room_id = ? AND user_id = ? AND status = 'approved'").run(roomId, user.user_id);
        await db.exec('COMMIT');
      } catch (error) { await db.exec('ROLLBACK'); throw error; }
      sendJson(response, 200, { success: true }, request);
      return true;
    }
    const pathMatch = /^\/api\/rooms\/(\d+)\/members$/.exec(url.pathname);
    if (request.method === 'GET' && pathMatch) {
      const user = await authenticate(db, request);
      const roomId = Number(pathMatch[1]);
      assert(Number.isSafeInteger(roomId) && roomId > 0, 400, 'roomId must be a positive safe integer');
      const room = await getRoomRow(db, roomId);
      assert(room, 404, 'Room not found');
      assert(await canViewRoomMembers(db, room, user.user_id), 403, 'Only the room owner or a member can view members');
      sendJson(response, 200, { members: await listRoomMembers(db, roomId, userDto) }, request);
      return true;
    }

    if (request.method === 'GET' && url.pathname === '/api/matches') {
      const user = await authenticate(db, request);
      // Historical matches remain stored, but must not expose contacts after membership ends.
      const rows = await db.prepare(`
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
