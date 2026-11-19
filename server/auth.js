import { argon2 as argon2Callback, createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

import { HttpError } from './errors.js';

const scrypt = promisify(scryptCallback);
const argon2 = promisify(argon2Callback);
const ARGON2_MEMORY = 65_536;
const ARGON2_PASSES = 3;
const ARGON2_PARALLELISM = 1;
const ARGON2_KEY_LENGTH = 32;
const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const TOKEN_LIFETIME_SECONDS = 7 * 24 * 60 * 60;

let developmentSecret;

function signingSecret() {
  const configured = process.env.ROOMMATCH_TOKEN_SECRET;
  if (configured && configured.length >= 32 && configured !== 'replace-with-a-long-random-secret') {
    return configured;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('ROOMMATCH_TOKEN_SECRET must be a random secret of at least 32 characters, not the example value');
  }

  developmentSecret ??= randomBytes(32).toString('hex');
  return developmentSecret;
}

export function validateAuthConfiguration() {
  signingSecret();
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const derivedKey = await argon2('argon2id', {
    message: password, nonce: salt, tagLength: ARGON2_KEY_LENGTH,
    memory: ARGON2_MEMORY, passes: ARGON2_PASSES, parallelism: ARGON2_PARALLELISM,
  });
  return `$argon2id$v=19$m=${ARGON2_MEMORY},t=${ARGON2_PASSES},p=${ARGON2_PARALLELISM}$${salt.toString('base64').replace(/=+$/, '')}$${derivedKey.toString('base64').replace(/=+$/, '')}`;
}

function parseArgon2Hash(encodedHash) {
  if (typeof encodedHash !== 'string') return null;
  const match = /^\$argon2id\$v=19\$m=(\d{1,6}),t=(\d{1,2}),p=(\d{1,2})\$([A-Za-z0-9+/]{22,86})\$([A-Za-z0-9+/]{43})$/.exec(encodedHash);
  if (!match) return null;
  const [, memory, passes, parallelism, salt, hash] = match;
  const parameters = { memory: Number(memory), passes: Number(passes), parallelism: Number(parallelism) };
  // Bound stored work factors as well as input size before allocating memory.
  if (parameters.parallelism < 1 || parameters.parallelism > 4 || parameters.memory < 8 * parameters.parallelism
    || parameters.memory > 262_144 || parameters.passes < 1 || parameters.passes > 10) return null;
  const nonce = Buffer.from(salt, 'base64');
  const expected = Buffer.from(hash, 'base64');
  if (nonce.toString('base64').replace(/=+$/, '') !== salt || expected.toString('base64').replace(/=+$/, '') !== hash) return null;
  return { ...parameters, nonce, expected };
}

export function passwordNeedsRehash(encodedHash) {
  const parsed = parseArgon2Hash(encodedHash);
  return !parsed || parsed.memory < ARGON2_MEMORY || parsed.passes < ARGON2_PASSES;
}

export async function verifyPassword(password, encodedHash) {
  if (typeof password !== 'string' || typeof encodedHash !== 'string') return false;
  const parsed = parseArgon2Hash(encodedHash);
  if (parsed) {
    const { expected, ...parameters } = parsed;
    const derivedKey = await argon2('argon2id', { ...parameters, message: password, tagLength: expected.length });
    return timingSafeEqual(expected, derivedKey);
  }
  // Read-only compatibility for existing accounts; successful logins rehash below.
  try {
    const [algorithm, n, r, p, saltHex, hashHex, extra] = encodedHash.split('$');
    if (algorithm !== 'scrypt' || n !== String(SCRYPT_N) || r !== String(SCRYPT_R) || p !== String(SCRYPT_P)
      || extra !== undefined || !/^(?:[a-f0-9]{2}){16,64}$/i.test(saltHex ?? '') || !/^[a-f0-9]{128}$/i.test(hashHex ?? '')) return false;

    const expected = Buffer.from(hashHex, 'hex');
    if (expected.length !== KEY_LENGTH) return false;

    const derivedKey = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: 64 * 1024 * 1024,
    });
    return timingSafeEqual(expected, derivedKey);
  } catch {
    return false;
  }
}

export function createToken(userId, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({
    sub: userId,
    exp: Math.floor(now / 1000) + TOKEN_LIFETIME_SECONDS,
  })).toString('base64url');
  const signature = createHmac('sha256', signingSecret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyToken(token, now = Date.now()) {
  try {
    const [payload, suppliedSignature, extra] = token.split('.');
    if (!payload || !suppliedSignature || extra) throw new Error('Malformed token');

    const expectedSignature = createHmac('sha256', signingSecret()).update(payload).digest();
    const actualSignature = Buffer.from(suppliedSignature, 'base64url');
    if (actualSignature.length !== expectedSignature.length || !timingSafeEqual(actualSignature, expectedSignature)) {
      throw new Error('Invalid signature');
    }

    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!Number.isSafeInteger(parsed.sub) || parsed.sub <= 0 || !Number.isSafeInteger(parsed.exp) || parsed.exp <= Math.floor(now / 1000)) {
      throw new Error('Expired token');
    }
    return parsed.sub;
  } catch {
    throw new HttpError(401, 'Invalid or expired authentication token');
  }
}

export function bearerToken(request) {
  const authorization = request.headers.authorization;
  if (!authorization) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  if (!match) throw new HttpError(401, 'Invalid authorization header');
  return match[1];
}
