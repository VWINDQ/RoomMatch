import { calculateAge } from '../shared/age.js';
import { assert, HttpError } from './errors.js';

async function writeConnection(db, operation) {
  await db.exec('BEGIN');
  try {
    // Build the response before commit so a failed profile read cannot save partial consent.
    const connection = await operation();
    await db.exec('COMMIT');
    return connection;
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }
}

async function profile(db, row, isAcceptedFriend = false) {
  const lifestyle = await db.prepare('SELECT lifestyle_name FROM LIFESTYLE WHERE user_id = ?').get(row.user_id);
  const preference = await db.prepare('SELECT budget_min, budget_max, preferred_gender, preferred_age_min, preferred_age_max FROM PREFERENCE WHERE user_id = ?').get(row.user_id);
  const result = {
    userId: row.user_id, firstName: row.first_name, lastName: row.last_name,
    university: row.university, bio: row.bio, profileImage: row.profile_image,
    age: calculateAge(row.date_of_birth),
    gender: row.gender,
    preferredGender: preference?.preferred_gender ?? null,
    preferredAgeMin: preference?.preferred_age_min ?? null, preferredAgeMax: preference?.preferred_age_max ?? null,
    lifestyle: lifestyle?.lifestyle_name ?? null,
    budgetMin: preference?.budget_min ?? null, budgetMax: preference?.budget_max ?? null,
  };
  if (isAcceptedFriend) Object.assign(result, {
    instagram: row.instagram, lineId: row.line_id, email: row.email, phone: row.phone,
  });
  return result;
}

async function connectionDto(db, row, viewerId) {
  const otherId = row.sender_id === viewerId ? row.recipient_id : row.sender_id;
  const other = await db.prepare('SELECT * FROM USER WHERE user_id = ?').get(otherId);
  return {
    connectionId: row.connection_id, direction: row.recipient_id === viewerId ? 'incoming' : 'outgoing',
    status: row.status, createdAt: row.created_at, respondedAt: row.responded_at,
    person: await profile(db, other, row.status === 'accepted'),
  };
}

export async function handleFriendRoutes({ db, request, response, url, user, readJson, sendJson }) {
  const viewerId = user.user_id;
  if (request.method === 'GET' && url.pathname === '/api/friends') {
    const query = (url.searchParams.get('q') ?? '').trim();
    assert(query.length <= 100, 400, 'คำค้นหาต้องไม่เกิน 100 ตัวอักษร');
    const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
    const rows = await db.prepare(`
      SELECT u.* FROM USER u LEFT JOIN LIFESTYLE l ON l.user_id = u.user_id
      WHERE u.is_active = 1 AND u.user_id != ?
        AND NOT EXISTS (SELECT 1 FROM FRIEND_CONNECTION f
          WHERE (f.sender_id = ? AND f.recipient_id = u.user_id)
             OR (f.recipient_id = ? AND f.sender_id = u.user_id))
        AND (u.first_name ILIKE ? ESCAPE '\\' OR u.last_name ILIKE ? ESCAPE '\\'
          OR (u.first_name || ' ' || u.last_name) ILIKE ? ESCAPE '\\'
          OR u.university ILIKE ? ESCAPE '\\' OR u.bio ILIKE ? ESCAPE '\\'
          OR l.lifestyle_name ILIKE ? ESCAPE '\\')
      ORDER BY lower(u.first_name), u.user_id
    `).all(viewerId, viewerId, viewerId, pattern, pattern, pattern, pattern, pattern, pattern);
    const people = [];
    for (const row of rows) people.push(await profile(db, row));
    sendJson(response, 200, { people }, request);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/friends/connections') {
    const rows = await db.prepare(`SELECT f.* FROM FRIEND_CONNECTION f
      JOIN USER s ON s.user_id = f.sender_id JOIN USER r ON r.user_id = f.recipient_id
      WHERE (f.sender_id = ? OR f.recipient_id = ?) AND s.is_active = 1 AND r.is_active = 1
      ORDER BY f.created_at DESC, f.connection_id DESC`).all(viewerId, viewerId);
    const connections = [];
    for (const row of rows) connections.push(await connectionDto(db, row, viewerId));
    sendJson(response, 200, { connections }, request);
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/friends/connections') {
    const body = await readJson(request);
    assert(Number.isSafeInteger(body.recipientId) && body.recipientId > 0, 400, 'กรุณาระบุผู้รับคำชวน');
    assert(body.recipientId !== viewerId, 400, 'ส่งคำชวนหาตัวเองไม่ได้');
    const connection = await writeConnection(db, async () => {
      assert(await db.prepare('SELECT 1 FROM USER WHERE user_id = ? AND is_active = 1').get(viewerId), 401, 'Authentication required');
      assert(await db.prepare('SELECT 1 FROM USER WHERE user_id = ? AND is_active = 1').get(body.recipientId), 404, 'ไม่พบผู้ใช้นี้');
      await db.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))').get(`friend:${Math.min(viewerId, body.recipientId)}:${Math.max(viewerId, body.recipientId)}`);
      const existing = await db.prepare(`SELECT status FROM FRIEND_CONNECTION
        WHERE status <> 'cancelled' AND ((sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?))`)
        .get(viewerId, body.recipientId, body.recipientId, viewerId);
      assert(existing?.status !== 'declined', 409, 'คำชวนนี้ถูกปฏิเสธแล้ว จึงส่งคำชวนใหม่ให้คนนี้ไม่ได้');
      assert(existing?.status !== 'accepted', 409, 'คุณเป็นเพื่อนกันแล้ว ดูได้ที่แท็บเพื่อนของฉัน');
      assert(!existing, 409, 'คุณกับคนนี้มีคำชวนอยู่แล้ว กรุณาดูที่แท็บคำชวนหรือเพื่อนของฉัน');
      const result = await db.prepare('INSERT INTO FRIEND_CONNECTION(sender_id, recipient_id) VALUES (?, ?) RETURNING connection_id').run(viewerId, body.recipientId);
      const row = await db.prepare('SELECT * FROM FRIEND_CONNECTION WHERE connection_id = ? FOR UPDATE').get(result.insertId);
      return await connectionDto(db, row, viewerId);
    });
    sendJson(response, 201, { connection }, request);
    return;
  }

  const cancelMatch = /^\/api\/friends\/connections\/(\d+)\/cancel$/.exec(url.pathname);
  if (request.method === 'POST' && cancelMatch) {
    const connectionId = Number(cancelMatch[1]);
    assert(Number.isSafeInteger(connectionId) && connectionId > 0, 400, 'connectionId must be a positive safe integer');
    const connection = await writeConnection(db, async () => {
      assert(await db.prepare('SELECT 1 FROM USER WHERE user_id = ? AND is_active = 1').get(viewerId), 401, 'Authentication required');
      const row = await db.prepare('SELECT * FROM FRIEND_CONNECTION WHERE connection_id = ? FOR UPDATE').get(connectionId);
      assert(row, 404, 'ไม่พบคำชวน');
      assert(row.sender_id === viewerId, 403, 'เฉพาะผู้ส่งเท่านั้นที่ถอนคำชวนได้');
      // A retry after a lost response returns the original outcome and timestamp.
      if (row.status === 'cancelled') return await connectionDto(db, row, viewerId);
      assert(row.status === 'pending', 409, 'คำชวนนี้ได้รับการตอบกลับแล้ว ถอนคำชวนไม่ได้ กรุณาอัปเดตคำชวน');
      const result = await db.prepare(`UPDATE FRIEND_CONNECTION
        SET status = 'cancelled', responded_at = clock_timestamp()
        WHERE connection_id = ? AND status = 'pending'`).run(connectionId);
      assert(result.changes === 1, 409, 'คำชวนนี้เปลี่ยนสถานะแล้ว กรุณาอัปเดตคำชวน');
      const updated = await db.prepare('SELECT * FROM FRIEND_CONNECTION WHERE connection_id = ?').get(connectionId);
      return await connectionDto(db, updated, viewerId);
    });
    sendJson(response, 200, { connection }, request);
    return;
  }

  const match = /^\/api\/friends\/connections\/(\d+)$/.exec(url.pathname);
  if (request.method === 'PATCH' && match) {
    const connectionId = Number(match[1]);
    assert(Number.isSafeInteger(connectionId) && connectionId > 0, 400, 'connectionId must be a positive safe integer');
    const body = await readJson(request);
    assert(body.status === 'accepted' || body.status === 'declined', 400, 'สถานะคำชวนไม่ถูกต้อง');
    const connection = await writeConnection(db, async () => {
      assert(await db.prepare('SELECT 1 FROM USER WHERE user_id = ? AND is_active = 1').get(viewerId), 401, 'Authentication required');
      const row = await db.prepare('SELECT * FROM FRIEND_CONNECTION WHERE connection_id = ? FOR UPDATE').get(connectionId);
      assert(row, 404, 'ไม่พบคำชวน');
      assert(row.recipient_id === viewerId, 403, 'เฉพาะผู้รับคำชวนเท่านั้นที่ตอบรับได้');
      assert(await db.prepare('SELECT 1 FROM USER WHERE user_id = ? AND is_active = 1').get(row.sender_id), 409, 'ผู้ส่งคำชวนไม่ได้ใช้งานแล้ว');
      const result = await db.prepare(`UPDATE FRIEND_CONNECTION SET status = ?, responded_at = clock_timestamp()
        WHERE connection_id = ? AND status = 'pending'`).run(body.status, row.connection_id);
      assert(result.changes === 1, 409, 'คำชวนนี้ได้รับการตอบกลับแล้ว');
      const updated = await db.prepare('SELECT * FROM FRIEND_CONNECTION WHERE connection_id = ?').get(row.connection_id);
      return await connectionDto(db, updated, viewerId);
    });
    sendJson(response, 200, { connection }, request);
    return;
  }
  throw new HttpError(404, 'Endpoint not found');
}
