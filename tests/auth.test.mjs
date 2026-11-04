import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { createToken, validateAuthConfiguration, verifyToken } from '../server/auth.js';
import { openDatabase } from '../server/database.js';

test('reject known example signing key and fail closed in production', () => {
  const secret = process.env.ROOMMATCH_TOKEN_SECRET;
  const environment = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'development';
    process.env.ROOMMATCH_TOKEN_SECRET = 'replace-with-a-long-random-secret';
    const payload = Buffer.from(JSON.stringify({ sub: 1, exp: 9999999999 })).toString('base64url');
    const signature = createHmac('sha256', process.env.ROOMMATCH_TOKEN_SECRET).update(payload).digest('base64url');
    assert.throws(() => verifyToken(`${payload}.${signature}`), /Invalid or expired/);
    assert.equal(verifyToken(createToken(1)), 1);
    process.env.NODE_ENV = 'production';
    for (const invalid of ['', 'short', 'replace-with-a-long-random-secret']) {
      process.env.ROOMMATCH_TOKEN_SECRET = invalid;
      assert.throws(validateAuthConfiguration, /ROOMMATCH_TOKEN_SECRET/);
    }
    process.env.ROOMMATCH_TOKEN_SECRET = 'audit-only-valid-secret-32-characters-long';
    validateAuthConfiguration();
    const productionDatabase = openDatabase({ filename: ':memory:' });
    try { assert.equal(productionDatabase.prepare('SELECT count(*) AS count FROM USER').get().count, 0); }
    finally { productionDatabase.close(); }
    assert.equal(verifyToken(createToken(1)), 1);
    for (const body of [{ sub: 1 }, { sub: 0, exp: 9999999999 }, { sub: 1, exp: '9999999999' }, { sub: 1, exp: 1 }]) {
      const encoded = Buffer.from(JSON.stringify(body)).toString('base64url');
      const signed = createHmac('sha256', process.env.ROOMMATCH_TOKEN_SECRET).update(encoded).digest('base64url');
      assert.throws(() => verifyToken(`${encoded}.${signed}`), /Invalid or expired/);
    }
  } finally {
    if (secret === undefined) delete process.env.ROOMMATCH_TOKEN_SECRET; else process.env.ROOMMATCH_TOKEN_SECRET = secret;
    if (environment === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = environment;
  }
});
