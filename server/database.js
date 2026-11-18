import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const BUSINESS_TABLES = ['USER', 'LIFESTYLE', 'PREFERENCE', 'ROOM', 'ROOM_IMAGE', 'ROOM_REQUEST', 'ROOM_MEMBER', 'MATCHES', 'FRIEND_CONNECTION', 'ROOM_FAVORITE'];
const identityColumns = { USER: 'user_id', LIFESTYLE: 'lifestyle_id', PREFERENCE: 'preference_id', ROOM: 'room_id', ROOM_IMAGE: 'image_id', ROOM_REQUEST: 'request_id', MATCHES: 'match_id', FRIEND_CONNECTION: 'connection_id' };
export const quoteIdentifier = (name) => `"${name.replaceAll('"', '""')}"`;
export function tableIdentifier(name) {
  if (!BUSINESS_TABLES.includes(name)) throw new Error('Unknown business table');
  return quoteIdentifier(name === 'USER' ? name : name.toLowerCase());
}

// Keep the ER's USER name (a PostgreSQL keyword) and existing bound-parameter
// notation. Do not rewrite quoted values, comments, or PL/pgSQL function bodies.
export function compileSql(sql) {
  let result = '', index = 0, parameter = 0;
  while (index < sql.length) {
    const start = index;
    if (sql.startsWith('--', index)) {
      const newline = sql.indexOf('\n', index + 2);
      index = newline === -1 ? sql.length : newline;
    } else if (sql.startsWith('/*', index)) {
      let depth = 1;
      index += 2;
      while (depth && index < sql.length) {
        if (sql.startsWith('/*', index)) { depth += 1; index += 2; }
        else if (sql.startsWith('*/', index)) { depth -= 1; index += 2; }
        else index += 1;
      }
    } else if (sql[index] === "'" || sql[index] === '"') {
      const quote = sql[index++];
      const escaped = quote === "'" && /e/i.test(sql[start - 1] ?? '') && !/[\w$]/.test(sql[start - 2] ?? '');
      while (index < sql.length) {
        if (escaped && sql[index] === '\\') index += 2;
        else if (sql[index++] === quote) {
          if (sql[index] !== quote) break;
          index += 1;
        }
      }
    } else if (sql[index] === '$' && /^(\$[a-z_][a-z_0-9]*\$|\$\$)/i.test(sql.slice(index))) {
      const tag = /^(\$[a-z_][a-z_0-9]*\$|\$\$)/i.exec(sql.slice(index))[0];
      const end = sql.indexOf(tag, index + tag.length);
      index = end === -1 ? sql.length : end + tag.length;
    } else if (/[a-z_]/i.test(sql[index])) {
      index += 1;
      while (index < sql.length && /[\w$]/.test(sql[index])) index += 1;
      const identifier = sql.slice(start, index);
      if (identifier.toUpperCase() === 'USER' && !/\b(?:ENABLE|DISABLE)\s+TRIGGER\s*$/i.test(sql.slice(0, start))) {
        result += '"USER"';
        continue;
      }
    } else if (sql[index] === '?') {
      result += `$${++parameter}`;
      index += 1;
      continue;
    } else index += 1;
    result += sql.slice(start, index);
  }
  return result;
}
const queryTypes = { getTypeParser(oid, format) {
  if (format !== 'binary' && oid === 20) return (value) => {
    const number = Number(value);
    if (!Number.isSafeInteger(number)) throw new RangeError('Database integer exceeds the safe JavaScript range');
    return number;
  };
  if (format !== 'binary' && oid === 1184) return (value) => new Date(value).toISOString();
  if (format !== 'binary' && oid === 1082) return (value) => value;
  return pg.types.getTypeParser(oid, format);
} };

class PostgresDatabase {
  #scope = new AsyncLocalStorage();
  #closing;
  constructor(pool, schema) { this.pool = pool; this.schema = schema; }
  async withConnection(operation) {
    if (this.#scope.getStore()) return operation();
    const client = await this.pool.connect();
    const state = { client, inTransaction: false };
    try { return await this.#scope.run(state, operation); }
    finally {
      try { if (state.inTransaction) await client.query('ROLLBACK'); }
      finally { client.release(); }
    }
  }
  async query(sql, values = []) {
    return (this.#scope.getStore()?.client ?? this.pool).query(compileSql(sql), values);
  }
  prepare(sql) {
    return {
      get: async (...values) => (await this.query(sql, values)).rows[0],
      all: async (...values) => (await this.query(sql, values)).rows,
      run: async (...values) => {
        const result = await this.query(sql, values);
        return { changes: result.rowCount, insertId: result.rows[0] && Object.values(result.rows[0])[0] };
      },
    };
  }
  async exec(sql) {
    const state = this.#scope.getStore();
    if (/^\s*BEGIN\s*;?\s*$/i.test(sql) && !state) throw new Error('Transactions require withConnection()');
    const result = await this.query(sql);
    if (state && /^\s*BEGIN\s*;?\s*$/i.test(sql)) state.inTransaction = true;
    if (state && /^\s*(COMMIT|ROLLBACK)\s*;?\s*$/i.test(sql)) state.inTransaction = false;
    return result;
  }
  async transaction(operation) {
    return this.withConnection(async () => {
      await this.exec('BEGIN');
      try { const result = await operation(); await this.exec('COMMIT'); return result; }
      catch (error) { await this.exec('ROLLBACK'); throw error; }
    });
  }
  close() { this.#closing ??= this.pool.end(); return this.#closing; }
}

export async function runMigrations(db, directory = resolve(projectRoot, 'database/postgresql/migrations')) {
  await db.transaction(async () => {
    await db.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))').get(`roommatch:migrations:${db.schema}`);
    await db.exec(`CREATE TABLE IF NOT EXISTS _roommatch_migrations (
      filename TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
    )`);
    for (const filename of readdirSync(directory).filter((name) => /^\d.*\.sql$/.test(name)).sort()) {
      const sql = readFileSync(resolve(directory, filename), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const applied = await db.prepare('SELECT checksum FROM _roommatch_migrations WHERE filename = ?').get(filename);
      if (applied) {
        if (applied.checksum !== checksum) throw new Error(`Applied migration changed: ${filename}`);
        continue;
      }
      await db.exec(sql);
      await db.prepare('INSERT INTO _roommatch_migrations(filename, checksum) VALUES (?, ?)').run(filename, checksum);
    }
  });
}
export async function resetSequences(db) {
  for (const [table, column] of Object.entries(identityColumns)) {
    const qualified = `${quoteIdentifier(db.schema)}.${tableIdentifier(table)}`;
    await db.prepare(`SELECT setval(pg_get_serial_sequence(?, ?), COALESCE(MAX(${column}), 1), MAX(${column}) IS NOT NULL) FROM ${tableIdentifier(table)}`).get(qualified, column);
  }
}
export async function seedDatabase(db, seedPath = resolve(projectRoot, 'database/postgresql/seed.sql')) {
  return db.transaction(async () => {
    await db.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))').get(`roommatch:seed:${db.schema}`);
    if ((await db.prepare('SELECT COUNT(*) AS count FROM USER').get()).count > 0) return false;
    await db.exec(readFileSync(seedPath, 'utf8'));
    await resetSequences(db);
    return true;
  });
}
export async function openDatabase(options = {}) {
  if ('filename' in options) throw new Error('SQLite files are no longer supported by the server; configure DATABASE_URL');
  const connectionString = options.connectionString ?? process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required. See database/POSTGRESQL.md');
  const schema = options.schema ?? 'public';
  if (!/^[a-z_][a-z_0-9]{0,62}$/.test(schema) || schema.startsWith('pg_')) throw new Error('Invalid database schema');
  const pool = new pg.Pool({ connectionString, max: options.max ?? 10, connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000, options: `-c search_path=${schema},pg_catalog -c timezone=UTC`, types: queryTypes });
  pool.on('error', (error) => console.error('PostgreSQL idle connection error:', error.code ?? 'connection failed'));
  const db = new PostgresDatabase(pool, schema);
  try {
    await db.exec(`CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(schema)}`);
    if (options.migrate !== false) await runMigrations(db, options.migrationsDirectory);
    if (options.seed ?? (process.env.ROOMMATCH_SEED === undefined ? process.env.NODE_ENV !== 'production' : process.env.ROOMMATCH_SEED === 'true')) await seedDatabase(db, options.seedPath);
    return db;
  } catch (error) { await db.close(); throw error; }
}
