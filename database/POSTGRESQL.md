# PostgreSQL setup and SQLite migration

The API now uses PostgreSQL through `pg`. The existing routes, JSON fields,
password hashes, ten business tables and room/friend workflows are preserved.
Node.js 26 remains the project's supported runtime. SQLite is used only by the
one-way import tool and historical migration tests, never by the running API.

## Local setup

1. Install dependencies with `npm ci`. Install/start Docker Desktop, or provide
   an existing PostgreSQL server (this migration was tested on PostgreSQL 18).
2. Copy `.env.example` to `.env` **only if `.env` does not already exist**.
   Existing developers should add the new variables without replacing their
   signing secret, upload directory or other settings.
3. Generate two independent secrets using the following command twice:

   ```bash
   node --input-type=module -e "import { randomBytes } from 'node:crypto'; console.log(randomBytes(32).toString('hex'))"
   ```

   Use one for `ROOMMATCH_TOKEN_SECRET`. Use the other for `PGPASSWORD`, and
   replace the password in both `DATABASE_URL` and `TEST_DATABASE_URL` with
   that same PostgreSQL password. The example uses URL-safe hexadecimal; URL
   encode a password containing URL-reserved characters if using another format.
4. Start the database and create its separate test database once:

   ```bash
   npm run db:up
   docker compose exec postgres createdb -U roommatch roommatch_test
   ```

   The create command uses the example `PGUSER=roommatch`; adjust if changed.
   If `roommatch_test` already exists, skip its creation. Docker Compose publishes
   PostgreSQL on `127.0.0.1:5432` only and keeps data in a named volume.
5. For a **new demo database**, keep `ROOMMATCH_SEED=true` and run:

   ```bash
   npm run dev
   ```

   The API applies PostgreSQL migrations and seeds only when `USER` is empty.
   `npm run db:down` stops PostgreSQL while retaining data. Restart with `db:up`.
   **Do not remove the Docker volume to troubleshoot setup.** Changing
   `PGPASSWORD` does not reset the password of an already initialized volume;
   rotate the database role's password deliberately, then update the URLs.

## Import existing SQLite data

Do this **before starting the app against a new PostgreSQL destination**:

1. Stop all processes writing to the old SQLite database. Make a consistent
   backup using SQLite's backup API/tool (or copy the database plus its WAL/SHM
   files while every writer is stopped). Back up `storage/uploads/` as well.
2. Set `DATABASE_URL` to an **empty** PostgreSQL database and set
   `ROOMMATCH_SEED=false` in `.env`. Keep the same `ROOMMATCH_TOKEN_SECRET` and
   upload directory. Do not run the demo seed into this destination first.
3. Run:

   ```bash
   npm run db:up
   npm run db:import:sqlite -- --source /absolute/path/database/roommatch.sqlite
   ```

4. Confirm the printed row counts, then run `npm run dev` and check your accounts,
   rooms, images, requests, favorites, memberships, matches and friend invitations.
   Keep `ROOMMATCH_SEED=false` to avoid demo data in this migrated database.

The importer opens SQLite **read-only**, checks integrity/foreign keys, and
imports a single consistent snapshot. It requires the original eight ER tables; absent friend/favorite extensions
are imported as empty tables. Existing optional metadata uses the destination
defaults when absent. It refuses an occupied PostgreSQL destination, preserves
IDs/hashes/image paths/history, validates business invariants, resets identity
sequences, and rolls back the entire data import on error. PostgreSQL schema
creation/migrations precede that data transaction and may remain after a failed
import. Check/unique/FK constraints remain enabled during import; only business
triggers are temporarily disabled inside its transaction and restored atomically.
No user table or SQLite source is deleted or rewritten.

Uploaded image bytes stay in `ROOMMATCH_UPLOAD_DIR`; the database stores paths.
When moving machines, copy that directory separately while retaining its user-ID
subdirectories. Switching this branch back does not convert PostgreSQL changes
back to SQLite. Keep a maintenance window during cutover; two databases receiving
writes independently will diverge.

## Tests

```bash
npm test
npm run build
```

`npm test` loads `.env`. `TEST_DATABASE_URL` **must** identify a dedicated database
whose name ends in `_test`. It never falls back to the development URL. Each
fixture creates a random `rm_test_*` schema and cleans up only its own schemas.
The test role must be able to create/drop schemas. Do not point this variable at
an application database. Tests create HTTP servers, exercise failures and pool
restarts, import SQLite fixtures, and race approvals/invitations across two API
instances using separate PostgreSQL pools. Historical SQLite tests still cover
old migrations; they are not evidence for the PostgreSQL API tests.

For one test file with the same environment:

```bash
node --env-file=.env --test tests/postgresql.test.mjs
```

## Storage and transaction contract

- New migrations belong in `database/postgresql/migrations/` with unique numeric
  prefixes. Applied files are checksum-verified; add another migration instead
  of editing an applied one. `database/migrations/` and `database/seed.sql` remain
  unchanged as legacy SQLite history/import fixtures.
- `_roommatch_migrations` tracks PostgreSQL files, checksums and application times.
  An advisory lock serializes migration/seed runners and migrations are atomic.
- PostgreSQL stores the reserved table name as **`"USER"`**. Other unquoted table
  names fold to lowercase. In a SQL client, use `SELECT * FROM "USER"` and
  `SELECT * FROM room`. Entity names/relationships in the ER are unchanged.
- IDs/prices/budgets use BIGINT and the API returns safe JavaScript numbers;
  out-of-range BIGINT reads fail rather than silently lose precision.
  Dates are `DATE`; event times are `TIMESTAMPTZ`, returned as UTC ISO strings.
- Every HTTP request retains one pooled connection. BEGIN/COMMIT/ROLLBACK always
  use that same connection. Room writes lock the room before the request/member
  and re-read occupancy after the lock. Friend creation locks the unordered pair;
  final decisions lock their connection row. This supports multiple API instances.
- TLS follows the PostgreSQL URL/provider requirements. The app does not disable
  certificate verification. Use the provider's verified connection settings.

## Deployment

Set `DATABASE_URL`, `NODE_ENV=production`, a strong `ROOMMATCH_TOKEN_SECRET`, and
`ROOMMATCH_SEED=false`. Provide persistent/object storage for uploads, HTTPS,
backups (PostgreSQL dump/PITR plus upload storage), monitoring and restore tests.
This change prepares the database layer; it does not deploy the app or address
all items in [Production readiness](../docs/PRODUCTION_READINESS.md).

## Verification of change-dbms

Verified locally on 2026-11-16 with Node.js 26 and PostgreSQL 18:

- `npm test`: 143 tests passed, none skipped. Existing API tests now run against
  PostgreSQL; old SQLite migration coverage remains explicitly separate.
- `NODE_OPTIONS=--throw-deprecation npm test` also passed all 143 tests after
  serializing per-request list queries; no PostgreSQL driver deprecation remained.
- Vite SSR tests disable their unused HMR/WebSocket transports so parallel
  test processes do not compete for port 24678.
- `npm run build` and `git diff --check` passed.
- Actual `npm run dev` started API/Vite; the API, frontend and Vite API proxy
  returned HTTP 200. The temporary development/QA servers were stopped afterward.
- Local cutover compared all 57 existing business rows against the read-only
  SQLite source, including password hashes and image paths. All matched after
  normalizing timestamp representation to UTC. The original SQLite file and a
  consistent backup were retained; neither is committed.
- Browser QA used an isolated PostgreSQL schema/upload folder. On desktop
  (1280×720): login, favorites, profile image upload, profile/preference save and
  refresh, applicant profile, approval and resulting member/match contacts.
  On mobile (390×844): invitation discovery/search/send/accept, shared contacts,
  pair search, listing status/details/edit, invalid listing input, empty favorites,
  and a real database-table failure followed by a successful UI retry.
  On tablet (820×1000): profile refresh, logout and registration layout.
- Dedicated database tests cover atomic migration rollback/checksum checks,
  imported rows/identities, failed-import rollback, absent optional legacy tables,
  safe API errors during connection failure, and cross-pool approval/invitation
  races. Browser QA did not alter the migrated development records.

## Files to commit for change-dbms

This is one database migration feature with its regression coverage. Include
all the following files together so the new server and its tests stay compatible.
Do not include unrelated pre-existing untracked files, `.env`, SQLite files or
uploads. No commit/push/branch operation was performed by Codex.

Suggested commit message:

```text
feat(database): migrate RoomMatch backend to PostgreSQL
```

Exact file list (46 files):

- `.env.example`
- `README.md`
- `compose.yaml`
- `database/POSTGRESQL.md`
- `database/README.md`
- `database/postgresql/migrations/001_initial_schema.sql`
- `database/postgresql/seed.sql`
- `docs/ARCHITECTURE.md`
- `docs/FRIENDS.md`
- `docs/MATCHES.md`
- `docs/REQUESTS.md`
- `docs/UPLOADS.md`
- `package-lock.json`
- `package.json`
- `scripts/import-sqlite.mjs`
- `scripts/test.mjs`
- `server/api.test.mjs`
- `server/app.js`
- `server/database.js`
- `server/friends.js`
- `server/matches.js`
- `server/requests.js`
- `server/uploads.js`
- `tests/audit.test.mjs`
- `tests/auth.test.mjs`
- `tests/database.test.mjs`
- `tests/favorites-integration.test.mjs`
- `tests/favorites.test.mjs`
- `tests/friend-cancellation-api.test.mjs`
- `tests/friend-cancellation-migration.test.mjs`
- `tests/friend-discovery.test.mjs`
- `tests/friends.test.mjs`
- `tests/journey.test.mjs`
- `tests/legacy-migrations.test.mjs`
- `tests/listing-form-render.test.mjs`
- `tests/listing-status-api.test.mjs`
- `tests/listing-status.test.mjs`
- `tests/listing-validation.test.mjs`
- `tests/matches.test.mjs`
- `tests/postgresql.test.mjs`
- `tests/requests.test.mjs`
- `tests/room-detail-request.test.mjs`
- `tests/support/postgres.mjs`
- `tests/support/sqlite-legacy.js`
- `tests/uploads.test.mjs`
- `tests/ux-lifecycle.test.mjs`
