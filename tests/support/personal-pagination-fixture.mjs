export async function seedPersonalPagination(db, count = 125, { ownerId = 1, favoriteUserId = 3 } = {}) {
  if (!/^rm_test_/.test(db.schema)) throw new Error('Personal pagination fixtures require an isolated test schema');
  const rooms = await db.prepare(`INSERT INTO ROOM(owner_id,description,google_maps_url,price,capacity,price_basis,locality,cost_notes,status,created_at,owner_is_resident)
    SELECT ?::bigint, 'Private pagination ' || lpad(n::text,4,'0') || E'\nTest listing description',
      'https://maps.google.com', 1000+(n%5)*100, CASE WHEN n%3=1 THEN 1 ELSE 4 END,
      CASE WHEN n%2=0 THEN 'per_room' ELSE 'per_person' END, 'Test district', 'Test cost notes',
      CASE WHEN n%3=0 THEN 'inactive' WHEN n%3=1 THEN 'full' ELSE 'available' END,
      '2026-01-01T00:00:00Z'::timestamptz+(n%3)*interval '1 day', TRUE
    FROM generate_series(1,?::int) n RETURNING room_id,price,status,price_basis,created_at`).all(ownerId,count);
  await db.prepare(`INSERT INTO ROOM_IMAGE(room_id,image_url,image_order)
    SELECT room_id,'https://rm-fixture.invalid/private-room.svg',0 FROM ROOM WHERE room_id=ANY(?::bigint[])`).run(rooms.map(room => room.room_id));
  await db.prepare(`INSERT INTO ROOM_FAVORITE(user_id,room_id,created_at)
    SELECT ?::bigint,room_id,'2026-02-01T00:00:00Z'::timestamptz+(room_id%4)*interval '1 day'
    FROM ROOM WHERE room_id=ANY(?::bigint[])`).run(favoriteUserId,rooms.map(room => room.room_id));
  return rooms;
}
