import { spawn } from 'node:child_process';
try { process.loadEnvFile('.env'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (!process.env.TEST_DATABASE_URL || !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith('_test')) {
  console.error('Set TEST_DATABASE_URL to a dedicated PostgreSQL database ending in _test. See database/POSTGRESQL.md');
  process.exitCode = 1;
} else {
  const child = spawn(process.execPath, ['--test', 'server/api.test.mjs', 'tests/*.test.mjs', ...process.argv.slice(2)], { stdio: 'inherit', env: process.env });
  child.on('error', error => { console.error(error.message); process.exitCode = 1; });
  child.on('exit', (code, signal) => { process.exitCode = signal ? 1 : code; });
}
