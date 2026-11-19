import assert from 'node:assert/strict';
import { randomBytes, scryptSync, argon2Sync } from 'node:crypto';
import { test } from 'node:test';
import { hashPassword, passwordNeedsRehash, verifyPassword } from '../server/auth.js';

test('password hashes use salted Argon2id PHC encoding and verify Unicode passwords', async () => {
  const password = 'รหัสผ่าน🔐 space ';
  const first = await hashPassword(password), second = await hashPassword(password);
  assert.match(first, /^\$argon2id\$v=19\$m=65536,t=3,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/);
  assert.notEqual(first, second);
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword(password.trim(), first), false);
  assert.equal(await verifyPassword('wrong-password', first), false);
  assert.equal(passwordNeedsRehash(first), false);
  const [, , , , salt, expected] = first.split('$');
  const actual = argon2Sync('argon2id', { message: password, nonce: Buffer.from(salt, 'base64'), memory: 65536, passes: 3, parallelism: 1, tagLength: 32 });
  assert.deepEqual(actual, Buffer.from(expected, 'base64'));
});

test('legacy scrypt remains verifiable and is marked for upgrade', async () => {
  const salt = randomBytes(16);
  const key = scryptSync('legacy-password', salt, 64, { N: 16384, r: 8, p: 1 });
  const encoded = `scrypt$16384$8$1$${salt.toString('hex')}$${key.toString('hex')}`;
  assert.equal(await verifyPassword('legacy-password', encoded), true);
  assert.equal(await verifyPassword('incorrect', encoded), false);
  assert.equal(passwordNeedsRehash(encoded), true);
  assert.equal(await verifyPassword('legacy-password', `${encoded}$extra`), false);
});

test('malformed, unsupported, null and excessive-cost hashes fail closed', async () => {
  const valid = await hashPassword('test-password');
  for (const hash of [null, undefined, '', {}, 'invalid', valid + '$extra', valid.replace('v=19', 'v=16'),
    valid.replace('argon2id', 'argon2i'), valid.replace('m=65536', 'm=999999'), valid.replace('t=3', 't=99'),
    valid.replace('p=1', 'p=0'), valid.replace('p=1', 'p=99'), valid.replace('m=65536', 'm=0')]) {
    assert.equal(await verifyPassword('test-password', hash), false);
  }
  assert.equal(await verifyPassword(null, valid), false);
});
