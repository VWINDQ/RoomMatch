> Update 2026-11-13: this is a historical audit. The URL-only image limitation below has been replaced by file uploads; see [UPLOADS.md](UPLOADS.md) and the current [production readiness report](PRODUCTION_READINESS.md).

# ROOMMATCH post-implementation audit

Date: 2026-10-03. Scope: current React/TypeScript/Vite frontend, Node HTTP API,
SQLite schema, and actual browser workflows. This is not a production-readiness
certification. No existing user database, original ER table, or migration was
changed for QA.

## Method and environments

- Read repository instructions, architecture, schema, API contracts, components,
  package scripts, current Git status, and tracked diff before modifications.
- Ran the built SPA against isolated seeded and initially empty SQLite databases
  on loopback ports 3111/3112. Created two synthetic users through the UI.
- Ran `npm run dev` with a separate SQLite file and ports 3113/5179, then signed
  in through the browser to verify the real Vite-to-API proxy.
- Used the browser for form submission, navigation, searching, filtering,
  invitations, accepting invitations, creating/editing a room, requesting entry,
  approving entry, logout/login, and nested-route reloads. Tests are not merely
  screenshots or a code review.
- Fault injection: returned controlled HTTP 503 responses for API outages, and
  used SQLite `PRAGMA query_only = ON` for real write failures. A regression test
  also forces a preference trigger failure after the profile UPDATE to prove
  transaction rollback. Fault controls live only in a temporary QA harness,
  never in the application.
- Read persisted rows with a separate read-only SQLite connection. Regression
  tests close and reopen an on-disk database to verify durable persistence.
- Visually inspected desktop/laptop (1280/1440px), tablet (768px), mobile (390px),
  and narrow mobile (375px). Inspected authentication, browse, room detail,
  discovery, profile, listings, create/edit forms, requests, matches, dialogs,
  skeletons, empty states, and error states. Actual viewport width was checked
  against DOM width rather than inferred from screenshot dimensions.

## Findings and fixes

### Critical — fixed

**Known example token-signing key accepted.** A token signed with the public
`.env.example` secret authenticated as user 1. Signing now rejects the example
and short values. Development uses an unpredictable ephemeral fallback;
production startup fails before opening the database unless a non-example key
of at least 32 characters is supplied. Token payloads must also have positive
safe-integer user IDs and safe-integer expiration timestamps. Automated tests
verify the forgery fails and invalid production settings are rejected.

### High — fixed

**Profile saves could partially persist.** Reproduced in the browser: changing
the name and submitting a 256-character lifestyle changed the database name,
then failed the lifestyle request. Profile, lifestyle, and preference fields now
validate together and commit in one transaction. Existing separate endpoints
remain supported. Invalid bundles and mid-transaction database errors leave all
three records unchanged. The frontend uses the returned bundle rather than
performing multiple writes and redundant reloads.

**Production automatically seeded known demo credentials.** Fresh production
databases no longer receive demo accounts by default. Existing demo accounts
are deliberately not deleted: deploying an old development database still
requires operator action. Documentation explicitly calls for a fresh database.

### Medium — fixed

- Authentication pages overflowed at 768px: measured document width was 880px
  and fields extended beyond the viewport. The existing stacked authentication
  layout now starts at the tablet breakpoint. Retested width: 768/768px.
- Reversed price ranges closed the filter dialog and produced an API error
  page. Price validation now keeps the dialog open with a clear Thai error;
  negative/fractional/non-numeric input is rejected. Example placeholders no
  longer encourage unsupported comma-separated input.
- Filter dialog did not move/contain keyboard focus or handle Escape. Added
  focus containment including select/textarea controls, Escape, focus return,
  and background scroll locking. Browser verified close and focus return.
- Unreachable profile images rendered broken-image icons in profiles, room
  details, requests, and match member strips. A shared fallback renders initials
  and retries when the source URL changes. Verified with valid, empty, and 404
  image URLs; persisted URLs are not silently deleted.
- Room request/approval failures used a success-checkmark toast that vanished.
  Errors now remain in accessible inline alerts; success toasts remain for
  successful actions. Verified actual SQLite failures and successful retries.
- Room detail's “back to all rooms” used browser history, which could return to
  an unrelated page. It now navigates explicitly to `/rooms`.
- Search input lacked a stable accessible name. Added an explicit Thai label.
- Guarded refreshed user assignment against a token changing during the request.

### High — remaining feature gap / release limitation

- **Like / Pass and mutual-like matching do not exist.** The implemented friend
  flow is invitation → recipient acceptance/decline. A reverse invitation is
  rejected as a duplicate; it is not a second Like and does not trigger a match.
  No normal/invalid/empty/failure/persistence tests can pass for nonexistent
  controls or storage. Adding this flow needs a product/schema decision, not a
  silent reinterpretation of the existing invitation feature.
- Authentication has no login/registration rate limiting, token revocation, or
  server-side logout endpoint. Logout clears the browser session; a previously
  copied token remains valid until expiry. These are limitations before public
  deployment, not a claim that a UI logout failed. A session/abuse-control design
  is still required; it was not added through an unrelated schema rewrite.

### Medium / Low — remaining limitations

- Image handling is URL-based, not file upload/storage. There is no uploader to
  audit; browser image failure fallback does not guarantee remote availability.
- Room/friend lists are unpaginated and use repeated related-record queries.
  Small seeded data was tested, not load-tested production traffic. Pagination,
  query batching, and latency/timeouts need scale-oriented follow-up.
- No lint script/tool is configured. TypeScript compilation is not a substitute
  for a linter. No claim is made that lint passed.
- Clickable room articles support keyboard activation but are not native links;
  password-label semantics and the older general modal focus trap deserve a
  fuller screen-reader pass. Visual focus and filter keyboard behavior were
  checked; no full assistive-technology certification was performed.
- Favorites, tags, and amenities are absent from the current ER-backed product,
  as already documented in `ARCHITECTURE.md`. Historical mock requirements for
  these must not be described as persisted implemented features.
- No deployment TLS, reverse-proxy trust settings, backups/restore drills,
  real-device Safari/Android testing, or sustained concurrency/load test was
  performed. Tests used the in-app Chromium browser and localhost.

## Flow matrix

“API” means an executed integration test, not source-code inspection. “N/A” is
explicitly inapplicable, not a successful test. Fault scenarios are simulated
API outages or real isolated SQLite write failures, not outages of the user's
existing database.

| Flow | Normal | Invalid input | Empty state | Failure | Persistence |
| --- | --- | --- | --- | --- | --- |
| Register | Browser: Alice and Bob accounts | Browser blank form; API bad email, short password, blank name, future date, duplicate email | Initially zero users; first registration works | Browser 503; API read-only DB rejects write | Only two UI test users; failed registration created no third user; API reopen verified |
| Login | Browser valid credentials through built SPA and Vite proxy | Browser wrong password; API 401 | API login without a matching account returns 401 | Browser 503 stays on login; session bootstrap outage has retry | Refresh restores current user; invalid/failing attempts do not create users |
| Logout | Browser returns to login, then another account signs in | N/A: no input | Guest protected route redirects to login | Client-only operation; no logout API to fail | Browser session cleared; server token revocation not implemented |
| Profile creation/edit | Registration creates USER; browser saves full profile bundle | Browser overlong lifestyle; API blank name, impossible date, malformed URL | No lifestyle/preferences shown with readable defaults | Browser real DB write failure; trigger-induced mid-save rollback test | Name/lifestyle/preferences reread, refreshed, and reopened; no partial save |
| Profile image | Browser valid URL displays image; empty URL initials | API rejects `javascript:` and incomplete HTTP URL | Initials when absent | Browser 404 image gracefully falls back | URL persists; remote bytes are not uploaded or stored |
| Preferences | Browser zero minimum budget and 6000 maximum | API reversed budgets; form numeric/age validation inspected | Null preference renders defaults | Same atomic DB failure test as profile | SQLite budget values 0/6000; API reopen confirms zero preserved |
| Roommate discovery | Browser search, public profile modal, four seeded candidates | API auth required, escaped wildcard search | Browser only-self database and no-result query | Browser 503 and failed invitation write | Read-only search does not create connection or expose contacts |
| Like / Pass | NOT IMPLEMENTED | NOT IMPLEMENTED | NOT IMPLEMENTED | NOT IMPLEMENTED | No Like/Pass storage |
| Mutual-like matching | NOT IMPLEMENTED; invitation acceptance is separate | API reverse invitation 409 is not a mutual Like | N/A | N/A | No mutual-like record exists |
| Friend invitation / acceptance | Browser Bob invites Alice; Alice accepts; contacts become visible | API self, nonexistent recipient, duplicate, sender/outsider decision denied | Browser no invitations/no accepted friends | Browser DB failures for send and accept | One accepted connection, no room match until room approval; refresh preserves result |
| Room request / approval | Browser Bob requests Alice's room; owner approves | API unauthorized, duplicate/conflicting requests and invalid decisions in existing tests | Browser no sent/incoming requests | Browser DB failures leave request pending and member/match counts zero | Approval produces one membership, one room match, full room with capacity 2 |
| Match list | Browser new room match, member count, room navigation | Auth/ownership covered by API tests; no editable input | Browser zero matches | Browser 503 with retry | Nested reload and direct DB row confirm room match survives |
| Room CRUD | Browser create/edit, invalid edit, delete dialog cancel; API deletion | Browser missing map/negative price; API ownership/title rules | Browser no listings and no images | Browser DB edit failure preserves old price | Browser saved 5500 price reread in SQLite; cancellation keeps room; actual deletion covered by isolated API tests |
| Search/filter/sort | Browser search; ascending/descending options; valid price filter | Browser reversed range stays in dialog after fix; API validation | Browser empty DB and unmatched query | Browser 503 with retry | Read-only API queries; filter settings intentionally reset on page reload |
| Navigation/nested routes | Actual links/buttons across all major screens; room/profile/edit/friends/matches refresh | Unknown API route returns JSON 404, not SPA HTML | Empty screens retain navigation | API outage screens and bootstrap retry tested | Protected session restores on reload without modifying records |
| Mobile | Actual nav, forms, discovery modal, filter, gallery controls at 375/390px; tablet auth fixed | Same field errors displayed in responsive form | Empty listings/requests/friends/matches inspected | Mobile API errors inspected | Same database verified separately; responsive presentation does not change records |

The permanent delete confirmation was cancelled in the browser; no user data
was deleted. Deletion correctness is covered by executed isolated API tests,
not claimed as a completed destructive manual click.

## Persistence evidence from manual browser flow

The initially empty QA database ended with exactly two users, Alice's lifestyle
and preference (budget 0–6000), one room at 5500 with capacity 2/status full, one
accepted friend connection (Bob → Alice), one approved room request, one
approved ROOM_MEMBER for Bob, and one MATCHES row (Alice/Bob/room 1).
`PRAGMA foreign_key_check` returned no violations. Failed registration, profile,
invitation, edit, join-request, and approval operations did not produce their
corresponding successful records. All of this is synthetic QA data.

## Checks and changed files

- `npm test`: 13 tests passed, zero failed. Includes new signing/configuration,
  production no-seed, empty-database, invalid-input, atomic rollback, and durable
  persistence checks, plus existing room/friend authorization and ER integrity.
- `npm run build`: TypeScript project compilation and production bundling passed.
- `npm run dev`: frontend and API started; browser login/proxy verified.
- Lint: unavailable (not configured).
- Manual browser evidence includes before/after tablet overflow, image fallback,
  persistent failure alerts, invitation privacy/acceptance, and room match UI.

Audit source changes:

- `server/auth.js`, `server/app.js`, `server/database.js`, `server/api.test.mjs`
- `src/AppContext.tsx`
- `src/components/ProfilePhoto.tsx`, `src/components/useDialogFocus.ts`,
  `src/components/FilterSheet.tsx`
- `src/pages/ProfilePage.tsx`, `src/pages/RoomDetailPage.tsx`,
  `src/pages/RequestsPage.tsx`, `src/pages/MatchesPage.tsx`, `src/pages/RoomsPage.tsx`
- `src/styles.css`, `tests/auth.test.mjs`, `tests/audit.test.mjs`
- `README.md`, `docs/AUDIT.md`

No new dependency, schema migration, branch, commit, push, or PR was created.
Build output was regenerated by the existing build command. The worktree was
already dirty with extensive untracked source and old `dist` changes; those
pre-existing changes were preserved. The frontend-design skill informed the
responsive/image/state corrections while retaining existing Claymorphism,
navy/pastel colors, fonts, routes, and information architecture.
