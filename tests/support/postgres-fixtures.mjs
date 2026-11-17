import { createHash, randomBytes } from 'node:crypto';
import pg from 'pg';
import { openDatabase as openPostgres, quoteIdentifier } from '../../server/database.js';

// Every fixture gets its own schema in an explicitly designated test database.
// A stable fixture key permits real pool/server restarts without SQLite files.
const schemas = new Set();
const databases = new Set();
const namespace = randomBytes(5).toString('hex');
export function testConnectionString() {
  const value = process.env.TEST_DATABASE_URL;
  if (!value) throw new Error('TEST_DATABASE_URL is required; tests never fall back to DATABASE_URL');
  const url = new URL(value);
  if (!url.pathname.endsWith('_test')) throw new Error('TEST_DATABASE_URL must name a dedicated database ending in _test');
  return value;
}
export async function openDatabase({ filename, schema: existingSchema, ...options } = {}) {
  if (typeof filename !== 'string' || !filename) throw new Error('An explicit test fixture key is required');
  const key = filename === ':memory:' ? randomBytes(8).toString('hex') : createHash('sha256').update(filename).digest('hex').slice(0, 16);
  if (existingSchema && !schemas.has(existingSchema)) throw new Error('Cannot reopen a schema not owned by this test module');
  const schema = existingSchema ?? `rm_test_${namespace}_${key}`;
  schemas.add(schema);
  const db = await openPostgres({ connectionString: testConnectionString(), schema, seed: process.env.NODE_ENV !== 'production', ...options });
  databases.add(db);
  let readOnly = false;
  db.setReadOnly = (value) => { readOnly = value; };
  const withConnection = db.withConnection.bind(db);
  db.withConnection = (operation) => withConnection(async () => {
    await db.exec(`SET default_transaction_read_only = ${readOnly ? 'on' : 'off'}`);
    try { return await operation(); }
    finally { await db.exec('SET default_transaction_read_only = off'); }
  });
  return db;
}
export async function cleanupDatabases() {
  await Promise.all([...databases].map(db => db.close()));
  if (!schemas.size) return;
  const cleanup = new pg.Pool({ connectionString: testConnectionString() });
  try {
    for (const schema of schemas) {
      if (!schema.startsWith(`rm_test_${namespace}_`)) throw new Error('Unsafe test schema cleanup');
      await cleanup.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`);
    }
  } finally { await cleanup.end(); }
}
