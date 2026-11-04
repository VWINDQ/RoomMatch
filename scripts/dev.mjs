import { spawn } from 'node:child_process';
import { join } from 'node:path';

try {
  process.loadEnvFile?.('.env');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const viteBinary = join(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? 'vite.cmd' : 'vite');
const children = [
  spawn(process.execPath, ['server/index.mjs'], { stdio: 'inherit', env: process.env }),
  spawn(viteBinary, process.argv.slice(2), { stdio: 'inherit', env: process.env }),
];

let shuttingDown = false;

function shutdown(signal = 'SIGTERM') {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
}

for (const child of children) {
  child.on('error', (error) => {
    console.error(`Could not start RoomMatch: ${error.message}`);
    shutdown();
    process.exitCode = 1;
  });
  child.on('exit', (code, signal) => {
    if (!shuttingDown) {
      console.error(`RoomMatch development process exited (${signal ?? code}).`);
      shutdown();
      process.exitCode = code ?? 1;
    }
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
