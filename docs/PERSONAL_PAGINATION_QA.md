# Personal pagination runtime regression

## Reproduced cause

Read-only Chromium inspection of the running local application recorded:

| Page | Sent request | Received response | DOM before fix |
| --- | --- | --- | --- |
| Favorites | `page=1&pageSize=12` | `{ rooms: [2 records] }`, no paging metadata | 2 cards, pagination present, `page=undefined` |
| My Listings | `page=1&pageSize=10` | `{ rooms: [2 records] }`, no paging metadata | 2 cards, pagination present, `page=undefined` |

The API process was started before the personal pagination source changes.
`scripts/dev.mjs` launched the API without watch mode: Vite updated the frontend
while the old API kept its legacy, unbounded personal-list endpoints. This
contract also explains Favorites rendering all saved rooms above 12. The live
demo account had only two favorites; the overflow was reproduced with the same
legacy response backed by 13 isolated PostgreSQL fixture records, without adding
development data.

The paginated adapter trusted a TypeScript annotation at runtime. Missing
`page` became the URL string `undefined`; missing `totalPages` reached the controls,
where `undefined <= 1` is false. This produced fake pagination even for a single
page. SQL/page-size defaults in the current source were correct for normal
requests; the running API had not loaded them. The old generic 100 page-size cap
also did not enforce the newly required personal endpoint maxima.

## Fix and trace

- SQL continues to filter by the authenticated account and conditions before
  counting/sorting/paging in one statement. Favorites caps paginated requests at
  12 and My Listings at 10; Rooms keeps 100. Legacy non-paginated callers remain
  supported. No schema changes or frontend array slicing were introduced.
- Paginated adapters explicitly add paging defaults and validate response
  metadata against the requested page/size and expected number of items. A legacy
  or inconsistent response displays the error/retry state, with no cards or pager.
- The shared hook applies fixed paging after filter defaults so they cannot
  override it. Controls render only with a valid integer totalPages greater than 1.
- Dev commands use Node watch mode. A process-only launcher regression modifies
  a fake API entry point and requires the next API version to start, without a DB.
- The previously running dev process was restarted only after read-only checks
  confirmed migrations were current and no empty-database seed could run. All
  rows in all ten development business tables had identical counts/fingerprints
  before and after restart. No development mutations were used for verification.

After restart the live demo account returned total 2 / totalPages 1 / pageSize
12 or 10, rendered exactly two cards, and had no pagination DOM or malformed URL.
Read-only live evidence and screenshots are retained locally under
`tmp/pagination-bug/` (ignored by Git; no credentials are recorded).

## Red/green evidence and coverage

Before production fixes, the new legacy browser tests failed in four desktop
cases (Favorites 12/13, My Listings 10/11); the adapter regression failed with
`Missing expected rejection: ["rooms"]`; the API maxima tests failed with
`200 !== 400`; the launcher regression failed with `API source remained stale`.
The same tests are rerun after the fixes. Original permissions, ordering and
mutation assertions remain; the prior assertion allowing personal pageSize 100
is strengthened to require 400 plus exact-size acceptance.

| List | Total fixtures | API items and actual DOM cards by page | Pager in DOM |
| --- | --- | --- | --- |
| Favorites | 0 / 1 / 11 / 12 | 0 / 1 / 11 / 12 respectively | absent |
| Favorites | 13 | 12, 1 | present |
| Favorites | 24 | 12, 12 | present |
| Favorites | 25 | 12, 12, 1 | present |
| My Listings | 0 / 1 / 9 / 10 | 0 / 1 / 9 / 10 respectively | absent |
| My Listings | 11 | 10, 1 | present |
| My Listings | 20 | 10, 10 | present |
| My Listings | 21 | 10, 10, 1 | present |

The browser matrix uses a dedicated fixture owner, so unfiltered totals include
no seeded account's other listings. It compares each page's API IDs to DOM IDs,
checks exact counts and metadata, and checks the union for duplicates/missing IDs.
It also tries URL pageSize 100, confirms the frontend still requests its fixed
size, and verifies the whole pager (including mobile text and previous/next) is
absent at zero/one page. Filtering 25/21 records to 8/7 available records removes
the pager, resets page, and survives refresh and Back/Forward.

Previous personal-list and Rooms regressions cover stale responses, account
switches, out-of-range correction without request loops, last-item mutations,
duplicate-click locks, detail/edit/back/cancel/save context, and responsive layout.
All mutating checks use schemas owned by the dedicated TEST_DATABASE_URL fixtures.

Why earlier tests passed: their servers were newly started from current source
for each fixture; they did not exercise a hot-updated client against a long-lived
legacy API, and did not enumerate every zero/one-page threshold with both Network
metadata and DOM assertions. The new contract and launcher tests close that gap.

Final verification: `npm test` passed 248 tests. The combined new boundaries and
existing Rooms/personal-list/affected-flow Playwright run passed 124 tests on
desktop and mobile, with zero skipped or flaky tests. Its 28 boundary matrix rows
had zero API/DOM count or ID mismatches. `npm run build` and `git diff --check`
passed. Desktop/mobile screenshots were visually inspected. The original Windows
browser could not be attached safely by the UI tool; live checks used a separate
Chromium context against the same local URL, with read-only demo-account requests.

```powershell
node --env-file=.env --test tests/pagination-response.test.mjs tests/personal-pagination-boundaries.test.mjs tests/dev-launcher.test.mjs
npx playwright test tests/e2e/personal-pagination-boundaries.spec.mjs tests/e2e/personal-pagination.spec.mjs tests/e2e/room-pagination.spec.mjs --project=desktop --project=mobile-390
npm test
npm run build
git diff --check
```
