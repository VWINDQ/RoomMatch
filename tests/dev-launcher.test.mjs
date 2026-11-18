import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';

const run = promisify(execFile);

test('dev launcher reloads the API when server source changes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'RoomMatch API reload test '));
  try {
    await mkdir(join(directory,'scripts'));
    await mkdir(join(directory,'server'));
    await mkdir(join(directory,'node_modules','vite','bin'),{recursive:true});
    await copyFile(new URL('../scripts/dev.mjs',import.meta.url),join(directory,'scripts','dev.mjs'));
    const apiSource = version => `import {writeFileSync,appendFileSync} from 'node:fs';
      appendFileSync('api-pids',process.pid+'\\n'); writeFileSync('api-version','${version}');
      console.log('API_VERSION=${version}'); setInterval(()=>{},1000);`;
    await writeFile(join(directory,'server','index.mjs'),apiSource(1));
    await writeFile(join(directory,'node_modules','vite','bin','vite.js'),`
      const {existsSync,readFileSync,writeFileSync}=require('node:fs');
      const deadline=Date.now()+6000; let changed=false;
      const timer=setInterval(()=>{
        if(!changed && existsSync('api-version')) { changed=true; writeFileSync('server/index.mjs',${JSON.stringify(apiSource(2))}); }
        if(existsSync('api-version') && readFileSync('api-version','utf8')==='2') {
          console.log('API source reloaded'); clearInterval(timer);
        } else if(Date.now()>deadline) {console.error('API source remained stale');clearInterval(timer);process.exitCode=1;}
      },20);
    `);
    const result=await run(process.execPath,['scripts/dev.mjs'],{cwd:directory,timeout:12000,windowsHide:true});
    assert.match(result.stdout,/API_VERSION=1/);
    assert.match(result.stdout,/API_VERSION=2/);
    assert.match(result.stdout,/API source reloaded/);
  } finally {
    assert.equal(dirname(resolve(directory)),resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('RoomMatch API reload test '));
    let pids=[];
    try {pids=(await readFile(join(directory,'api-pids'),'utf8')).trim().split('\n').map(Number);} catch(error){if(error.code!=='ENOENT')throw error;}
    for(const pid of pids) {
      if(!Number.isSafeInteger(pid)||pid<=0)throw new Error('Invalid owned test process');
      try {process.kill(pid);}catch(error){if(error.code!=='ESRCH')throw error;}
    }
    await rm(directory,{recursive:true,force:true});
  }
});

test('dev launcher starts both processes and forwards arguments from a path with spaces', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'RoomMatch dev test '));
  try {
    await mkdir(join(directory, 'scripts'));
    await mkdir(join(directory, 'server'));
    await mkdir(join(directory, 'node_modules', 'vite', 'bin'), { recursive: true });
    await copyFile(new URL('../scripts/dev.mjs', import.meta.url), join(directory, 'scripts', 'dev.mjs'));

    // Finite-lived CLI fixtures exercise real child processes without opening the application database.
    await writeFile(join(directory, 'server', 'index.mjs'), `
      import { writeFileSync } from 'node:fs';
      writeFileSync('api-started', 'ready');
      console.log('API started');
      setTimeout(() => {}, 2000);
    `);
    await writeFile(join(directory, 'node_modules', 'vite', 'bin', 'vite.js'), `
      const { existsSync } = require('node:fs');
      const deadline = Date.now() + 1500;
      const timer = setInterval(() => {
        if (existsSync('api-started')) {
          console.log('VITE_ARGS=' + JSON.stringify(process.argv.slice(2)));
          clearInterval(timer);
        } else if (Date.now() >= deadline) {
          clearInterval(timer);
          process.exitCode = 1;
        }
      }, 10);
    `);

    const argumentsToForward = ['--host', '127.0.0.1', '--port', '5179', '--base', '/path with spaces/'];
    const result = await run(process.execPath, ['scripts/dev.mjs', ...argumentsToForward], {
      cwd: directory,
      timeout: 10_000,
      windowsHide: true,
    });
    assert.match(result.stdout, /API started/);
    const argsLine = result.stdout.split(/\r?\n/).find(line => line.startsWith('VITE_ARGS='));
    assert.ok(argsLine, result.stdout + result.stderr);
    assert.deepEqual(JSON.parse(argsLine.slice('VITE_ARGS='.length)), argumentsToForward);
    assert.doesNotMatch(result.stderr, /EINVAL|Could not start RoomMatch/);
  } finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('RoomMatch dev test '));
    await rm(directory, { recursive: true, force: true });
  }
});
