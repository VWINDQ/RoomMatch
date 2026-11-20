# Local pagination demos

Run from the repository root with the existing `.env` and a migrated local
development database. No migrations, resets, updates to existing rows, or global
seed are performed. The CLI refuses production mode, remote hosts and database
names containing `test` or `prod`; it prints only host/port/database before work.

```powershell
node scripts/demo-rooms.mjs seed
# Optional local web origin, if Vite uses another port:
node scripts/demo-rooms.mjs seed http://localhost:5174
node scripts/demo-rooms.mjs cleanup
```

The script creates exactly 30 available rooms marked `[เดโม RM12]`, capacities
2–5 residents, prices 2,500–7,000 baht, six districts, and both price
bases. Each uses the existing `public/assets/room-main.png` through the supplied
local web origin (default `http://localhost:5173`); keep that origin running.
Listings pass the shared form/API validator and database constraints.

Owner: `rm12-demo-owner@roommatch.invalid` (เจ้าของเดโม ทดสอบแบ่งหน้า).
Password hashing uses the existing `hashPassword` scrypt implementation with a
random password that is never printed or stored. This is a listing owner, not a
login account for testers: browse with your existing account. No real user is
assigned ownership, contact details or membership.

New demo rooms use the rental default: their listing owner does not live there.
Rooms created before migration 005 retain their original vacancy counts with
`owner_is_resident = true`; this migration never resets existing demo records.

Open `/rooms?q=%5Bเดโม%20RM12%5D` to see only these demos: 12 / 12 / 6 rooms.
Search, price, district, price basis and minimum vacancies can be tried normally.

The ignored `tmp/rm12-demo-<target-hash>.json` manifest records the database,
schema, owner ID, all 30 room IDs, image IDs, and fingerprints of the original
records, without passwords or connection strings. Keep this file until cleanup.
Re-running seed verifies it and adds zero records. An existing reserved email
without a manifest is never reused. Lost manifests require manual investigation;
the script will not infer ownership from a matching title or email.

Cleanup is all-or-nothing. It refuses changed records or any extra related rows,
including favorites, requests, memberships, matches, friend connections,
lifestyle/preferences, extra images, and extra rooms, even if owned by the demo
account. Incoming foreign keys are inspected dynamically, and affected tables
are locked during inspection and deletion to prevent concurrent user interaction.
It never removes those interactions automatically. Resolve them deliberately
before retrying. A refused cleanup leaves both records and manifest intact.
Cleanup removes only recorded image/room IDs and the recorded owner, then removes
the manifest. The shared image asset is never deleted. After an interrupted seed,
the manifest is retained; cleanup tolerates rolled-back/missing demo IDs so it can
recover safely. Do not delete or edit the manifest to bypass a refusal.

Tests run only against the isolated PostgreSQL fixtures:

```powershell
node --env-file=.env --test tests/demo-rooms.test.mjs
```
