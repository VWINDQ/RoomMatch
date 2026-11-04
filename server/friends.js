import { assert, HttpError } from './errors.js';

function profile(db, row, includeContact = false) {
  const lifestyle = db.prepare('SELECT lifestyle_name FROM LIFESTYLE WHERE user_id = ?').get(row.user_id);
  const preference = db.prepare('SELECT budget_min, budget_max FROM PREFERENCE WHERE user_id = ?').get(row.user_id);
  const result = {
    userId: row.user_id, firstName: row.first_name, lastName: row.last_name,
    university: row.university, bio: row.bio, profileImage: row.profile_image,
    lifestyle: lifestyle?.lifestyle_name ?? null,
    budgetMin: preference?.budget_min ?? null, budgetMax: preference?.budget_max ?? null,
  };
  // Contact information is shared only after the recipient explicitly accepts.
  if (includeContact) Object.assign(result, {
    lineId: row.line_id, instagram: row.instagram, email: row.email, phone: row.phone,
  });
  return result;
}

function connectionDto(db, row, viewerId) {
  const otherId = row.sender_id === viewerId ? row.recipient_id : row.sender_id;
  const other = db.prepare('SELECT * FROM USER WHERE user_id = ?').get(otherId);
  return {
    connectionId: row.connection_id, direction: row.recipient_id === viewerId ? 'incoming' : 'outgoing',
    status: row.status, createdAt: row.created_at, respondedAt: row.responded_at,
    person: profile(db, other, row.status === 'accepted'),
  };
}

export async function handleFriendRoutes({ db, request, response, url, user, readJson, sendJson }) {
  const viewerId = user.user_id;
  if (request.method === 'GET' && url.pathname === '/api/friends') {
    const query = (url.searchParams.get('q') ?? '').trim();
    assert(query.length <= 100, 400, 'คำค้นหาต้องไม่เกิน 100 ตัวอักษร');
    const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
    const rows = db.prepare(`
      SELECT u.* FROM USER u LEFT JOIN LIFESTYLE l ON l.user_id = u.user_id
      WHERE u.is_active = 1 AND u.user_id != ?
        AND NOT EXISTS (SELECT 1 FROM FRIEND_CONNECTION f
          WHERE (f.sender_id = ? AND f.recipient_id = u.user_id)
             OR (f.recipient_id = ? AND f.sender_id = u.user_id))
        AND (u.first_name LIKE ? ESCAPE '\\' OR u.last_name LIKE ? ESCAPE '\\'
          OR u.university LIKE ? ESCAPE '\\' OR u.bio LIKE ? ESCAPE '\\'
          OR l.lifestyle_name LIKE ? ESCAPE '\\')
      ORDER BY u.first_name COLLATE NOCASE, u.user_id
    `).all(viewerId, viewerId, viewerId, pattern, pattern, pattern, pattern, pattern);
    sendJson(response, 200, { people: rows.map(row => profile(db, row)) }, request);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/friends/connections') {
    const rows = db.prepare(`SELECT f.* FROM FRIEND_CONNECTION f
      JOIN USER s ON s.user_id = f.sender_id JOIN USER r ON r.user_id = f.recipient_id
      WHERE (f.sender_id = ? OR f.recipient_id = ?) AND s.is_active = 1 AND r.is_active = 1
      ORDER BY f.created_at DESC, f.connection_id DESC`).all(viewerId, viewerId);
    sendJson(response, 200, { connections: rows.map(row => connectionDto(db, row, viewerId)) }, request);
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/friends/connections') {
    const body = await readJson(request);
    assert(Number.isSafeInteger(body.recipientId) && body.recipientId > 0, 400, 'กรุณาระบุผู้รับคำชวน');
    assert(body.recipientId !== viewerId, 400, 'ส่งคำชวนหาตัวเองไม่ได้');
    assert(db.prepare('SELECT 1 FROM USER WHERE user_id = ? AND is_active = 1').get(body.recipientId), 404, 'ไม่พบผู้ใช้นี้');
    const existing = db.prepare(`SELECT 1 FROM FRIEND_CONNECTION
      WHERE (sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?)`)
      .get(viewerId, body.recipientId, body.recipientId, viewerId);
    assert(!existing, 409, 'คุณกับคนนี้มีคำชวนอยู่แล้ว กรุณาดูที่แท็บคำชวนหรือเพื่อนของฉัน');
    const result = db.prepare('INSERT INTO FRIEND_CONNECTION(sender_id, recipient_id) VALUES (?, ?)').run(viewerId, body.recipientId);
    const row = db.prepare('SELECT * FROM FRIEND_CONNECTION WHERE connection_id = ?').get(result.lastInsertRowid);
    sendJson(response, 201, { connection: connectionDto(db, row, viewerId) }, request);
    return;
  }

  const match = /^\/api\/friends\/connections\/(\d+)$/.exec(url.pathname);
  if (request.method === 'PATCH' && match) {
    const body = await readJson(request);
    assert(body.status === 'accepted' || body.status === 'declined', 400, 'สถานะคำชวนไม่ถูกต้อง');
    const row = db.prepare('SELECT * FROM FRIEND_CONNECTION WHERE connection_id = ?').get(Number(match[1]));
    assert(row, 404, 'ไม่พบคำชวน');
    assert(row.recipient_id === viewerId, 403, 'เฉพาะผู้รับคำชวนเท่านั้นที่ตอบรับได้');
    assert(db.prepare('SELECT 1 FROM USER WHERE user_id = ? AND is_active = 1').get(row.sender_id), 409, 'ผู้ส่งคำชวนไม่ได้ใช้งานแล้ว');
    const result = db.prepare(`UPDATE FRIEND_CONNECTION SET status = ?, responded_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE connection_id = ? AND status = 'pending'`).run(body.status, row.connection_id);
    assert(result.changes === 1, 409, 'คำชวนนี้ได้รับการตอบกลับแล้ว');
    const updated = db.prepare('SELECT * FROM FRIEND_CONNECTION WHERE connection_id = ?').get(row.connection_id);
    sendJson(response, 200, { connection: connectionDto(db, updated, viewerId) }, request);
    return;
  }
  throw new HttpError(404, 'Endpoint not found');
}
