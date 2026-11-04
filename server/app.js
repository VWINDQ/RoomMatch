import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { bearerToken, createToken, hashPassword, validateAuthConfiguration, verifyPassword, verifyToken } from './auth.js';
import { assert, HttpError } from './errors.js';
import { openDatabase } from './database.js';
import { handleFriendRoutes } from './friends.js';

const BODY_LIMIT_BYTES = 1_048_576;
const ROOM_STATUSES = new Set(['available', 'full', 'inactive']);
const REQUEST_DECISIONS = new Set(['approved', 'rejected']);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_STATIC_DIRECTORY = fileURLToPath(new URL('../dist/', import.meta.url));
const CONTENT_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.gif', 'image/gif'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);

function text(value, field, { required = false, max = 255 } = {}) {
  if (value === undefined || value === null) {
    assert(!required, 400, `${field} is required`);
    return null;
  }
  assert(typeof value === 'string', 400, `${field} must be a string`);
  const trimmed = value.trim();
  assert(!required || trimmed.length > 0, 400, `${field} is required`);
  assert(trimmed.length <= max, 400, `${field} is too long`);
  return trimmed || null;
}

function integer(value, field, { min, max, required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    assert(!required, 400, `${field} is required`);
    return null;
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  assert(Number.isInteger(parsed), 400, `${field} must be an integer`);
  if (min !== undefined) assert(parsed >= min, 400, `${field} must be at least ${min}`);
  if (max !== undefined) assert(parsed <= max, 400, `${field} must be at most ${max}`);
  return parsed;
}

function money(value, field, { required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    assert(!required, 400, `${field} is required`);
    return null;
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  assert(Number.isSafeInteger(parsed) && parsed >= 0, 400, `${field} must be a non-negative integer`);
  return parsed;
}

function webUrl(value, field, { required = false } = {}) {
  const parsed = text(value, field, { required, max: 2_048 });
  if (parsed === null) return null;
  try {
    const url = new URL(parsed);
    assert(url.protocol === 'http:' || url.protocol === 'https:', 400, `${field} must use http or https`);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, `${field} must be a valid URL`);
  }
  return parsed;
}

function nullableWebUrl(value, field) {
  if (value === '' || value === null) return null;
  return webUrl(value, field);
}

function isoDate(value, field) {
  const parsed = text(value, field, { max: 10 });
  if (parsed === null) return null;
  assert(/^\d{4}-\d{2}-\d{2}$/.test(parsed), 400, `${field} must use YYYY-MM-DD format`);
  const [year, month, day] = parsed.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  assert(
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day,
    400,
    `${field} must be a real calendar date`,
  );
  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  assert(date.getTime() <= todayUtc, 400, `${field} cannot be in the future`);
  return parsed;
}

function splitStoredDescription(stored = '') {
  const [title = '', ...body] = stored.split('\n');
  return { title, description: body.join('\n').trim() };
}

function joinStoredDescription(title, description) {
  return description ? `${title}\n${description}` : title;
}

function userDto(row, { privateFields = false } = {}) {
  if (!row) return null;
  const user = {
    userId: row.user_id,
    firstName: row.first_name,
    lastName: row.last_name,
    profileImage: row.profile_image,
  };
  if (privateFields) {
    Object.assign(user, {
      phone: row.phone,
      gender: row.gender,
      dateOfBirth: row.date_of_birth,
      university: row.university,
      bio: row.bio,
      email: row.email,
      instagram: row.instagram,
      lineId: row.line_id,
      isActive: Boolean(row.is_active),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }
  return user;
}

function parsePreference(body) {
  assert(body && typeof body === 'object' && !Array.isArray(body), 400, 'preference must be an object');
  const preferredGender = text(body.preferredGender, 'preferredGender', { max: 50 });
  const preferredAgeMin = integer(body.preferredAgeMin, 'preferredAgeMin', { min: 18, max: 120 });
  const preferredAgeMax = integer(body.preferredAgeMax, 'preferredAgeMax', { min: 18, max: 120 });
  const budgetMin = money(body.budgetMin, 'budgetMin');
  const budgetMax = money(body.budgetMax, 'budgetMax');
  assert(preferredAgeMin === null || preferredAgeMax === null || preferredAgeMin <= preferredAgeMax, 400, 'preferredAgeMin cannot exceed preferredAgeMax');
  assert(budgetMin === null || budgetMax === null || budgetMin <= budgetMax, 400, 'budgetMin cannot exceed budgetMax');
  return [preferredGender, preferredAgeMin, preferredAgeMax, budgetMin, budgetMax];
}

function savePreference(db, userId, values) {
  db.prepare(`INSERT INTO PREFERENCE (user_id, preferred_gender, preferred_age_min, preferred_age_max, budget_min, budget_max)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET preferred_gender = excluded.preferred_gender,
      preferred_age_min = excluded.preferred_age_min, preferred_age_max = excluded.preferred_age_max,
      budget_min = excluded.budget_min, budget_max = excluded.budget_max`).run(userId, ...values);
}

function lifestyleDto(row) {
  return row ? {
    lifestyleId: row.lifestyle_id,
    lifestyleName: row.lifestyle_name,
  } : null;
}

function preferenceDto(row) {
  return row ? {
    preferenceId: row.preference_id,
    preferredGender: row.preferred_gender,
    preferredAgeMin: row.preferred_age_min,
    preferredAgeMax: row.preferred_age_max,
    budgetMin: row.budget_min,
    budgetMax: row.budget_max,
  } : null;
}

function roomDto(row, images = [], options = {}) {
  const { title, description } = splitStoredDescription(row.description);
  const memberCount = Number(row.member_count ?? 0);
  return {
    roomId: row.room_id,
    title,
    description,
    googleMapsUrl: row.google_maps_url,
    price: row.price,
    capacity: row.capacity,
    status: row.status,
    createdAt: row.created_at,
    owner: row.owner_user_id ? {
      userId: row.owner_user_id,
      firstName: row.owner_first_name,
      lastName: row.owner_last_name,
      profileImage: row.owner_profile_image,
      university: row.owner_university,
    } : undefined,
    images: images.map((image) => ({
      imageId: image.image_id,
      imageUrl: image.image_url,
      imageOrder: image.image_order,
    })),
    memberCount,
    availableSlots: Math.max(0, row.capacity - 1 - memberCount),
    ...(options.currentUserId ? { isOwner: row.owner_id === options.currentUserId } : {}),
    ...(options.requestStatus !== undefined ? { requestStatus: options.requestStatus } : {}),
    ...(options.members ? { members: options.members } : {}),
  };
}

function roomSummary(row) {
  return {
    roomId: row.room_id,
    title: splitStoredDescription(row.room_description).title,
  };
}

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

function matchDto(row, authenticatedUserId) {
  const userIsInitiator = row.initiator_user_id === authenticatedUserId;
  return {
    matchId: row.match_id,
    matchedAt: row.matched_at,
    room: roomSummary(row),
    otherUser: {
      userId: userIsInitiator ? row.completer_user_id : row.initiator_user_id,
      firstName: userIsInitiator ? row.completer_first_name : row.initiator_first_name,
      lastName: userIsInitiator ? row.completer_last_name : row.initiator_last_name,
      profileImage: userIsInitiator ? row.completer_profile_image : row.initiator_profile_image,
      bio: userIsInitiator ? row.completer_bio : row.initiator_bio,
      lineId: userIsInitiator ? row.completer_line_id : row.initiator_line_id,
      instagram: userIsInitiator ? row.completer_instagram : row.initiator_instagram,
    },
  };
}

function queryUser(db, userId) {
  return db.prepare('SELECT * FROM USER WHERE user_id = ?').get(userId);
}

function authenticate(db, request, { optional = false } = {}) {
  const token = bearerToken(request);
  if (!token) {
    if (optional) return null;
    throw new HttpError(401, 'Authentication required');
  }
  const userId = verifyToken(token);
  const user = queryUser(db, userId);
  assert(user && user.is_active, 401, 'Authentication required');
  return user;
}

async function readJson(request) {
  const contentLength = Number(request.headers['content-length'] ?? 0);
  assert(Number.isFinite(contentLength) && contentLength <= BODY_LIMIT_BYTES, 413, 'Request body is too large');
  const contentType = request.headers['content-type'] ?? '';
  assert(contentType.toLowerCase().startsWith('application/json'), 415, 'Content-Type must be application/json');

  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    assert(size <= BODY_LIMIT_BYTES, 413, 'Request body is too large');
    chunks.push(chunk);
  }
  assert(size > 0, 400, 'JSON body is required');
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    assert(parsed && typeof parsed === 'object' && !Array.isArray(parsed), 400, 'JSON body must be an object');
    return parsed;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'Invalid JSON body');
  }
}

function imageRows(db, roomId) {
  return db.prepare('SELECT * FROM ROOM_IMAGE WHERE room_id = ? ORDER BY image_order, image_id').all(roomId);
}

const ROOM_SELECT = `
  SELECT r.*,
    owner.user_id AS owner_user_id,
    owner.first_name AS owner_first_name,
    owner.last_name AS owner_last_name,
    owner.profile_image AS owner_profile_image,
    owner.university AS owner_university,
    (SELECT COUNT(*) FROM ROOM_MEMBER rm WHERE rm.room_id = r.room_id AND rm.status = 'approved') AS member_count
  FROM ROOM r
  JOIN USER owner ON owner.user_id = r.owner_id
`;

function getRoomRow(db, roomId) {
  return db.prepare(`${ROOM_SELECT} WHERE r.room_id = ?`).get(roomId);
}

function parseImages(value, { required = false } = {}) {
  if (value === undefined) {
    assert(!required, 400, 'images is required');
    return null;
  }
  assert(Array.isArray(value), 400, 'images must be an array');
  assert(value.length <= 12, 400, 'images cannot contain more than 12 items');
  return value.map((url, index) => ({ imageUrl: webUrl(url, `images[${index}]`, { required: true }), imageOrder: index }));
}

function insertImages(db, roomId, images, startingOrder = 0) {
  const insert = db.prepare('INSERT INTO ROOM_IMAGE (room_id, image_url, image_order) VALUES (?, ?, ?)');
  for (const [index, image] of images.entries()) {
    insert.run(roomId, image.imageUrl, startingOrder + (image.imageOrder ?? index));
  }
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

function matchSelect() {
  return `
    SELECT m.*, room.description AS room_description,
      initiator.first_name AS initiator_first_name,
      initiator.last_name AS initiator_last_name,
      initiator.profile_image AS initiator_profile_image,
      initiator.bio AS initiator_bio,
      initiator.line_id AS initiator_line_id,
      initiator.instagram AS initiator_instagram,
      completer.first_name AS completer_first_name,
      completer.last_name AS completer_last_name,
      completer.profile_image AS completer_profile_image,
      completer.bio AS completer_bio,
      completer.line_id AS completer_line_id,
      completer.instagram AS completer_instagram
    FROM MATCHES m
    JOIN ROOM room ON room.room_id = m.room_id
    JOIN USER initiator ON initiator.user_id = m.initiator_user_id
    JOIN USER completer ON completer.user_id = m.completer_user_id
  `;
}

function corsOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return null;
  const configured = (process.env.ROOMMATCH_CORS_ORIGIN ?? '').split(',').map((entry) => entry.trim()).filter(Boolean);
  if (configured.includes(origin)) return origin;
  try {
    const parsed = new URL(origin);
    if ((parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') && ['http:', 'https:'].includes(parsed.protocol)) {
      return origin;
    }
  } catch {
    return null;
  }
  return null;
}

function sendJson(response, status, body, request) {
  const origin = corsOrigin(request);
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Vary': 'Origin',
  };
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
  response.writeHead(status, headers);
  response.end(JSON.stringify(body));
}

function sendStatic(response, request, pathname, staticDirectory) {
  if (!staticDirectory || !['GET', 'HEAD'].includes(request.method)) return false;
  const root = resolve(staticDirectory);
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    throw new HttpError(400, 'Invalid URL path');
  }
  const candidate = resolve(root, decodedPath.replace(/^\/+/, ''));
  assert(candidate === root || candidate.startsWith(`${root}${sep}`), 404, 'Page not found');

  let filePath = candidate;
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    if (extname(decodedPath)) return false;
    filePath = resolve(root, 'index.html');
  }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) return false;

  const type = CONTENT_TYPES.get(extname(filePath).toLowerCase()) ?? 'application/octet-stream';
  const size = statSync(filePath).size;
  response.writeHead(200, {
    'Content-Type': type,
    'Content-Length': size,
    'Cache-Control': filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
  });
  if (request.method === 'HEAD') response.end();
  else {
    const stream = createReadStream(filePath);
    stream.on('error', (error) => response.destroy(error));
    stream.pipe(response);
  }
  return true;
}

function matchPath(pathname, pattern) {
  const match = pattern.exec(pathname);
  return match ? match.slice(1).map((value) => decodeURIComponent(value)) : null;
}

export function createRequestHandler(db, { logger = console, staticDirectory = DEFAULT_STATIC_DIRECTORY } = {}) {
  return async function requestHandler(request, response) {
    const url = new URL(request.url, 'http://localhost');
    const { pathname } = url;
    try {
      if (request.method === 'OPTIONS') {
        const origin = corsOrigin(request);
        const headers = {
          'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization,Content-Type',
          'Access-Control-Max-Age': '86400',
          'Vary': 'Origin',
        };
        if (origin) headers['Access-Control-Allow-Origin'] = origin;
        response.writeHead(204, headers);
        response.end();
        return;
      }

      if (request.method === 'GET' && pathname === '/api/health') {
        sendJson(response, 200, { ok: true }, request);
        return;
      }

      if (request.method === 'POST' && pathname === '/api/auth/register') {
        const body = await readJson(request);
        const firstName = text(body.firstName, 'firstName', { required: true, max: 100 });
        const lastName = text(body.lastName, 'lastName', { required: true, max: 100 });
        const phone = text(body.phone, 'phone', { required: true, max: 30 });
        const email = text(body.email, 'email', { required: true, max: 320 }).toLowerCase();
        assert(EMAIL_PATTERN.test(email), 400, 'email must be valid');
        const password = text(body.password, 'password', { required: true, max: 256 });
        assert(password.length >= 8, 400, 'password must be at least 8 characters');
        assert(!db.prepare('SELECT 1 FROM USER WHERE email = ? COLLATE NOCASE').get(email), 409, 'Email is already registered');

        const passwordHash = await hashPassword(password);
        let result;
        try {
          result = db.prepare(`
            INSERT INTO USER (
              first_name, last_name, phone, gender, date_of_birth, password_hash,
              university, profile_image, bio, email, instagram, line_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            firstName,
            lastName,
            phone,
            text(body.gender, 'gender', { max: 50 }),
            isoDate(body.dateOfBirth, 'dateOfBirth'),
            passwordHash,
            text(body.university, 'university', { max: 255 }),
            nullableWebUrl(body.profileImage, 'profileImage'),
            text(body.bio, 'bio', { max: 1_000 }),
            email,
            text(body.instagram, 'instagram', { max: 100 }),
            text(body.lineId, 'lineId', { max: 100 }),
          );
        } catch (error) {
          if (String(error.message).includes('UNIQUE')) throw new HttpError(409, 'Email is already registered');
          throw error;
        }
        const user = queryUser(db, Number(result.lastInsertRowid));
        sendJson(response, 201, { token: createToken(user.user_id), user: userDto(user, { privateFields: true }) }, request);
        return;
      }

      if (request.method === 'POST' && pathname === '/api/auth/login') {
        const body = await readJson(request);
        const email = text(body.email, 'email', { required: true, max: 320 }).toLowerCase();
        const password = text(body.password, 'password', { required: true, max: 256 });
        const user = db.prepare('SELECT * FROM USER WHERE email = ? COLLATE NOCASE').get(email);
        const valid = user ? await verifyPassword(password, user.password_hash) : false;
        assert(valid && user.is_active, 401, 'Invalid email or password');
        sendJson(response, 200, { token: createToken(user.user_id), user: userDto(user, { privateFields: true }) }, request);
        return;
      }

      if (request.method === 'GET' && pathname === '/api/auth/me') {
        const user = authenticate(db, request);
        sendJson(response, 200, { user: userDto(user, { privateFields: true }) }, request);
        return;
      }

      if (request.method === 'GET' && pathname === '/api/profile') {
        const user = authenticate(db, request);
        const lifestyle = db.prepare('SELECT * FROM LIFESTYLE WHERE user_id = ?').get(user.user_id);
        const preference = db.prepare('SELECT * FROM PREFERENCE WHERE user_id = ?').get(user.user_id);
        sendJson(response, 200, {
          user: userDto(user, { privateFields: true }),
          lifestyle: lifestyleDto(lifestyle),
          preference: preferenceDto(preference),
        }, request);
        return;
      }

      if (request.method === 'PATCH' && pathname === '/api/profile') {
        const user = authenticate(db, request);
        const body = await readJson(request);
        const fields = [
          ['firstName', 'first_name', (value) => text(value, 'firstName', { required: true, max: 100 })],
          ['lastName', 'last_name', (value) => text(value, 'lastName', { required: true, max: 100 })],
          ['phone', 'phone', (value) => text(value, 'phone', { required: true, max: 30 })],
          ['gender', 'gender', (value) => text(value, 'gender', { max: 50 })],
          ['dateOfBirth', 'date_of_birth', (value) => isoDate(value, 'dateOfBirth')],
          ['university', 'university', (value) => text(value, 'university', { max: 255 })],
          ['profileImage', 'profile_image', (value) => nullableWebUrl(value, 'profileImage')],
          ['bio', 'bio', (value) => text(value, 'bio', { max: 1_000 })],
          ['instagram', 'instagram', (value) => text(value, 'instagram', { max: 100 })],
          ['lineId', 'line_id', (value) => text(value, 'lineId', { max: 100 })],
        ];
        const updates = [];
        const values = [];
        for (const [apiName, columnName, parse] of fields) {
          if (Object.hasOwn(body, apiName)) {
            updates.push(`${columnName} = ?`);
            values.push(parse(body[apiName]));
          }
        }
        assert(updates.length > 0, 400, 'No editable profile fields were provided');
        const lifestyleName = Object.hasOwn(body, 'lifestyleName') ? text(body.lifestyleName, 'lifestyleName', { required: true, max: 255 }) : null;
        const preferenceValues = Object.hasOwn(body, 'preference') ? parsePreference(body.preference) : null;
        updates.push('updated_at = CURRENT_TIMESTAMP');
        db.exec('BEGIN IMMEDIATE');
        try {
          db.prepare(`UPDATE USER SET ${updates.join(', ')} WHERE user_id = ?`).run(...values, user.user_id);
          if (lifestyleName !== null) db.prepare(`INSERT INTO LIFESTYLE (user_id, lifestyle_name) VALUES (?, ?)
            ON CONFLICT(user_id) DO UPDATE SET lifestyle_name = excluded.lifestyle_name`).run(user.user_id, lifestyleName);
          if (preferenceValues) savePreference(db, user.user_id, preferenceValues);
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
        const updatedUser = queryUser(db, user.user_id);
        const lifestyle = db.prepare('SELECT * FROM LIFESTYLE WHERE user_id = ?').get(user.user_id);
        const preference = db.prepare('SELECT * FROM PREFERENCE WHERE user_id = ?').get(user.user_id);
        sendJson(response, 200, {
          user: userDto(updatedUser, { privateFields: true }),
          lifestyle: lifestyleDto(lifestyle),
          preference: preferenceDto(preference),
        }, request);
        return;
      }

      if (request.method === 'PUT' && pathname === '/api/lifestyle') {
        const user = authenticate(db, request);
        const body = await readJson(request);
        const lifestyleName = text(body.lifestyleName, 'lifestyleName', { required: true, max: 255 });
        db.prepare(`
          INSERT INTO LIFESTYLE (user_id, lifestyle_name) VALUES (?, ?)
          ON CONFLICT(user_id) DO UPDATE SET lifestyle_name = excluded.lifestyle_name
        `).run(user.user_id, lifestyleName);
        sendJson(response, 200, { lifestyle: lifestyleDto(db.prepare('SELECT * FROM LIFESTYLE WHERE user_id = ?').get(user.user_id)) }, request);
        return;
      }

      if (request.method === 'PUT' && pathname === '/api/preference') {
        const user = authenticate(db, request);
        const body = await readJson(request);
        savePreference(db, user.user_id, parsePreference(body));
        sendJson(response, 200, { preference: preferenceDto(db.prepare('SELECT * FROM PREFERENCE WHERE user_id = ?').get(user.user_id)) }, request);
        return;
      }

      if (request.method === 'GET' && pathname === '/api/rooms') {
        const conditions = [];
        const parameters = [];
        const search = url.searchParams.get('q')?.trim();
        if (search) {
          assert(search.length <= 200, 400, 'q is too long');
          conditions.push('(r.description LIKE ? ESCAPE \'\\\' OR owner.first_name LIKE ? ESCAPE \'\\\' OR owner.last_name LIKE ? ESCAPE \'\\\')');
          const escaped = `%${search.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
          parameters.push(escaped, escaped, escaped);
        }
        const minPrice = money(url.searchParams.get('minPrice'), 'minPrice');
        const maxPrice = money(url.searchParams.get('maxPrice'), 'maxPrice');
        if (minPrice !== null) { conditions.push('r.price >= ?'); parameters.push(minPrice); }
        if (maxPrice !== null) { conditions.push('r.price <= ?'); parameters.push(maxPrice); }
        assert(minPrice === null || maxPrice === null || minPrice <= maxPrice, 400, 'minPrice cannot exceed maxPrice');
        const status = url.searchParams.get('status');
        if (status) {
          assert(ROOM_STATUSES.has(status), 400, 'status is invalid');
          conditions.push('r.status = ?');
          parameters.push(status);
        } else {
          conditions.push("r.status != 'inactive'");
        }
        const sortMap = {
          newest: 'r.created_at DESC, r.room_id DESC',
          price_asc: 'r.price ASC, r.room_id DESC',
          price_desc: 'r.price DESC, r.room_id DESC',
          capacity_desc: 'r.capacity DESC, r.room_id DESC',
        };
        const sort = url.searchParams.get('sort') ?? 'newest';
        assert(sortMap[sort], 400, 'sort is invalid');
        const limit = integer(url.searchParams.get('limit') ?? 100, 'limit', { min: 1, max: 100 });
        const offset = integer(url.searchParams.get('offset') ?? 0, 'offset', { min: 0 });
        parameters.push(limit, offset);
        const rows = db.prepare(`
          ${ROOM_SELECT}
          ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
          ORDER BY ${sortMap[sort]}
          LIMIT ? OFFSET ?
        `).all(...parameters);
        const rooms = rows.map((row) => roomDto(row, imageRows(db, row.room_id)));
        sendJson(response, 200, { rooms }, request);
        return;
      }

      let pathMatch = matchPath(pathname, /^\/api\/rooms\/(\d+)$/);
      if (request.method === 'GET' && pathMatch) {
        const roomId = integer(pathMatch[0], 'roomId', { required: true, min: 1 });
        const room = getRoomRow(db, roomId);
        assert(room, 404, 'Room not found');
        const currentUser = authenticate(db, request, { optional: true });
        let requestStatus;
        if (currentUser) {
          requestStatus = db.prepare(`
            SELECT status FROM ROOM_REQUEST WHERE room_id = ? AND user_id = ? ORDER BY request_id DESC LIMIT 1
          `).get(roomId, currentUser.user_id)?.status ?? null;
        }
        const members = db.prepare(`
          SELECT u.user_id, u.first_name, u.last_name, u.profile_image, rm.status, rm.joined_at
          FROM ROOM_MEMBER rm JOIN USER u ON u.user_id = rm.user_id
          WHERE rm.room_id = ? AND rm.status = 'approved' ORDER BY rm.joined_at
        `).all(roomId).map((member) => ({
          userId: member.user_id,
          firstName: member.first_name,
          lastName: member.last_name,
          profileImage: member.profile_image,
          status: member.status,
          joinedAt: member.joined_at,
        }));
        sendJson(response, 200, {
          room: roomDto(room, imageRows(db, roomId), { currentUserId: currentUser?.user_id, requestStatus, members }),
        }, request);
        return;
      }

      if (request.method === 'POST' && pathname === '/api/rooms') {
        const user = authenticate(db, request);
        const body = await readJson(request);
        const title = text(body.title, 'title', { required: true, max: 200 });
        const description = text(body.description, 'description', { max: 5_000 }) ?? '';
        const googleMapsUrl = webUrl(body.googleMapsUrl, 'googleMapsUrl', { required: true });
        const price = money(body.price, 'price', { required: true });
        const capacity = integer(body.capacity, 'capacity', { required: true, min: 1, max: 100 });
        const requestedStatus = body.status ?? 'available';
        assert(ROOM_STATUSES.has(requestedStatus), 400, 'status is invalid');
        const status = requestedStatus === 'inactive' ? 'inactive' : capacity === 1 ? 'full' : 'available';
        const images = parseImages(body.images) ?? [];

        db.exec('BEGIN IMMEDIATE');
        try {
          const result = db.prepare(`
            INSERT INTO ROOM (owner_id, google_maps_url, price, capacity, description, status)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(user.user_id, googleMapsUrl, price, capacity, joinStoredDescription(title, description), status);
          const roomId = Number(result.lastInsertRowid);
          insertImages(db, roomId, images);
          db.exec('COMMIT');
          sendJson(response, 201, { room: roomDto(getRoomRow(db, roomId), imageRows(db, roomId), { currentUserId: user.user_id }) }, request);
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
        return;
      }

      if (request.method === 'PATCH' && pathMatch) {
        const user = authenticate(db, request);
        const roomId = integer(pathMatch[0], 'roomId', { required: true, min: 1 });
        const existing = getRoomRow(db, roomId);
        assert(existing, 404, 'Room not found');
        assert(existing.owner_id === user.user_id, 403, 'Only the room owner can update this room');
        const body = await readJson(request);
        const stored = splitStoredDescription(existing.description);
        const title = Object.hasOwn(body, 'title') ? text(body.title, 'title', { required: true, max: 200 }) : stored.title;
        const description = Object.hasOwn(body, 'description') ? (text(body.description, 'description', { max: 5_000 }) ?? '') : stored.description;
        const googleMapsUrl = Object.hasOwn(body, 'googleMapsUrl') ? webUrl(body.googleMapsUrl, 'googleMapsUrl', { required: true }) : existing.google_maps_url;
        const price = Object.hasOwn(body, 'price') ? money(body.price, 'price', { required: true }) : existing.price;
        const capacity = Object.hasOwn(body, 'capacity') ? integer(body.capacity, 'capacity', { required: true, min: 1, max: 100 }) : existing.capacity;
        const memberCount = Number(existing.member_count);
        assert(capacity >= memberCount + 1, 409, 'capacity cannot be lower than current occupancy');
        let status = Object.hasOwn(body, 'status') ? body.status : existing.status;
        assert(ROOM_STATUSES.has(status), 400, 'status is invalid');
        if (status !== 'inactive') status = capacity <= memberCount + 1 ? 'full' : 'available';
        const images = parseImages(body.images);

        db.exec('BEGIN IMMEDIATE');
        try {
          db.prepare(`
            UPDATE ROOM SET google_maps_url = ?, price = ?, capacity = ?, description = ?, status = ? WHERE room_id = ?
          `).run(googleMapsUrl, price, capacity, joinStoredDescription(title, description), status, roomId);
          if (images) {
            db.prepare('DELETE FROM ROOM_IMAGE WHERE room_id = ?').run(roomId);
            insertImages(db, roomId, images);
          }
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
        sendJson(response, 200, { room: roomDto(getRoomRow(db, roomId), imageRows(db, roomId), { currentUserId: user.user_id }) }, request);
        return;
      }

      if (request.method === 'DELETE' && pathMatch) {
        const user = authenticate(db, request);
        const roomId = integer(pathMatch[0], 'roomId', { required: true, min: 1 });
        const room = getRoomRow(db, roomId);
        assert(room, 404, 'Room not found');
        assert(room.owner_id === user.user_id, 403, 'Only the room owner can delete this room');
        db.prepare('DELETE FROM ROOM WHERE room_id = ?').run(roomId);
        sendJson(response, 200, { success: true }, request);
        return;
      }

      pathMatch = matchPath(pathname, /^\/api\/rooms\/(\d+)\/images$/);
      if (request.method === 'POST' && pathMatch) {
        const user = authenticate(db, request);
        const roomId = integer(pathMatch[0], 'roomId', { required: true, min: 1 });
        const room = getRoomRow(db, roomId);
        assert(room, 404, 'Room not found');
        assert(room.owner_id === user.user_id, 403, 'Only the room owner can add images');
        const body = await readJson(request);
        const imageUrl = webUrl(body.imageUrl, 'imageUrl', { required: true });
        const count = db.prepare('SELECT COUNT(*) AS count FROM ROOM_IMAGE WHERE room_id = ?').get(roomId).count;
        assert(count < 12, 409, 'A room cannot have more than 12 images');
        const imageOrder = body.imageOrder === undefined
          ? Number(db.prepare('SELECT COALESCE(MAX(image_order), -1) + 1 AS next_order FROM ROOM_IMAGE WHERE room_id = ?').get(roomId).next_order)
          : integer(body.imageOrder, 'imageOrder', { min: 0, max: 11 });
        const result = db.prepare('INSERT INTO ROOM_IMAGE (room_id, image_url, image_order) VALUES (?, ?, ?)').run(roomId, imageUrl, imageOrder);
        sendJson(response, 201, { image: { imageId: Number(result.lastInsertRowid), imageUrl, imageOrder } }, request);
        return;
      }

      pathMatch = matchPath(pathname, /^\/api\/rooms\/(\d+)\/images\/(\d+)$/);
      if (request.method === 'DELETE' && pathMatch) {
        const user = authenticate(db, request);
        const roomId = integer(pathMatch[0], 'roomId', { required: true, min: 1 });
        const imageId = integer(pathMatch[1], 'imageId', { required: true, min: 1 });
        const room = getRoomRow(db, roomId);
        assert(room, 404, 'Room not found');
        assert(room.owner_id === user.user_id, 403, 'Only the room owner can remove images');
        const result = db.prepare('DELETE FROM ROOM_IMAGE WHERE image_id = ? AND room_id = ?').run(imageId, roomId);
        assert(result.changes > 0, 404, 'Image not found');
        sendJson(response, 200, { success: true }, request);
        return;
      }

      if (request.method === 'GET' && pathname === '/api/my/rooms') {
        const user = authenticate(db, request);
        const rows = db.prepare(`${ROOM_SELECT} WHERE r.owner_id = ? ORDER BY r.created_at DESC, r.room_id DESC`).all(user.user_id);
        sendJson(response, 200, { rooms: rows.map((row) => roomDto(row, imageRows(db, row.room_id), { currentUserId: user.user_id })) }, request);
        return;
      }

      pathMatch = matchPath(pathname, /^\/api\/rooms\/(\d+)\/requests$/);
      if (request.method === 'POST' && pathMatch) {
        const user = authenticate(db, request);
        const roomId = integer(pathMatch[0], 'roomId', { required: true, min: 1 });
        const room = getRoomRow(db, roomId);
        assert(room, 404, 'Room not found');
        assert(room.owner_id !== user.user_id, 409, 'You cannot request to join your own room');
        assert(room.status === 'available' && room.capacity > Number(room.member_count) + 1, 409, 'This room has no available place');
        assert(!db.prepare("SELECT 1 FROM ROOM_MEMBER WHERE room_id = ? AND user_id = ? AND status = 'approved'").get(roomId, user.user_id), 409, 'You are already a member of this room');
        assert(!db.prepare("SELECT 1 FROM ROOM_REQUEST WHERE room_id = ? AND user_id = ? AND status = 'pending'").get(roomId, user.user_id), 409, 'A pending request already exists');
        const result = db.prepare("INSERT INTO ROOM_REQUEST (user_id, room_id, status) VALUES (?, ?, 'pending')").run(user.user_id, roomId);
        const row = db.prepare(requestSelect('WHERE rr.request_id = ?')).get(Number(result.lastInsertRowid));
        sendJson(response, 201, { request: requestDto(row) }, request);
        return;
      }

      if (request.method === 'GET' && pathname === '/api/requests/mine') {
        const user = authenticate(db, request);
        const rows = db.prepare(`${requestSelect('WHERE rr.user_id = ?')} ORDER BY rr.requested_at DESC, rr.request_id DESC`).all(user.user_id);
        sendJson(response, 200, { requests: rows.map(requestDto) }, request);
        return;
      }

      if (request.method === 'GET' && pathname === '/api/owner/requests') {
        const user = authenticate(db, request);
        const rows = db.prepare(`${requestSelect('WHERE room.owner_id = ?')} ORDER BY rr.requested_at DESC, rr.request_id DESC`).all(user.user_id);
        sendJson(response, 200, { requests: rows.map(requestDto) }, request);
        return;
      }

      pathMatch = matchPath(pathname, /^\/api\/requests\/(\d+)$/);
      if (request.method === 'PATCH' && pathMatch) {
        const owner = authenticate(db, request);
        const requestId = integer(pathMatch[0], 'requestId', { required: true, min: 1 });
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
            db.prepare("UPDATE ROOM_REQUEST SET status = 'rejected', responded_at = CURRENT_TIMESTAMP WHERE request_id = ? AND status = 'pending'").run(requestId);
          } else {
            assert(joinRequest.user_id !== owner.user_id, 409, 'A room owner cannot match with themselves');
            assert(joinRequest.room_status !== 'inactive', 409, 'Inactive rooms cannot accept requests');
            assert(Number(joinRequest.member_count) + 1 < joinRequest.capacity, 409, 'This room has reached capacity');
            assert(!db.prepare("SELECT 1 FROM ROOM_MEMBER WHERE room_id = ? AND user_id = ? AND status = 'approved'").get(joinRequest.room_id, joinRequest.user_id), 409, 'The requester is already a room member');
            assert(!db.prepare('SELECT 1 FROM MATCHES WHERE room_id = ? AND ((initiator_user_id = ? AND completer_user_id = ?) OR (initiator_user_id = ? AND completer_user_id = ?))').get(
              joinRequest.room_id, joinRequest.user_id, owner.user_id, owner.user_id, joinRequest.user_id,
            ), 409, 'A match already exists for these users and room');

            const changed = db.prepare("UPDATE ROOM_REQUEST SET status = 'approved', responded_at = CURRENT_TIMESTAMP WHERE request_id = ? AND status = 'pending'").run(requestId);
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
        return;
      }

      pathMatch = matchPath(pathname, /^\/api\/rooms\/(\d+)\/members$/);
      if (request.method === 'GET' && pathMatch) {
        const user = authenticate(db, request);
        const roomId = integer(pathMatch[0], 'roomId', { required: true, min: 1 });
        const room = getRoomRow(db, roomId);
        assert(room, 404, 'Room not found');
        const isMember = db.prepare("SELECT 1 FROM ROOM_MEMBER WHERE room_id = ? AND user_id = ? AND status = 'approved'").get(roomId, user.user_id);
        assert(room.owner_id === user.user_id || isMember, 403, 'Only the room owner or a member can view members');
        const memberRows = db.prepare(`
          SELECT u.*, 'owner' AS membership_status, room.created_at AS joined_at
          FROM ROOM room JOIN USER u ON u.user_id = room.owner_id WHERE room.room_id = ?
          UNION ALL
          SELECT u.*, rm.status AS membership_status, rm.joined_at
          FROM ROOM_MEMBER rm JOIN USER u ON u.user_id = rm.user_id
          WHERE rm.room_id = ? AND rm.status = 'approved'
          ORDER BY joined_at
        `).all(roomId, roomId);
        const members = memberRows.map((row) => ({
          ...userDto(row),
          status: row.membership_status,
          joinedAt: row.joined_at,
        }));
        sendJson(response, 200, { members }, request);
        return;
      }

      if (request.method === 'GET' && pathname === '/api/matches') {
        const user = authenticate(db, request);
        const rows = db.prepare(`
          ${matchSelect()}
          WHERE m.initiator_user_id = ? OR m.completer_user_id = ?
          ORDER BY m.matched_at DESC, m.match_id DESC
        `).all(user.user_id, user.user_id);
        sendJson(response, 200, { matches: rows.map((row) => matchDto(row, user.user_id)) }, request);
        return;
      }

      if (pathname === '/api/friends' || pathname.startsWith('/api/friends/')) {
        await handleFriendRoutes({ db, request, response, url, user: authenticate(db, request), readJson, sendJson });
        return;
      }
      if (pathname.startsWith('/api/')) throw new HttpError(404, 'Endpoint not found');
      if (sendStatic(response, request, pathname, staticDirectory)) return;
      throw new HttpError(404, 'Page not found');
    } catch (error) {
      if (error instanceof HttpError) {
        sendJson(response, error.status, { error: error.message }, request);
        return;
      }
      logger.error?.(error);
      sendJson(response, 500, { error: 'Internal server error' }, request);
    }
  };
}

export function createRoomMatchServer(options = {}) {
  validateAuthConfiguration();
  const db = options.db ?? openDatabase(options.database);
  const server = createServer(createRequestHandler(db, options));
  server.on('close', () => {
    if (!options.db) db.close();
  });
  return { server, db };
}

export async function startRoomMatchServer(options = {}) {
  const host = options.host ?? process.env.ROOMMATCH_HOST ?? process.env.HOST ?? '127.0.0.1';
  const port = options.port ?? Number(process.env.ROOMMATCH_PORT ?? process.env.PORT ?? 3001);
  const application = createRoomMatchServer(options);
  await new Promise((resolve, reject) => {
    application.server.once('error', reject);
    application.server.listen(port, host, resolve);
  });
  return application;
}
