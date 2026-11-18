import { after } from 'node:test';
import { cleanupDatabases } from './postgres-fixtures.mjs';

export { openDatabase, testConnectionString } from './postgres-fixtures.mjs';

after(cleanupDatabases);
