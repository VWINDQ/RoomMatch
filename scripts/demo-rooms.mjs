import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { hashPassword } from '../server/auth.js';
import { quoteIdentifier } from '../server/database.js';
import { validateListing } from '../shared/listingValidation.js';

export const demoEmail = 'rm12-demo-owner@roommatch.invalid';
const marker = '[เดโม RM12]';
const tables = { owner: ['USER', 'user_id'], rooms: ['room', 'room_id'], images: ['room_image', 'image_id'] };
const fingerprint = text => createHash('sha256').update(text).digest('hex');
const fail = message => { throw new Error(message); };

export function demoListings(origin) {
  const url = new URL(origin);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) fail('Demo image origin must be a local HTTP origin');
  const districts = ['บางมด', 'ประชาอุทิศ', 'บางปะกอก', 'ราษฎร์บูรณะ', 'ทุ่งครุ', 'สุขสวัสดิ์'];
  const names = ['ห้องสตูดิโอแสงเช้า', 'อพาร์ตเมนต์สวนสงบ', 'ห้องพักริมระเบียง', 'คอนโดมุมอ่านหนังสือ', 'ห้องพักบ้านอุ่นใจ'];
  return Array.from({ length: 30 }, (_, index) => {
    const locality = districts[index % districts.length];
    const listing = {
      title: `${marker} ${names[Math.floor(index / 6)]} ${locality} ${String(index + 1).padStart(2, '0')}`,
      description: 'ข้อมูลตัวอย่างเพื่อทดลองค้นหาและแบ่งหน้า ไม่ใช่ประกาศให้เช่าจริง\nห้องพร้อมเฟอร์นิเจอร์ มีพื้นที่อ่านหนังสือและระเบียง เหมาะสำหรับนักศึกษา',
      googleMapsUrl: 'https://maps.google.com/?q=13.6518,100.4957',
      price: 2500 + (index % 10) * 500,
      capacity: 2 + (index % 4),
      priceBasis: index % 2 ? 'per_person' : 'per_room', locality,
      costNotes: index % 2 ? 'ค่าน้ำ 100 บาทต่อคน ค่าไฟตามมิเตอร์ (ข้อมูลเดโม)' : 'ค่าน้ำและค่าไฟชำระแยกตามการใช้งาน (ข้อมูลเดโม)',
      images: [`${url.origin}/assets/room-main.png`], status: 'available',
    };
    if (Object.keys(validateListing(listing)).length) fail('Demo listing failed shared validation');
    return listing;
  });
}

async function snapshot(client, table, column, id) {
  const result = await client.query(`SELECT to_jsonb(t)::text AS snapshot FROM ${quoteIdentifier(table)} t WHERE ${quoteIdentifier(column)}=$1`, [id]);
  return result.rows[0] ? { id: String(id), fingerprint: fingerprint(result.rows[0].snapshot) } : null;
}

// Lock every incoming FK table too: no new user interaction can race the check/delete.
async function lockDependencies(client) {
  const { rows } = await client.query(`SELECT ns.nspname AS schema, child.relname AS child,
      parent.relname AS parent, array_agg(att.attname::text ORDER BY keys.ordinality) AS columns
    FROM pg_constraint fk JOIN pg_class child ON child.oid=fk.conrelid
    JOIN pg_namespace ns ON ns.oid=child.relnamespace JOIN pg_class parent ON parent.oid=fk.confrelid
    JOIN pg_namespace pn ON pn.oid=parent.relnamespace
    CROSS JOIN LATERAL unnest(fk.conkey) WITH ORDINALITY keys(attnum, ordinality)
    JOIN pg_attribute att ON att.attrelid=child.oid AND att.attnum=keys.attnum
    WHERE fk.contype='f' AND pn.nspname=current_schema() AND parent.relname IN ('USER','room','room_image')
    GROUP BY fk.oid,ns.nspname,child.relname,parent.relname`);
  const schema = (await client.query('SELECT current_schema() AS schema')).rows[0].schema;
  const locks = new Set(Object.values(tables).map(([table]) => `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`));
  for (const row of rows) locks.add(`${quoteIdentifier(row.schema)}.${quoteIdentifier(row.child)}`);
  await client.query(`LOCK TABLE ${[...locks].sort().join(',')} IN SHARE ROW EXCLUSIVE MODE`);
  return rows;
}

export async function manageDemoRooms(client, { action, manifestPath, origin = 'http://localhost:5173' }) {
  if (!['seed', 'cleanup'].includes(action)) fail('Use seed or cleanup');
  let manifest;
  try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const target = (await client.query('SELECT current_database() AS database, current_schema() AS schema')).rows[0];
  if (manifest && (manifest.version !== 1 || manifest.database !== target.database || manifest.schema !== target.schema)) fail('Manifest target mismatch');
  if (action === 'cleanup' && !manifest) return { removed: 0, ownerRemoved: 0 };
  let createdManifest = false;
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('roommatch:rm12-demo',0))");
    const dependencies = await lockDependencies(client);
    if (manifest) {
      for (const [key, [table, column]] of Object.entries(tables)) {
        for (const record of key === 'owner' ? [manifest.owner] : manifest[key]) {
          const current = await snapshot(client, table, column, record.id);
          if (current && current.fingerprint !== record.fingerprint) fail(`Tracked ${key} changed; refusing to modify or delete`);
          if (!current && action === 'seed') fail('Tracked demo data is missing; run cleanup before seeding again');
        }
      }
    }
    if (action === 'seed' && manifest) {
      await client.query('COMMIT');
      return { added: 0, existing: manifest.rooms.length, ownerId: manifest.owner.id, roomIds: manifest.rooms.map(room => room.id) };
    }
    if (action === 'cleanup') {
      const ids = { USER: [manifest.owner.id], room: manifest.rooms.map(row => row.id), room_image: manifest.images.map(row => row.id) };
      for (const fk of dependencies) {
        if (fk.columns.length !== 1) fail('Unknown composite dependency; cleanup refused');
        const column = fk.columns[0];
        let sql = `SELECT COUNT(*)::int AS count FROM ${quoteIdentifier(fk.schema)}.${quoteIdentifier(fk.child)} WHERE ${quoteIdentifier(column)}=ANY($1::bigint[])`;
        const values = [ids[fk.parent]];
        // Only the exact recorded room/image rows are allowed to cascade.
        if (fk.schema === target.schema && ((fk.child === 'room' && column === 'owner_id') || (fk.child === 'room_image' && column === 'room_id'))) {
          const key = fk.child === 'room' ? 'rooms' : 'images';
          sql += ` AND ${quoteIdentifier(tables[key][1])}<>ALL($2::bigint[])`;
          values.push(manifest[key].map(row => row.id));
        }
        if ((await client.query(sql, values)).rows[0].count) fail(`Related records exist in ${fk.child}; cleanup refused without deleting anything`);
      }
      await client.query('DELETE FROM room_image WHERE image_id=ANY($1::bigint[])', [ids.room_image]);
      const rooms = await client.query('DELETE FROM room WHERE room_id=ANY($1::bigint[])', [ids.room]);
      const owner = await client.query('DELETE FROM "USER" WHERE user_id=$1', [manifest.owner.id]);
      await client.query('COMMIT');
      await unlink(manifestPath);
      return { removed: rooms.rowCount, ownerRemoved: owner.rowCount };
    }
    if ((await client.query('SELECT 1 FROM "USER" WHERE lower(email)=$1', [demoEmail])).rowCount) fail('Demo email already exists without an owned manifest; refusing to reuse it');
    await readFile(new URL('../public/assets/room-main.png', import.meta.url));
    const passwordHash = await hashPassword(randomBytes(32).toString('base64url'));
    const owner = (await client.query(`INSERT INTO "USER"(first_name,last_name,phone,email,password_hash,bio)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING user_id`, ['เจ้าของเดโม', 'ทดสอบแบ่งหน้า', '0000000000', demoEmail, passwordHash, `${marker} บัญชีเฉพาะสคริปต์ demo-rooms ไม่ใช่ผู้ให้เช่าจริง`])).rows[0];
    manifest = { version: 1, ...target, email: demoEmail, owner: await snapshot(client, 'USER', 'user_id', owner.user_id), rooms: [], images: [] };
    for (const listing of demoListings(origin)) {
      const room = (await client.query(`INSERT INTO room(owner_id,description,google_maps_url,price,capacity,price_basis,locality,cost_notes,status)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING room_id`, [owner.user_id, `${listing.title}\n${listing.description}`, listing.googleMapsUrl, listing.price, listing.capacity, listing.priceBasis, listing.locality, listing.costNotes, listing.status])).rows[0];
      const image = (await client.query('INSERT INTO room_image(room_id,image_url,image_order) VALUES($1,$2,0) RETURNING image_id', [room.room_id, listing.images[0]])).rows[0];
      manifest.rooms.push(await snapshot(client, 'room', 'room_id', room.room_id));
      manifest.images.push(await snapshot(client, 'room_image', 'image_id', image.image_id));
    }
    // Persist ownership before COMMIT so a process crash cannot orphan committed demos.
    // If a crash rolls back, cleanup tolerates missing recorded IDs and removes the ledger.
    await mkdir(dirname(manifestPath), { recursive: true });
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
    createdManifest = true;
    await client.query('COMMIT');
    return { added: 30, ownerId: manifest.owner.id, roomIds: manifest.rooms.map(room => room.id) };
  } catch (error) {
    await client.query('ROLLBACK');
    // Retain a written manifest even after a connection failure: COMMIT may have succeeded.
    if (createdManifest) error.message += '; ownership manifest retained for safe recovery';
    throw error;
  }
}

async function main() {
  try { process.loadEnvFile('.env'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const url = new URL(process.env.DATABASE_URL);
  if (process.env.NODE_ENV === 'production' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || /(?:test|prod)/i.test(url.pathname)) fail('Only a local development DATABASE_URL is allowed');
  const target = { host: url.hostname, port: url.port || '5432', database: decodeURIComponent(url.pathname.slice(1)) };
  console.log('Development target:', JSON.stringify(target));
  const client = new pg.Client({ connectionString: url.href, options: '-c search_path=public,pg_catalog -c timezone=UTC', connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    const actual = (await client.query('SELECT current_database() AS database, current_schema() AS schema')).rows[0];
    if (actual.database !== target.database || actual.schema !== 'public') fail('Connected database differs from development target');
    const key = fingerprint(JSON.stringify(target)).slice(0, 16);
    const manifestPath = resolve(`tmp/rm12-demo-${key}.json`);
    const result = await manageDemoRooms(client, { action: process.argv[2], manifestPath, origin: process.argv[3] });
    console.log(JSON.stringify({ ...result, email: demoEmail, manifestPath }, null, 2));
  } finally { await client.end(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.code ? `Demo operation failed (${error.code}); no credentials logged` : error.message); process.exitCode = 1; });
}
