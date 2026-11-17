// Call only with an isolated PostgreSQL test fixture, never a development pool.
export async function seedPaginationRooms(db) {
  if (!/^rm_test_/.test(db.schema)) throw new Error('Pagination fixtures require an isolated test schema');
  return db.prepare(`INSERT INTO ROOM(owner_id, google_maps_url, price, capacity, description, price_basis, locality, created_at)
    SELECT 1, 'https://maps.google.com', 1000 + (n % 5) * 100, 4,
      'RM12 fixture ' || n, CASE WHEN n % 2 = 0 THEN 'per_room' ELSE 'per_person' END,
      'RM12 district', '2026-01-01T00:00:00Z'::timestamptz
    FROM generate_series(1,125) n RETURNING room_id, price, created_at, price_basis`).all();
}
