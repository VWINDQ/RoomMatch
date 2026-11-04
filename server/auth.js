import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

import { HttpError } from './errors.js';

const scrypt = promisify(scryptCallback);
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
  const derivedKey = await scrypt(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024,
  });

  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('hex')}$${derivedKey.toString('hex')}`;
}

export async function verifyPassword(password, encodedHash) {
  try {
    const [algorithm, n, r, p, saltHex, hashHex] = encodedHash.split('$');
    if (algorithm !== 'scrypt' || !saltHex || !hashHex) return false;

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
