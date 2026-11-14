import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function migrationNumber(filename) {
  const match = /^(\d+)/.exec(filename);
  return match ? Number(match[1]) : null;
}

export function runMigrations(db, migrationsDirectory = resolve(projectRoot, 'database/migrations')) {
  if (!existsSync(migrationsDirectory)) {
    throw new Error(`Migration directory not found: ${migrationsDirectory}`);
  }

  const currentVersion = db.prepare('PRAGMA user_version').get().user_version;
  const migrations = readdirSync(migrationsDirectory)
    .filter((filename) => filename.endsWith('.sql') && migrationNumber(filename) !== null)
    .map((filename) => ({ filename, version: migrationNumber(filename) }))
    .sort((left, right) => left.version - right.version || left.filename.localeCompare(right.filename));

  // A filename ledger permits a teammate's earlier-numbered migration to arrive
  // after this branch has advanced user_version (e.g. Favorites 004 after UX 005).
  db.exec('BEGIN IMMEDIATE');
  try {
    const hasLedger = db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = '_roommatch_migrations'").get();
    db.exec(`CREATE TABLE IF NOT EXISTS _roommatch_migrations (
      filename TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) STRICT`);
    if (!hasLedger) {
      const remember = db.prepare('INSERT OR IGNORE INTO _roommatch_migrations(filename) VALUES (?)');
      for (const migration of migrations) if (migration.version <= currentVersion) remember.run(migration.filename);
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }

  for (const migration of migrations) {
    const sql = readFileSync(resolve(migrationsDirectory, migration.filename), 'utf8');
    db.exec('BEGIN IMMEDIATE');
    try {
      if (!db.prepare('SELECT 1 FROM _roommatch_migrations WHERE filename = ?').get(migration.filename)) {
        db.exec(sql);
        db.prepare('INSERT INTO _roommatch_migrations(filename) VALUES (?)').run(migration.filename);
        const version = db.prepare('PRAGMA user_version').get().user_version;
        db.exec(`PRAGMA user_version = ${Math.max(version, migration.version)}`);
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${migration.filename} failed`, { cause: error });
    }
  }
}

export function seedDatabase(db, seedPath = resolve(projectRoot, 'database/seed.sql')) {
  if (!existsSync(seedPath)) return false;
  const userCount = db.prepare('SELECT COUNT(*) AS count FROM USER').get().count;
  if (userCount > 0) return false;

  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(readFileSync(seedPath, 'utf8'));
    db.exec('COMMIT');
    return true;
  } catch (error) {
    db.exec('ROLLBACK');
    throw new Error('Database seed failed', { cause: error });
  }
}

export function openDatabase(options = {}) {
  const filename = options.filename ?? process.env.ROOMMATCH_DB_PATH ?? resolve(projectRoot, 'database/roommatch.sqlite');
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });

  const db = new DatabaseSync(filename, { enableForeignKeyConstraints: true });
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');

  if (options.migrate !== false) runMigrations(db, options.migrationsDirectory);
  if (options.seed ?? (process.env.NODE_ENV !== 'production')) seedDatabase(db, options.seedPath);
  return db;
}
