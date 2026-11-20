import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { test } from 'node:test';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { openDatabase } from './support/postgres.mjs';
import { runMigrations } from '../server/database.js';
import { startRoomMatchServer } from '../server/app.js';
import { verifyPassword, verifyToken } from '../server/auth.js';
import { readGoogleOAuthConfiguration, safeReturnTo } from '../server/oauth.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' };
const configuration = { clientId: 'test-google-client', clientSecret: 'test-google-secret', origin: 'http://localhost:5173' };
const json = body => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
const digest = value => createHash('sha256').update(value).digest('hex');

async function fixture(t, { seed = false, config = configuration } = {}) {
  const db = await openDatabase({ filename: ':memory:', seed });
  const codes = new Map();
  let exchanges = 0;
  const providerFetch = async (url, options) => {
    if (String(url) === 'https://www.googleapis.com/oauth2/v3/certs') return json({ keys: [jwk] });
    assert.equal(String(url), 'https://oauth2.googleapis.com/token');
    exchanges += 1;
    const params = new URLSearchParams(options.body);
    const response = codes.get(params.get('code'));
    assert.ok(response, 'only test authorization codes may be exchanged');
    assert.equal(params.get('redirect_uri'), `${config.origin}/api/auth/oauth/google/callback`);
    assert.equal(params.get('client_secret'), config.clientSecret);
    assert.equal(createHash('sha256').update(params.get('code_verifier')).digest('base64url'), response.challenge);
    if (response.networkError) throw new TypeError('Provider unavailable');
    const now = Math.floor(Date.now() / 1000);
    const payload = { iss: 'https://accounts.google.com', aud: config.clientId, sub: 'google-subject-1',
      iat: now, exp: now + 300, nonce: response.nonce, email: 'google@example.test', email_verified: true,
      given_name: 'Google', family_name: 'Student', ...response.claims };
    const input = `${Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key' })).toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
    const signature = response.badSignature ? randomBytes(256) : sign('RSA-SHA256', Buffer.from(input), privateKey);
    return json({ access_token: 'provider-access-token', token_type: 'Bearer', expires_in: 300, id_token: `${input}.${signature.toString('base64url')}` });
  };
  const app = await startRoomMatchServer({ db, port: 0, oauth: { configuration: config, fetch: providerFetch }, logger: { error() {} } });
  t.after(() => new Promise(resolve => app.server.close(resolve)));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const request = (path, options = {}) => fetch(`${base}${path}`, { redirect: 'manual', ...options });
  const start = async (returnTo = '/rooms') => {
    const response = await request(`/api/auth/oauth/google?returnTo=${encodeURIComponent(returnTo)}`);
    assert.equal(response.status, 303);
    const target = new URL(response.headers.get('location'));
    assert.equal(target.origin, 'https://accounts.google.com');
    assert.equal(target.searchParams.get('scope'), 'openid email profile');
    assert.equal(target.searchParams.get('code_challenge_method'), 'S256');
    const stateCookie = response.headers.getSetCookie().find(value => value.includes('_state='));
    assert.match(stateCookie, /HttpOnly; Path=\/; SameSite=Lax; Max-Age=600/);
    return { state: target.searchParams.get('state'), nonce: target.searchParams.get('nonce'),
      challenge: target.searchParams.get('code_challenge'), cookie: stateCookie.split(';')[0] };
  };
  const callback = (attempt, options = {}) => {
    const code = randomBytes(12).toString('hex');
    codes.set(code, { ...attempt, ...options });
    return request(`/api/auth/oauth/google/callback?state=${attempt.state}&code=${code}`, { headers: { Cookie: attempt.cookie } });
  };
  const exchange = (cookie, origin = config?.origin) => request('/api/auth/oauth/session', {
    method: 'POST', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' }, body: '{}',
  });
  return { db, request, start, callback, exchange, exchanges: () => exchanges };
}

test('Google OAuth config is optional, complete and HTTPS-only outside local development', () => {
  assert.equal(readGoogleOAuthConfiguration({}), null);
  assert.throws(() => readGoogleOAuthConfiguration({ GOOGLE_CLIENT_ID: 'id' }), /requires/);
  const env = { GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret', ROOMMATCH_PUBLIC_ORIGIN: 'http://localhost:5173' };
  assert.equal(readGoogleOAuthConfiguration(env).origin, env.ROOMMATCH_PUBLIC_ORIGIN);
  for (const origin of ['http://example.com', 'https://example.com/path', 'https://example.com?x=1', 'https://user:pass@example.com']) {
    assert.throws(() => readGoogleOAuthConfiguration({ ...env, ROOMMATCH_PUBLIC_ORIGIN: origin }));
  }
  assert.throws(() => readGoogleOAuthConfiguration({ ...env, NODE_ENV: 'production' }));
  assert.equal(readGoogleOAuthConfiguration({ ...env, NODE_ENV: 'production', ROOMMATCH_PUBLIC_ORIGIN: 'https://example.com' }).origin, 'https://example.com');
  for (const target of ['//evil.test', '/\\evil.test', 'https://evil.test', '/api/auth/login', '/auth/google/complete', '/rooms/../../login', '/rooms\n']) assert.equal(safeReturnTo(target), '/rooms');
  assert.equal(safeReturnTo('/rooms/2?tab=info#photos'), '/rooms/2?tab=info#photos');
});

test('disabled Google OAuth exposes no secrets and password sign-in still works', async t => {
  const f = await fixture(t, { config: null, seed: true });
  assert.deepEqual(await (await f.request('/api/auth/oauth/providers')).json(), { google: false });
  assert.equal((await f.request('/api/auth/oauth/google')).headers.get('location'), '/login?oauth_error=unavailable');
  const original = await f.db.prepare('SELECT * FROM USER WHERE user_id=1').get();
  assert.match(original.password_hash, /^scrypt\$/);
  const login = password => f.request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: original.email, password }) });
  assert.equal((await login('incorrect')).status, 401);
  assert.equal((await f.db.prepare('SELECT password_hash FROM USER WHERE user_id=1').get()).password_hash, original.password_hash);
  const success = await login('roommatch');
  assert.equal(success.status, 200);
  const upgraded = (await f.db.prepare('SELECT password_hash FROM USER WHERE user_id=1').get()).password_hash;
  assert.match(upgraded, /^\$argon2id\$/);
  assert.equal(await verifyPassword('roommatch', upgraded), true);
  assert.equal((await login('roommatch')).status, 200);
  assert.equal((await f.db.prepare('SELECT password_hash FROM USER WHERE user_id=1').get()).password_hash, upgraded);
});

test('Google login verifies identity and exchanges a one-time HttpOnly ticket for the normal app session', async t => {
  const f = await fixture(t);
  assert.deepEqual(await (await f.request('/api/auth/oauth/providers')).json(), { google: true });
  const attempt = await f.start('/rooms/5?tab=photos#image');
  const callback = await f.callback(attempt);
  assert.equal(callback.status, 303);
  assert.equal(callback.headers.get('location'), `${configuration.origin}/auth/google/complete?returnTo=%2Fprofile`);
  assert.equal(callback.headers.get('cache-control'), 'no-store');
  assert.equal(callback.headers.get('referrer-policy'), 'no-referrer');
  const ticket = callback.headers.getSetCookie().find(value => /_ticket=.+;/.test(value));
  assert.match(ticket, /HttpOnly; Path=\/; SameSite=Strict; Max-Age=60/);
  const cookie = ticket.split(';')[0];
  const stored = await f.db.prepare('SELECT * FROM oauth_ticket').get();
  assert.equal(stored.ticket_hash, digest(cookie.split('=')[1]));
  assert.equal((await f.exchange(cookie, 'https://evil.test')).status, 403);
  const session = await f.exchange(cookie);
  assert.equal(session.status, 200);
  const body = await session.json();
  assert.equal(verifyToken(body.token), Number(body.user.userId));
  assert.equal(body.user.email, 'google@example.test');
  assert.equal(body.user.profileSetupPending, true);
  assert.equal(body.user.password_hash, undefined);
  assert.equal((await f.exchange(cookie)).status, 401);
  const account = await f.db.prepare('SELECT * FROM USER').get();
  assert.equal(account.password_hash, null);
  const passwordLogin = await f.request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: account.email, password: 'anything' }) });
  assert.equal(passwordLogin.status, 401);
  const repeat = await f.callback(await f.start('/rooms/5?tab=photos#image'), { claims: { email: 'changed@example.test' } });
  assert.equal(new URL(repeat.headers.get('location')).searchParams.get('returnTo'), '/profile');
  const headers = { Authorization: `Bearer ${body.token}`, 'Content-Type': 'application/json' };
  assert.equal((await f.request('/api/friends', { headers })).status, 403);
  for (const dateOfBirth of ['', '2001-02-29', '2999-01-01']) {
    const invalid = await f.request('/api/profile', { method: 'PATCH', headers, body: JSON.stringify({ dateOfBirth, accountType: 'student', phone: '0812345678' }) });
    assert.equal(invalid.status, 400);
    const { fieldErrors } = await invalid.json();
    assert.ok(fieldErrors.dateOfBirth);
    assert.ok(fieldErrors.university);
  }
  const completed = await f.request('/api/profile', { method: 'PATCH', headers, body: JSON.stringify({ dateOfBirth: '2000-02-29', accountType: 'general', university: 'Stale', email: 'ignored@example.test', phone: '0812345678' }) });
  assert.equal(completed.status, 200);
  const { user } = await completed.json();
  assert.equal(user.profileSetupPending, false);
  assert.equal(user.dateOfBirth, '2000-02-29');
  assert.equal(user.university, null);
  assert.equal(user.email, 'google@example.test');
  assert.equal((await f.request('/api/friends', { headers })).status, 200);
  const returning = await f.callback(await f.start('/rooms/5?tab=photos#image'));
  assert.equal(new URL(returning.headers.get('location')).searchParams.get('returnTo'), '/rooms/5?tab=photos#image');
  assert.equal((await f.db.prepare('SELECT count(*) AS count FROM USER').get()).count, 1);
});

test('OAuth state requires its initiating browser, expires, and can only be consumed once', async t => {
  const f = await fixture(t);
  const attempt = await f.start('//evil.test');
  for (const cookie of ['', 'roommatch_oauth_state=wrong']) {
    const response = await f.callback({ ...attempt, cookie });
    assert.match(response.headers.get('location'), /oauth_error=invalid_state$/);
  }
  assert.equal(f.exchanges(), 0);
  assert.equal((await f.callback(attempt)).status, 303);
  assert.match((await f.callback(attempt)).headers.get('location'), /oauth_error=invalid_state$/);
  assert.equal(f.exchanges(), 1);
  const expired = await f.start();
  await f.db.prepare("UPDATE oauth_attempt SET expires_at=clock_timestamp()-interval '1 second'").run();
  assert.match((await f.callback(expired)).headers.get('location'), /oauth_error=invalid_state$/);
  const cancelled = await f.start();
  const response = await f.request(`/api/auth/oauth/google/callback?state=${cancelled.state}&error=access_denied&error_description=secret`, { headers: { Cookie: cancelled.cookie } });
  assert.match(response.headers.get('location'), /oauth_error=cancelled$/);
  assert.equal(f.exchanges(), 1);
  assert.equal((await f.db.prepare('SELECT count(*) AS count FROM oauth_attempt').get()).count, 0);
});

test('forged, expired, wrong-issuer/audience/nonce and unverified Google identities cannot sign in', async t => {
  const f = await fixture(t);
  for (const options of [
    { badSignature: true }, { claims: { iss: 'https://evil.test' } }, { claims: { aud: 'different-client' } },
    { claims: { nonce: 'wrong' } }, { claims: { exp: 1 } }, { claims: { sub: '' } },
    { claims: { email_verified: false } }, { claims: { email_verified: 'true' } },
    { claims: { email: 'invalid' } }, { networkError: true },
  ]) {
    const response = await f.callback(await f.start(), options);
    assert.match(response.headers.get('location'), /\/login\?oauth_error=(failed|invalid_identity)$/);
    assert.equal((await f.db.prepare('SELECT count(*) AS count FROM USER').get()).count, 0);
    assert.equal((await f.db.prepare('SELECT count(*) AS count FROM oauth_ticket').get()).count, 0);
  }
});

test('Google cannot take over matching local email and inactive accounts cannot sign in', async t => {
  const f = await fixture(t, { seed: true });
  const local = await f.db.prepare('SELECT * FROM USER WHERE user_id=1').get();
  const conflict = await f.callback(await f.start(), { claims: { email: local.email.toUpperCase() } });
  assert.match(conflict.headers.get('location'), /oauth_error=email_exists$/);
  assert.equal((await f.db.prepare('SELECT count(*) AS count FROM oauth_identity').get()).count, 0);
  await f.callback(await f.start());
  await f.db.prepare("UPDATE USER SET is_active=0 WHERE email='google@example.test'").run();
  assert.match((await f.callback(await f.start())).headers.get('location'), /oauth_error=account_unavailable$/);
});

test('concurrent first logins create one identity; tickets expire and recheck active status', async t => {
  const f = await fixture(t);
  const attempts = await Promise.all([f.start(), f.start()]);
  const callbacks = await Promise.all(attempts.map(attempt => f.callback(attempt)));
  for (const response of callbacks) assert.match(response.headers.get('location'), /\/auth\/google\/complete/);
  assert.equal((await f.db.prepare('SELECT count(*) AS count FROM USER').get()).count, 1);
  assert.equal((await f.db.prepare('SELECT count(*) AS count FROM oauth_identity').get()).count, 1);
  const cookies = callbacks.map(response => response.headers.getSetCookie().find(value => /_ticket=.+;/.test(value)).split(';')[0]);
  await f.db.prepare("UPDATE oauth_ticket SET expires_at=clock_timestamp()-interval '1 second' WHERE ticket_hash=?").run(digest(cookies[0].split('=')[1]));
  assert.equal((await f.exchange(cookies[0])).status, 401);
  await f.db.prepare('UPDATE USER SET is_active=0').run();
  assert.equal((await f.exchange(cookies[1])).status, 401);
});

test('HTTPS uses host-only Secure OAuth cookies', async t => {
  const f = await fixture(t, { config: { ...configuration, origin: 'https://roommatch.example' } });
  const response = await f.request('/api/auth/oauth/google');
  for (const cookie of response.headers.getSetCookie()) {
    assert.match(cookie, /^__Host-roommatch_oauth_/);
    assert.match(cookie, /; Secure$/);
    assert.doesNotMatch(cookie, /Domain=/);
  }
});

test('OAuth migration preserves existing users and hashes and applies exactly once', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'roommatch-oauth-migration-'));
  try {
    copyFileSync('database/postgresql/migrations/001_initial_schema.sql', join(directory, '001_initial_schema.sql'));
    const db = await openDatabase({ filename: ':memory:', migrationsDirectory: directory, seed: true });
    const originalUsers = await db.prepare('SELECT * FROM USER ORDER BY user_id').all();
    await runMigrations(db);
    await runMigrations(db);
    assert.deepEqual(await db.prepare('SELECT * FROM USER ORDER BY user_id').all(),
      originalUsers.map(user => ({ ...user, account_type: null, profile_setup_pending: false })));
    assert.equal((await db.prepare("SELECT count(*) AS count FROM _roommatch_migrations WHERE filename='002_google_oauth.sql'").get()).count, 1);
    const user = await db.prepare("INSERT INTO USER(first_name,last_name,email,password_hash) VALUES('Google','User','migration@example.test',NULL) RETURNING user_id").get();
    await db.prepare("INSERT INTO oauth_identity(provider,subject,user_id) VALUES('google','migration-subject',?)").run(user.user_id);
    await assert.rejects(db.prepare("INSERT INTO oauth_identity(provider,subject,user_id) VALUES('google','migration-subject',1)").run(), error => error.code === '23505');
    await assert.rejects(db.prepare("INSERT INTO oauth_identity(provider,subject,user_id) VALUES('google','missing-user',999999)").run(), error => error.code === '23503');
    await db.prepare('DELETE FROM USER WHERE user_id=?').run(user.user_id);
    assert.equal((await db.prepare('SELECT count(*) AS count FROM oauth_identity').get()).count, 0);
  } finally {
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('roommatch-oauth-migration-')) throw new Error('Unsafe test directory cleanup');
    rmSync(directory, { recursive: true });
  }
});
