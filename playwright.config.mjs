import { defineConfig } from '@playwright/test';
import { testConnectionString } from './tests/support/postgres-fixtures.mjs';

try { process.loadEnvFile('.env'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
testConnectionString(); // Fail before launching a browser; never use DATABASE_URL.
if (process.env.DATABASE_URL) {
  const development = new URL(process.env.DATABASE_URL);
  const testing = new URL(testConnectionString());
  if (development.hostname === testing.hostname && (development.port || '5432') === (testing.port || '5432') && development.pathname === testing.pathname) {
    throw new Error('E2E test database must be distinct from the development database');
  }
}

const viewports = [
  ['mobile-360', 360, 800], ['mobile-390', 390, 844], ['landscape', 844, 390],
  ['tablet-768', 768, 1024], ['tablet-820', 820, 1180], ['desktop', 1280, 800],
];

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/lifecycle.mjs',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 2,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }], ['json', { outputFile: 'test-results/results.json' }]],
  use: { browserName: 'chromium', actionTimeout: 7_000, screenshot: 'only-on-failure', trace: 'off', video: 'off' },
  projects: [
    ...viewports.map(([name, width, height]) => ({ name, testIgnore: /breakpoints/, use: { viewport: { width, height } } })),
    { name: 'breakpoints', testMatch: /breakpoints/, use: { viewport: { width: 1024, height: 800 } } },
  ],
});
