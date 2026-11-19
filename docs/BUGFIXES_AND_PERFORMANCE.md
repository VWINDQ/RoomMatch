# Bug fixes and performance checks — 2026-11-19

## Correctness

- Image add/delete endpoints lock their room inside a transaction, matching full
  listing updates. Concurrent requests cannot delete the last photo or exceed
  twelve photos. An occupied explicit image position returns 409 rather than a
  database error. Write failures roll back and can be retried.
- Favorites refresh restores focus only when the user has not moved to another
  control or opened a dialog. Opening the mobile filter while an unfavorite
  refresh is pending keeps focus in the filter; Escape returns to its trigger.
- Dependency updates stay within the existing package requirements. The final
  full `npm audit` reports zero vulnerabilities; no force upgrade was used.

## What made loading slower

| Cost | Before | After |
| --- | --- | --- |
| Rooms request scheduling | 250 ms delay for every load | Initial loads, paging and filters start immediately; typing is still debounced |
| Photo queries for a page of 12 rooms | 12 sequential reads | 1 ordered batch read |
| Initial JavaScript, including statically imported/preloaded chunks | About 506.3 kB | About 394.1 kB |
| Local demo room image | 2,303,273-byte PNG | 149,368-byte WebP |

The JavaScript figures are production build sizes before compression, not an
end-to-end timing claim. Heavy secondary pages load when visited; the sidebar
and route-specific skeleton remain available. A failed page download displays
a reload action. Card photos outside the viewport load lazily; the first card
and detail gallery image retain eager priority. The demo image keeps its original
PNG as a fallback, and existing database URLs do not need changing.

A separate runtime problem was a development API started before pagination was
added: it returned only `rooms`, without page metadata, to a newer frontend.
Restarting the existing dev command loads the current API and watch mode. Future
dependency updates also require restarting Vite. After pulling, use `npm ci`, stop
the previous development command, and start one `npm run dev` instance.

## Verification

- Regression tests reproduce the original concurrent-delete, concurrent-add,
  duplicate-position and favorite-focus failures before the fixes.
- Added checks cover transactional failure/retry, batched gallery ordering,
  immediate paging with debounced search, and compact-image fallback.
- Run `npm test`, `npm run build`, `npm audit` and `git diff --check`.
- Browser checks cover desktop, tablet and mobile layouts, pagination, profile
  leave protection, listing validation, friends, requests and page-load retry.
- Mutating QA runs use isolated schemas in `TEST_DATABASE_URL`. All ten local
  development business tables were fingerprinted before/after restarting the API
  and remained identical; the 34 demo listings were preserved.

No schema migration or application data reset is needed.

## Room card follow-up

- `DELETE /api/rooms/:id/favorite` returns success when the favorite is already
  absent, including after its owner deleted the room. Stale cards can then
  refresh the list. Authentication and per-user deletion remain required;
  adding a favorite for a missing room still returns 404.
- Toasts distinguish success, error and informational messages. Failed favorite
  and listing actions use an alert icon and the existing danger color. Favorite
  failures retain the previous heart state and allow retry; obsolete sessions
  cannot display late favorite feedback.
- Regression coverage uses real HTTP requests against isolated PostgreSQL test
  schemas, plus component interactions in jsdom. This follow-up has not been
  visually rechecked in a browser.
