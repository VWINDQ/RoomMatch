import { createHash, randomBytes } from 'node:crypto';
import * as oidc from 'openid-client';
import { createToken } from './auth.js';
import { assert, HttpError } from './errors.js';

const CALLBACK_PATH = '/api/auth/oauth/google/callback';
const opaqueToken = () => randomBytes(32).toString('base64url');
const digest = value => createHash('sha256').update(value).digest('hex');
const validToken = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);

export function readGoogleOAuthConfiguration(env = process.env) {
  const values = [env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.ROOMMATCH_PUBLIC_ORIGIN];
  if (values.every(value => !value)) return null;
  if (values.some(value => !value?.trim())) throw new Error('Google OAuth requires GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and ROOMMATCH_PUBLIC_ORIGIN');
  const origin = new URL(env.ROOMMATCH_PUBLIC_ORIGIN);
  const local = ['localhost', '127.0.0.1'].includes(origin.hostname);
  if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/'
    || (origin.protocol !== 'https:' && !(env.NODE_ENV !== 'production' && local && origin.protocol === 'http:'))) {
    throw new Error('ROOMMATCH_PUBLIC_ORIGIN must be an HTTPS origin (HTTP loopback is allowed in development)');
  }
  return { clientId: env.GOOGLE_CLIENT_ID.trim(), clientSecret: env.GOOGLE_CLIENT_SECRET.trim(), origin: origin.origin };
}

export function safeReturnTo(value) {
  if (typeof value !== 'string' || value.length > 2048 || !value.startsWith('/') || value.startsWith('//')
    || /[\\\u0000-\u0020]/.test(value)) return '/rooms';
  const destination = new URL(value, 'https://roommatch.invalid');
  if (!/^\/(rooms|favorites|my-listings|requests|matches|profile|friends)(\/|$)/.test(destination.pathname)) return '/rooms';
  return destination.pathname + destination.search + destination.hash;
}

function readCookie(request, name) {
  const matches = (request.headers.cookie ?? '').split(';').map(part => part.trim()).filter(part => part.startsWith(`${name}=`));
  return matches.length === 1 ? matches[0].slice(name.length + 1) : null;
}

export function createGoogleOAuthHandler(db, { configuration = readGoogleOAuthConfiguration(), fetch: providerFetch, sendJson, userDto, logger = console }) {
  let client;
  if (configuration) {
    client = new oidc.Configuration({
      issuer: 'https://accounts.google.com',
      authorization_endpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
      token_endpoint: 'https://oauth2.googleapis.com/token',
      jwks_uri: 'https://www.googleapis.com/oauth2/v3/certs',
    }, configuration.clientId, { client_secret: configuration.clientSecret, id_token_signed_response_alg: 'RS256' });
    client.timeout = 10;
    if (providerFetch) client[oidc.customFetch] = providerFetch;
    oidc.enableNonRepudiationChecks(client);
  }
  const secure = configuration?.origin.startsWith('https:');
  // Cookies are shared by tabs, so every attempt needs its own state and ticket.
  // The flow ID only selects a cookie; it cannot authenticate without its secret.
  const cookieName = (kind, flow) => `${secure ? '__Host-' : ''}roommatch_oauth_${kind}_${flow}`;
  const cookie = (kind, flow, value, maxAge) => `${cookieName(kind, flow)}=${value}; HttpOnly; Path=/; SameSite=${kind === 'state' ? 'Lax' : 'Strict'}; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
  const redirect = (response, location, cookies = []) => {
    response.writeHead(303, { Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Set-Cookie': cookies });
    response.end();
  };

  async function resolveAccount(claims) {
    assert(typeof claims.sub === 'string' && claims.sub.length > 0 && claims.sub.length <= 255
      && claims.email_verified === true && typeof claims.email === 'string' && claims.email.length <= 320
      && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(claims.email), 400, 'invalid_identity');
    return db.transaction(async () => {
      // Serialize first sign-ins for the same Google subject across all API instances.
      await db.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))').get(`google:${claims.sub}`);
      const existing = await db.prepare(`SELECT u.* FROM USER u JOIN oauth_identity i ON i.user_id = u.user_id
        WHERE i.provider = 'google' AND i.subject = ?`).get(claims.sub);
      if (existing) {
        assert(existing.is_active, 403, 'account_unavailable');
        return existing;
      }
      const email = claims.email.toLowerCase();
      // Matching email alone is not authorization to link a pre-existing account.
      assert(!(await db.prepare('SELECT 1 FROM USER WHERE lower(email) = lower(?)').get(email)), 409, 'email_exists');
      const name = value => typeof value === 'string' ? value.trim().slice(0, 100) : '';
      const user = await db.prepare(`INSERT INTO USER(first_name, last_name, email, password_hash, profile_setup_pending)
        VALUES (?, ?, ?, NULL, TRUE) RETURNING *`).get(name(claims.given_name) || name(claims.name) || 'Google', name(claims.family_name) || '-', email);
      await db.prepare("INSERT INTO oauth_identity(provider, subject, user_id) VALUES ('google', ?, ?)").run(claims.sub, user.user_id);
      return user;
    });
  }

  return async (request, response, url) => {
    if (!url.pathname.startsWith('/api/auth/oauth/')) return false;
    if (request.method === 'GET' && url.pathname === '/api/auth/oauth/providers') {
      sendJson(response, 200, { google: Boolean(client) }, request);
      return true;
    }
    if (!client) {
      if (request.method === 'GET' && url.pathname === '/api/auth/oauth/google') {
        redirect(response, '/login?oauth_error=unavailable');
        return true;
      }
      throw new HttpError(503, 'Google sign-in is not configured');
    }
    const callbackUrl = `${configuration.origin}${CALLBACK_PATH}`;
    if (request.method === 'GET' && url.pathname === '/api/auth/oauth/google') {
      const state = opaqueToken(), browser = opaqueToken(), nonce = oidc.randomNonce(), verifier = oidc.randomPKCECodeVerifier();
      await db.prepare('DELETE FROM oauth_attempt WHERE expires_at <= clock_timestamp()').run();
      await db.prepare('DELETE FROM oauth_ticket WHERE expires_at <= clock_timestamp()').run();
      await db.prepare(`INSERT INTO oauth_attempt(state_hash, browser_hash, code_verifier, nonce, return_to, expires_at)
        VALUES (?, ?, ?, ?, ?, clock_timestamp() + interval '10 minutes')`).run(digest(state), digest(browser), verifier, nonce, safeReturnTo(url.searchParams.get('returnTo')));
      const target = oidc.buildAuthorizationUrl(client, {
        redirect_uri: callbackUrl, scope: 'openid email profile', response_type: 'code', state, nonce,
        code_challenge: await oidc.calculatePKCECodeChallenge(verifier), code_challenge_method: 'S256', prompt: 'select_account',
      });
      redirect(response, target.href, [cookie('state', state, browser, 600)]);
      return true;
    }
    if (request.method === 'GET' && url.pathname === CALLBACK_PATH) {
      const state = url.searchParams.get('state');
      const expiredCookies = validToken(state) ? [cookie('state', state, '', 0), cookie('ticket', state, '', 0)] : [];
      try {
        const browser = validToken(state) ? readCookie(request, cookieName('state', state)) : null;
        assert(validToken(state) && validToken(browser) && url.searchParams.getAll('state').length === 1, 400, 'invalid_state');
        // Consume once, atomically, and require the browser that initiated this flow.
        const attempt = await db.prepare(`DELETE FROM oauth_attempt WHERE state_hash = ? AND browser_hash = ?
          AND expires_at > clock_timestamp() RETURNING *`).get(digest(state), digest(browser));
        assert(attempt, 400, 'invalid_state');
        if (url.searchParams.has('error')) throw new HttpError(400, url.searchParams.get('error') === 'access_denied' ? 'cancelled' : 'failed');
        const incoming = new URL(callbackUrl);
        incoming.search = url.search;
        const tokens = await oidc.authorizationCodeGrant(client, incoming, {
          expectedState: state, expectedNonce: attempt.nonce, pkceCodeVerifier: attempt.code_verifier, idTokenExpected: true,
        });
        const user = await resolveAccount(tokens.claims());
        const ticket = opaqueToken();
        await db.prepare(`INSERT INTO oauth_ticket(ticket_hash, user_id, expires_at)
          VALUES (?, ?, clock_timestamp() + interval '1 minute')`).run(digest(ticket), user.user_id);
        const target = new URL('/auth/google/complete', configuration.origin);
        target.searchParams.set('returnTo', user.profile_setup_pending ? '/profile' : safeReturnTo(attempt.return_to));
        target.searchParams.set('flow', state);
        redirect(response, target.href, [cookie('state', state, '', 0), cookie('ticket', state, ticket, 60)]);
      } catch (error) {
        const knownErrors = new Set(['invalid_state', 'invalid_identity', 'email_exists', 'account_unavailable', 'cancelled', 'failed']);
        const reason = error instanceof HttpError && knownErrors.has(error.message) ? error.message : error.code === '23505' ? 'email_exists' : 'failed';
        // Provider errors may contain codes/tokens; log only the error classification.
        if (reason === 'failed') logger.error?.('Google OAuth failed', error.name);
        redirect(response, `${configuration.origin}/login?oauth_error=${reason}`, expiredCookies);
      }
      return true;
    }
    if (request.method === 'POST' && url.pathname === '/api/auth/oauth/session') {
      assert(request.headers.origin === configuration.origin && request.headers['content-type']?.split(';')[0] === 'application/json', 403, 'Invalid OAuth exchange origin');
      const flow = url.searchParams.get('flow');
      assert(validToken(flow) && url.searchParams.getAll('flow').length === 1, 401, 'Google sign-in expired. Please try again.');
      const ticket = readCookie(request, cookieName('ticket', flow));
      assert(validToken(ticket), 401, 'Google sign-in expired. Please try again.');
      const session = await db.prepare(`DELETE FROM oauth_ticket WHERE ticket_hash = ?
        AND expires_at > clock_timestamp() RETURNING user_id`).get(digest(ticket));
      response.setHeader('Set-Cookie', cookie('ticket', flow, '', 0));
      assert(session, 401, 'Google sign-in expired. Please try again.');
      const user = await db.prepare('SELECT * FROM USER WHERE user_id = ?').get(session.user_id);
      assert(user?.is_active, 401, 'Google sign-in expired. Please try again.');
      sendJson(response, 200, { token: createToken(user.user_id), user: userDto(user, { privateFields: true }) }, request);
      return true;
    }
    throw new HttpError(404, 'Endpoint not found');
  };
}
