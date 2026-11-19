# Passwords and Google sign-in

## Password storage

New passwords use Node.js 26's asynchronous Argon2id implementation, encoded in
PHC format: `$argon2id$v=19$m=65536,t=3,p=1$<salt>$<hash>`. Each hash has a random
16-byte salt, 64 MiB memory, three passes, one lane and a 32-byte tag. Verification
compares derived keys in constant time and bounds stored work factors before
allocating resources. Benchmark these parameters under the deployment's expected
concurrency; the existing login/register rate-limit work remains outstanding.

Existing scrypt hashes, including development seed accounts, still verify. After
a successful password login, the server replaces the old hash with Argon2id using
a conditional update. Failed logins and inactive accounts never upgrade hashes.
There is no bulk conversion because the original password is needed. Existing
password trimming and the `{ token, user }` API contract are unchanged.

## Enable Google OAuth / OpenID Connect

1. Create/select a project in [Google Cloud Console](https://console.cloud.google.com/).
2. Configure the Google Auth Platform branding, audience and consent screen.
   While the app is in testing, add the Google accounts that will test it.
3. Create an OAuth client of type **Web application**. Add the exact authorized
   redirect URI for the browser-facing app, for example:
   `http://localhost:5173/api/auth/oauth/google/callback`.
4. Set these server environment variables in your ignored `.env`:

   ```dotenv
   ROOMMATCH_PUBLIC_ORIGIN=http://localhost:5173
   GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=your-client-secret
   ```

5. Restart `npm run dev`. The API applies migration
   `database/postgresql/migrations/002_google_oauth.sql` automatically. Open the
   same hostname and port configured above, then use **ดำเนินการต่อด้วย Google**
   on `/login` or `/register`.

If Vite uses another port, update both the origin and registered redirect URI.
For a direct API-served production build, use its public HTTPS origin instead,
for example `https://roommatch.example`, with redirect URI
`https://roommatch.example/api/auth/oauth/google/callback`. The frontend and API
must share this public origin (reverse-proxy `/api` when hosted separately).
The redirect origin is configured explicitly; request Host/forwarded headers
cannot choose it. Use the existing strong `ROOMMATCH_TOKEN_SECRET` in production.

Leaving all three Google variables empty disables Google sign-in and keeps
password authentication working. Partial configuration fails at startup. Never
put the secret in a `VITE_` variable, source control, frontend bundle or chat.
No live Google login can be verified until a real client and redirect URI exist.

## Account behavior

- A new Google identity creates a user with `password_hash = NULL`, then opens
  `/profile` so the user can complete their phone and other profile details.
  Google sometimes omits a family name; `-` is used until the user edits it.
- Returning users are identified by the verified Google `sub`, not by email.
  Changing a Google email does not silently overwrite the RoomMatch profile.
- An email already registered in RoomMatch is **not automatically linked**.
  The user receives a message to sign in with the original password. Linking an
  existing account and adding/resetting a local password are not implemented.
- Google-only accounts cannot use password login. Disabled accounts cannot
  complete either Google login or the subsequent session exchange.
- A returning user goes back to the requested application route; redirect
  targets are restricted to RoomMatch routes.

## Flow and storage

`openid-client` handles the authorization-code exchange and ID-token validation.
The server requests only `openid email profile`, checks issuer, audience, expiry,
nonce, RSA signature and verified email, and uses PKCE S256 plus a random state
bound to an HttpOnly browser cookie. Attempts expire after ten minutes and are
atomically consumed, including cancelled attempts. Concurrent first logins are
serialized per provider subject and protected by unique database constraints.

The callback never places a RoomMatch bearer token or Google tokens in a URL.
It sets a random, HttpOnly, SameSite=Strict ticket cookie valid for one minute
and redirects to `/auth/google/complete`. The SPA exchanges that ticket once via
a same-origin JSON POST, then uses the existing validated session mechanism.
Ticket values are stored only as SHA-256 hashes. HTTPS cookies use `Secure` and
the `__Host-` prefix. Callback redirects disable caching and referrer forwarding.
Google access/refresh tokens are not persisted. Expired attempts/tickets are
cleaned when a new Google sign-in begins; schedule cleanup separately if needed
when traffic stops. Proxy access logs should omit callback query strings.

The three additive tables are `oauth_identity`, `oauth_attempt`, `oauth_ticket`.
The migration makes the existing password column nullable without rewriting any
passwords or user rows. OAuth data is separate from the legacy SQLite import.
Application bearer tokens still live in localStorage with the existing seven-day
lifetime; this feature does not change logout/revocation behavior.

Endpoints:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/auth/oauth/providers` | Google enabled status, no client secret |
| GET | `/api/auth/oauth/google` | Begin sign-in; optional local `returnTo` |
| GET | `/api/auth/oauth/google/callback` | Validate and consume provider response |
| POST | `/api/auth/oauth/session` | Same-origin, one-time ticket exchange |

## Verification

Run `npm test` against the dedicated `TEST_DATABASE_URL`, then `npm run build`.
`tests/passwords.test.mjs`, `tests/oauth.test.mjs` and `tests/auth-client.test.mjs`
cover hashing, migration-on-login, real PostgreSQL identity/ticket lifecycle,
signed fixture ID tokens, forgery/expiry/nonce/audience checks, email collision,
concurrency, disabled accounts, browser binding and client session races.
Provider HTTP responses are simulated; these tests do not contact real Google
accounts. Verify the configured Google consent screen and live round trip before
deploying.

References: [Node.js Argon2](https://nodejs.org/api/crypto.html#cryptoargon2algorithm-parameters-callback),
[Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect),
[openid-client](https://github.com/panva/openid-client).
