import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase, BUSINESS_TABLES, tableIdentifier, quoteIdentifier, resetSequences } from '../server/database.js';

// An explicit, one-way import. The source is opened read-only and the destination
// must be empty. All destination writes (including trigger changes) are atomic.
export async function importSqlite({ source, connectionString, schema = 'public' }) {
  if (!source || source === ':memory:') throw new Error('An existing SQLite source file is required');
  const sqlite = new DatabaseSync(resolve(source), { readOnly: true, enableForeignKeyConstraints: true });
  let db;
  try {
    sqlite.exec('BEGIN');
    if (sqlite.prepare('PRAGMA quick_check').get().quick_check !== 'ok') throw new Error('SQLite integrity check failed');
    if (sqlite.prepare('PRAGMA foreign_key_check').all().length) throw new Error('SQLite contains invalid foreign keys');
    const rows = new Map();
    for (const table of BUSINESS_TABLES) {
      if (!sqlite.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(table)) {
        if (['FRIEND_CONNECTION', 'ROOM_FAVORITE'].includes(table)) { rows.set(table, []); continue; }
        throw new Error(`SQLite source is missing required table ${table}`);
      }
      rows.set(table, sqlite.prepare(`SELECT * FROM "${table}"`).all());
    }
    db = await openDatabase({ connectionString, schema, seed: false });
    const counts = {};
    await db.transaction(async () => {
      await db.exec(`LOCK TABLE ${BUSINESS_TABLES.map(tableIdentifier).join(', ')} IN ACCESS EXCLUSIVE MODE`);
      for (const table of BUSINESS_TABLES) {
        if ((await db.prepare(`SELECT COUNT(*) AS n FROM ${tableIdentifier(table)}`).get()).n) {
          throw new Error('PostgreSQL destination must be empty; existing data will not be overwritten');
        }
        // FK/check/unique constraints stay enabled. Historical rows are checked
        // below, rather than treated as new requests against already-full rooms.
        await db.exec(`ALTER TABLE ${tableIdentifier(table)} DISABLE TRIGGER USER`);
      }
      for (const table of BUSINESS_TABLES) {
        for (const row of rows.get(table)) {
          const columns = Object.keys(row);
          await db.prepare(`INSERT INTO ${tableIdentifier(table)} (${columns.map(quoteIdentifier).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`).run(...Object.values(row));
        }
        counts[table] = rows.get(table).length;
      }
      const invalid = await db.prepare(`SELECT
        EXISTS (SELECT 1 FROM ROOM r WHERE r.capacity < 1 + (SELECT COUNT(*) FROM ROOM_MEMBER m WHERE m.room_id=r.room_id AND m.status='approved')) AS overbooked,
        EXISTS (SELECT 1 FROM ROOM_MEMBER m JOIN ROOM r ON r.room_id=m.room_id WHERE m.user_id=r.owner_id OR (m.status='approved' AND NOT EXISTS (SELECT 1 FROM ROOM_REQUEST q WHERE q.user_id=m.user_id AND q.room_id=m.room_id AND q.status='approved'))) AS invalid_member,
        EXISTS (SELECT 1 FROM MATCHES m JOIN ROOM r ON r.room_id=m.room_id WHERE m.initiator_user_id<>r.owner_id OR NOT EXISTS (SELECT 1 FROM ROOM_MEMBER member WHERE member.room_id=m.room_id AND member.user_id=m.completer_user_id)) AS invalid_match,
        EXISTS (SELECT 1 FROM ROOM r WHERE r.status<>'inactive' AND (r.status='full') <> (r.capacity <= 1 + (SELECT COUNT(*) FROM ROOM_MEMBER m WHERE m.room_id=r.room_id AND m.status='approved'))) AS invalid_status
      `).get();
      if (Object.values(invalid).some(Boolean)) throw new Error(`SQLite business invariants failed: ${Object.keys(invalid).filter(key => invalid[key]).join(', ')}`);
      for (const table of BUSINESS_TABLES) await db.exec(`ALTER TABLE ${tableIdentifier(table)} ENABLE TRIGGER USER`);
      await resetSequences(db);
    });
    return counts;
  } finally {
    sqlite.exec('ROLLBACK');
    sqlite.close();
    if (db) await db.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try { process.loadEnvFile('.env'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--source' || !process.env.DATABASE_URL) {
    console.error('Usage: npm run db:import:sqlite -- --source /absolute/path/roommatch.sqlite (requires DATABASE_URL)');
    process.exitCode = 1;
  } else {
    try {
      const counts = await importSqlite({ source: args[1], connectionString: process.env.DATABASE_URL });
      console.log('SQLite import completed. Source unchanged. Imported rows:', counts);
    } catch (error) {
      console.error('SQLite import failed; destination data transaction rolled back:', error.message);
      process.exitCode = 1;
    }
  }
}
