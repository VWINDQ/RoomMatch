import { assert } from './errors.js';

export function roomPagination(searchParams, { pageSize = 12, maxPageSize = 100, legacyLimit = null } = {}) {
  const paginated = searchParams.has('page') || searchParams.has('pageSize');
  const positive = (name, fallback, max = Number.MAX_SAFE_INTEGER) => {
    const value = searchParams.get(name) ?? String(fallback);
    assert(/^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)), 400, `${name} must be a positive integer`);
    assert(Number(value) <= max, 400, `${name} must be at most ${max}`);
    return Number(value);
  };
  assert(!paginated || (!searchParams.has('limit') && !searchParams.has('offset')), 400, 'Use page/pageSize or limit/offset, not both');
  if (paginated) return { paginated, page: positive('page', 1), limit: positive('pageSize', pageSize, maxPageSize), offset: 0 };
  // Personal lists historically returned all records. Keep that contract for callers
  // that have not opted into pagination, while Rooms retains its legacy 100 cap.
  if (legacyLimit === null) return { paginated, page: 1, limit: null, offset: 0 };
  const rawLimit = searchParams.get('limit') ?? legacyLimit;
  const limit = Number(rawLimit);
  assert(rawLimit !== '' && Number.isSafeInteger(limit) && limit >= 1 && limit <= 100, 400, 'limit must be an integer from 1 to 100');
  const offset = Number(searchParams.get('offset') ?? 0);
  assert(searchParams.get('offset') !== '' && Number.isSafeInteger(offset) && offset >= 0, 400, 'offset must be a non-negative integer');
  return { paginated, page: 1, limit, offset };
}

export async function selectRoomPage(db, { select, conditions, parameters, order, pagination }) {
  const { paginated, page: requestedPage, limit, offset } = pagination;
  // Count, canonical page, and rows share one PostgreSQL snapshot, including when
  // the final item was removed. Order is selected by server-side allowlists only.
  const result = await db.prepare(`
    WITH filtered AS (${select} WHERE ${conditions.join(' AND ')}),
    totals AS (SELECT COUNT(*) AS total FROM filtered),
    paging AS (
      SELECT total, LEAST(?::bigint, GREATEST(1, CEIL(total::numeric / ?::integer)))::bigint AS page
      FROM totals
    )
    SELECT selected.*, paging.total, paging.page
    FROM paging LEFT JOIN LATERAL (
      SELECT * FROM filtered ORDER BY ${order}
      LIMIT ? OFFSET ${paginated ? '(SELECT (page - 1) * ? FROM paging)' : '?'}
    ) selected ON true
    ORDER BY ${order}
  `).all(...parameters, requestedPage, limit, limit, paginated ? limit : offset);
  const { total, page } = result[0];
  return {
    rows: result.filter(row => row.room_id !== null),
    metadata: { total, ...(paginated ? { page, pageSize: limit, totalPages: Math.ceil(total / limit) } : {}) },
  };
}
