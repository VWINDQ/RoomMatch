import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { resolve, join, basename, dirname } from 'node:path';
import pg from 'pg';
import { testConnectionString } from '../support/postgres-fixtures.mjs';
import { quoteIdentifier } from '../../server/database.js';

// A run-owned ledger permits cleanup even when Playwright replaces a failed worker.
// It contains schema names only, never URLs, tokens or browser authentication state.
export default async function setup() {
  await mkdir(resolve('tmp'), { recursive: true });
  const directory = await mkdtemp(resolve('tmp/roommatch-e2e-'));
  process.env.ROOMMATCH_E2E_RESOURCES = directory;
  return async () => {
    if (dirname(directory) !== resolve('tmp') || !basename(directory).startsWith('roommatch-e2e-')) throw new Error('Unsafe E2E resource directory');
    const pool = new pg.Pool({ connectionString: testConnectionString() });
    try {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.isDirectory() && /^rm_test_[a-f0-9]{10}_[a-f0-9]{16}-uploads$/.test(entry.name)) continue;
        const filename = entry.name;
        const schema = await readFile(join(directory, filename), 'utf8');
        if (!/^rm_test_[a-f0-9]{10}_[a-f0-9]{16}$/.test(schema) || filename !== `${schema}.txt`) throw new Error('Unsafe E2E schema ledger');
        await pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`);
      }
    } finally { await pool.end(); }
    await rm(directory, { recursive: true });
  };
}
