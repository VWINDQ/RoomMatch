import { fileURLToPath } from 'node:url';

import { startRoomMatchServer } from './app.js';

try {
  process.loadEnvFile?.('.env');
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

export { createRequestHandler, createRoomMatchServer, startRoomMatchServer } from './app.js';
export { openDatabase, runMigrations, seedDatabase } from './database.js';

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { server } = await startRoomMatchServer();
  const address = server.address();
  console.log(`RoomMatch API listening on http://${address.address}:${address.port}`);
}
